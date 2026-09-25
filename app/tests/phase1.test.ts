import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { evaluate, labelsFromRows, runCases, truthWebsite, type BenchCase } from "@/lib/bench";
import { cached, DAY } from "@/lib/cache";
import { emptyAudit, parsePage } from "@/lib/enrich/crawl";
import { discoverWebsite } from "@/lib/enrich/discover";
import { classifyEmail, rankEmails } from "@/lib/enrich/email";
import { checkEmails } from "@/lib/pipeline";
import { scoreWebsiteDev } from "@/lib/score/websiteDev";
import { ownerName, orderLinks, parseCsv, rowToRaw } from "@/lib/sources/gmapsScraper";
import { mergePlaces } from "@/lib/dedupe";
import type { Lead } from "@/lib/types";

const lead = (over: Partial<Lead> = {}): Lead => ({
  id: "1", name: "Shree Furniture", category: "Furniture shop", city: "Vadodara", phones: [], emails: [], sources: ["osm"], signals: [], score: 0, tier: "cold", whyNow: "", ...over,
});

describe("emails", () => {
  it("tells an owner's address from a shared inbox", () => {
    expect(classifyEmail("rahul@shreefurniture.in", "shreefurniture.in")).toBe("own_named");
    expect(classifyEmail("info@shreefurniture.in", "shreefurniture.in")).toBe("own_generic");
    expect(classifyEmail("drmehta.dental@gmail.com")).toBe("personal");
    expect(classifyEmail("contact@gmail.com")).toBe("generic");
    expect(classifyEmail("bookings@othersite.com", "shreefurniture.in")).toBe("generic");
  });

  it("puts deliverable, personal addresses first and never picks a dead domain", async () => {
    const r = rankEmails([
      { email: "info@shree.in", kind: "own_generic", deliverable: true },
      { email: "rahul@shree.in", kind: "own_named", deliverable: true },
      { email: "owner@deadsite.in", kind: "own_named", deliverable: false },
    ]);
    expect(r.map((x) => x.email)).toEqual(["rahul@shree.in", "info@shree.in", "owner@deadsite.in"]);

    const l = lead({ emails: ["owner@deadsite.in"], website: "https://deadsite.in" });
    await checkEmails([l], async (d) => d !== "deadsite.in");
    expect(l.email).toBeUndefined();
    expect(l.emailInfo?.[0]).toMatchObject({ deliverable: false });
  });
});

describe("Google Maps scraper extra columns", () => {
  const csv = [
    "title,phone,owner,price_range,order_online,reservations,images,open_hours,descriptions",
    `Spice Route,+91 98250 11111,"{""id"":""1"",""name"":""Kunal Shah"",""link"":""x""}",₹200–400,"[{""link"":""https://www.zomato.com/vadodara/spice-route"",""source"":""zomato.com""}]","[{""link"":""https://www.swiggy.com/r/1""}]","[{""title"":""a""},{""title"":""b""}]","{""Monday"":[""11 am–11 pm""]}",North Indian food`,
  ].join("\n");

  it("keeps owner, price, order links, photos, hours and description", () => {
    const raw = rowToRaw(parseCsv(csv)[0], "Restaurant", "Vadodara")!;
    expect(raw).toMatchObject({ owner: "Kunal Shah", priceRange: "₹200–400", photos: 2, openHours: { Monday: "11 am–11 pm" }, about: "North Indian food" });
    expect(raw.orderLinks).toEqual([
      { source: "zomato.com", url: "https://www.zomato.com/vadodara/spice-route" },
      { source: "swiggy.com", url: "https://www.swiggy.com/r/1" },
    ]);
    expect(mergePlaces([raw])[0].owner).toEqual({ name: "Kunal Shah", via: "google_maps" });
  });

  it("ignores empty or broken cells", () => {
    expect(ownerName("")).toBeUndefined();
    expect(ownerName("{broken")).toBeUndefined();
    expect(ownerName("Dr. Anjali Patel")).toBe("Dr. Anjali Patel");
    expect(orderLinks("not json", "[]")).toEqual([]);
  });
});

describe("website facts in the score", () => {
  it("reads the owner from structured data", () => {
    const html = `<html><body><script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"Dentist","founder":{"@type":"Person","name":"Dr. Nisha Desai"},"foundingDate":"2008"}]}</script></body></html>`;
    expect(parsePage(html, "https://x.in/")).toMatchObject({ ownerName: "Dr. Nisha Desai", foundedYear: 2008 });
  });

  it("scores an old agency site, an established business and a known owner", () => {
    const now = new Date("2026-09-25");
    const r = scoreWebsiteDev(
      lead({ owner: { name: "Rahul Shah", via: "website" }, audit: { ...emptyAudit("ok"), https: true, mobileViewport: true, copyrightYear: 2019, designedBy: "Pixel Web Studio", foundedYear: 2005 } }),
      now,
    );
    const keys = r.signals.map((s) => s.key);
    expect(keys).toEqual(expect.arrayContaining(["stale", "agency_lapsed", "established", "owner_known"]));
    expect(r.signals.find((s) => s.key === "agency_lapsed")!.label).toBe("Built by Pixel Web Studio, not maintained");
  });

  it("an undeliverable email doesn't count as having an email", () => {
    const r = scoreWebsiteDev(lead({ emails: ["a@dead.in"], emailInfo: [{ email: "a@dead.in", kind: "own_named", deliverable: false }] }));
    expect(r.signals.map((s) => s.key)).not.toContain("has_email");
  });
});

describe("DNS first", () => {
  it("doesn't load pages for guessed domains that don't exist", async () => {
    const loaded: string[] = [];
    const r = await discoverWebsite(lead({ name: "Tea Post", phone: "+919000012345", phones: ["+919000012345"] }), undefined, {
      resolves: async (d) => d === "teapost.in",
      fetchHtml: async (url) => {
        loaded.push(url);
        return url === "https://teapost.in" ? { html: "<title>Tea Post</title><body>Call +91 90000 12345</body>", finalUrl: "https://teapost.in/" } : null;
      },
    });
    expect(r.website).toBe("https://teapost.in/");
    expect(loaded).toEqual(["https://teapost.in"]);
  });
});

describe("disk cache", () => {
  afterEach(() => vi.restoreAllMocks());
  it("answers repeat calls from disk, keeps errors and zero-TTL answers out", async () => {
    vi.spyOn(process, "cwd").mockReturnValue(mkdtempSync(path.join(os.tmpdir(), "lead-cache-")));
    let calls = 0;
    const stats = { hits: 0, misses: 0 };
    const fn = cached("t", async (x: string) => { calls++; if (x === "boom") throw new Error("boom"); return { x }; }, (x) => x, (r) => (r.x === "skip" ? 0 : DAY), stats);
    expect(await fn("a")).toEqual({ x: "a" });
    expect(await fn("a")).toEqual({ x: "a" });
    await fn("skip"); await fn("skip");
    await expect(fn("boom")).rejects.toThrow();
    await expect(fn("boom")).rejects.toThrow();
    expect(calls).toBe(5);
    expect(stats).toEqual({ hits: 1, misses: 5 });
  });
});

describe("benchmark", () => {
  const cases: BenchCase[] = [
    { id: "n/1", name: "Shree Furniture", category: "Furniture shop", city: "Vadodara", phone: "+91 98250 11111", osmWebsite: "https://www.shreefurniture.in" },
    { id: "n/2", name: "Aum Dental", category: "Dentist", city: "Vadodara", osmWebsite: "https://aumdental.com" },
    { id: "n/3", name: "Kiran Salon", category: "Salon & spa", city: "Vadodara" },
    { id: "n/4", name: "Moti Cafe", category: "Café & bakery", city: "Vadodara", osmWebsite: "https://instagram.com/moticafe" },
  ];

  it("finds the truth: hand-checked answer first, then OpenStreetMap, never a social link", () => {
    expect(truthWebsite(cases[0])).toBe("shreefurniture.in");
    expect(truthWebsite(cases[2], { website: "none" })).toBe("none");
    expect(truthWebsite(cases[3])).toBeUndefined();
    expect(labelsFromRows([{ id: "n/3", website: "none", pitch: "Yes" }, { id: "n/9" }])).toEqual({ "n/3": { website: "none", pitch: "yes" } });
  });

  it("runs businesses through discovery + website check with the real website hidden, and scores the run", async () => {
    const seenWebsites: Array<string | undefined> = [];
    const outcomes = await runCases(cases, {
      discover: async (l) => {
        seenWebsites.push(l.website);
        if (l.name === "Shree Furniture") return { website: "https://shreefurniture.in/", via: "domain_guess", evidence: "name + phone", tried: [] };
        if (l.name === "Kiran Salon") return { website: "https://justsalon.in/", via: "web_search", evidence: "name + area", tried: [] };
        return { tried: [] };
      },
      audit: async (w) => (w ? { ...emptyAudit("ok"), emails: ["rahul@shreefurniture.in"], phones: ["+919825011111"] } : emptyAudit("none")),
      mx: async () => true,
    });
    expect(seenWebsites).toEqual([undefined, undefined, undefined, undefined]);
    const r = evaluate(cases, outcomes, { "n/3": { website: "none", pitch: "yes" } });
    expect(r.website).toMatchObject({ correct: 1, wrong: 1, missed: 1, precision: 50, recall: 50 });
    expect(r.contacts.email).toBe(50);
    expect(r.contacts.personalEmail).toBe(25); // Kiran's email is on another domain: "other"
    expect(r.handChecked.labelled).toBe(1);
  });
});

describe("benchmark: chains and sources", () => {
  it("leaves chains out of the website numbers, like a real search", async () => {
    const cases: BenchCase[] = [
      { id: "gmaps/1", source: "gmaps", name: "Hampton by Hilton Vadodara-Alkapuri", category: "Hotel & homestay", city: "Vadodara", knownWebsite: "https://www.hilton.com/en/hotels/x" },
      { id: "gmaps/2", source: "gmaps", name: "Sayaji Dental", category: "Dentist", city: "Vadodara", knownWebsite: "https://sayajidental.in", owner: "Dr. Mehul Shah" },
    ];
    const discovered: string[] = [];
    const outcomes = await runCases(cases, {
      discover: async (l) => { discovered.push(l.name); return { website: "https://sayajidental.in/", via: "domain_guess", evidence: "name + phone", tried: [] }; },
      audit: async (w) => (w ? emptyAudit("ok") : emptyAudit("none")),
    });
    expect(discovered).toEqual(["Sayaji Dental"]);
    const r = evaluate(cases, outcomes);
    expect(r.website).toMatchObject({ checked: 1, correct: 1, chainsSkipped: 1, recall: 100 });
    expect(r.contacts.owner).toBe(50);
    expect(outcomes[1].lead.sources).toEqual(["gmaps"]);
  });
});

describe("website matching fixes from the first Vadodara run", () => {
  it("strips Google Maps keyword stuffing from names", async () => {
    const { cleanBusinessName } = await import("@/lib/enrich/discover");
    expect(cleanBusinessName("2th Saver Dental Clinic(advanced dental care at affordable rates)", "Vadodara")).toBe("2th Saver Dental Clinic");
    expect(cleanBusinessName("Dr. Hada dental and orthodontic clinic - Vadodara", "Vadodara")).toBe("Dr. Hada dental and orthodontic clinic");
    expect(cleanBusinessName("Vasudha Hospital and Dental Clinic in Vadodara", "Vadodara")).toBe("Vasudha Hospital and Dental Clinic");
    expect(cleanBusinessName("THE BULL FITNESS HUB – Karodiya | Unisex Gym & Physical Fitness Centre", "Vadodara")).toBe("THE BULL FITNESS HUB");
    // nothing left but generic words: keep the name as it is
    expect(cleanBusinessName("Vadodara Dental Clinic", "Vadodara")).toBe("Vadodara Dental Clinic");
  });

  it("guesses the short web addresses clinics really use", async () => {
    const { candidateDomains } = await import("@/lib/enrich/discover");
    expect(candidateDomains("Dr. Hada dental and orthodontic clinic", "Vadodara")).toContain("drhadadental.com");
    expect(candidateDomains("2th Saver Dental Clinic", "Vadodara")).toContain("2thsaver.com");
    expect(candidateDomains("Smile Dental", "Vadodara")).toContain("smiledentalvadodara.co.in");
    expect(candidateDomains("Vasudha Hospital and Dental Clinic").some((d) => d.includes("hospitaland."))).toBe(false);
  });

  it("an address that starts with the business name is not a second proof", async () => {
    const { verifyPageForLead } = await import("@/lib/enrich/discover");
    const lead = { name: "Anjoy", phones: [], city: "Vadodara", address: "Anjoy Restaurant, Alkapuri, Vadodara" };
    expect(verifyPageForLead("<title>Anjoy Laddu</title><body>Anjoy laddus, order online</body>", lead).ok).toBe(false);
    expect(verifyPageForLead("<title>Anjoy Restaurant</title><body>Alkapuri, Vadodara</body>", lead).ok).toBe(true);
  });

  it("finds the site when the Maps name is stuffed with keywords", async () => {
    const r = await discoverWebsite(lead({ name: "2th Saver Dental Clinic(advanced dental care at affordable rates)", phone: "+919825011111", phones: ["+919825011111"] }), undefined, {
      resolves: async (d) => d === "2thsaver.com",
      fetchHtml: async (url) => (url === "https://2thsaver.com" ? { html: "<title>2th Saver Dental Clinic</title><body>Call 98250 11111</body>", finalUrl: "https://2thsaver.com/" } : null),
    });
    expect(r.website).toBe("https://2thsaver.com/");
  });

  it("benchmark: another site showing the business's own phone counts as theirs, listed separately", () => {
    const c: BenchCase = { id: "g/1", name: "Vraj Group of Dental Clinics", category: "Dentist", city: "Vadodara", knownWebsite: "https://vrajdentalclinic.com" };
    const l = lead({ name: c.name, website: "https://vrajgroupofdentalclinics.in/", websiteCheck: { via: "web_search", evidence: "business name and phone number are on the page", tried: [] } });
    const r = evaluate([c], [{ id: c.id, lead: l, ms: 1 }]);
    expect(r.website).toMatchObject({ alternate: 1, wrong: 0, precision: 100, recall: 100 });
  });
});

describe("website matching fixes from the second Vadodara run", () => {
  const home = (title: string, body: string, extra = "") => `<html><head><title>${title}</title>${extra}</head><body>${body}</body></html>`;

  it("finds the phone in tel: links and structured data, not only in visible text", async () => {
    const { verifyPageForLead } = await import("@/lib/enrich/discover");
    const l = { name: "Cafe Brewito", phones: ["+919586968006"], city: "Vadodara" };
    expect(verifyPageForLead(home("Brewito Cafe", `<a href="tel:+919586968006">Call us</a>`), l)).toMatchObject({ ok: true, proof: "phone" });
    expect(verifyPageForLead(home("Brewito Cafe", "Specialty coffee", `<script type="application/ld+json">{"telephone":"+91 95869 68006"}</script>`), l)).toMatchObject({ ok: true });
    // a JavaScript-built site with the city only in its structured data
    expect(verifyPageForLead(home("Brewito", "", `<script type="application/ld+json">{"address":{"addressLocality":"Vadodara"}}</script>`), { ...l, phones: [] })).toMatchObject({ ok: true, proof: "place" });
  });

  it("looks at the contact page when the homepage has the name but no phone", async () => {
    const { discoverWebsite } = await import("@/lib/enrich/discover");
    const pages: Record<string, string> = {
      "https://agrofurniture.in": home("Agro Furniture | Premium furniture", `<a href="/contact-us">Contact</a>`),
      "https://agrofurniture.in/contact-us": home("Contact", "Call 88662 66555, Makarpura GIDC"),
    };
    const r = await discoverWebsite(lead({ name: "Agro Furniture - Premium Furniture Manufacturer and Dealer In Vadodara", phone: "+918866266555", phones: ["+918866266555"] }), undefined, {
      resolves: async (d) => d === "agrofurniture.in",
      fetchHtml: async (url) => (pages[url] ? { html: pages[url], finalUrl: url } : null),
    });
    expect(r).toMatchObject({ website: "https://agrofurniture.in", via: "domain_guess", evidence: "business name and phone number are on the site (contact page)" });
  });

  it("reads names written in Unicode bold letters, and doesn't require generic words like 'family'", async () => {
    const { cleanBusinessName, verifyPageForLead } = await import("@/lib/enrich/discover");
    expect(cleanBusinessName("𝗦𝘁𝘆𝗹𝗼𝗿𝗶𝗮 𝗨𝗻𝗶𝘀𝗲𝘅 𝗛𝗮𝗶𝗿 𝗦𝘁𝘂𝗱𝗶𝗼 & 𝗟𝗼𝘂𝗻𝗴𝗲 - Biggest Salon/Best Unisex Hair Salon in Vadodara", "Vadodara")).toBe("Styloria Unisex Hair Studio & Lounge");
    expect(verifyPageForLead(home("Sanskruti Salon", "Alkapuri, Vadodara"), { name: "Sanskruti Family Salon", phones: [], city: "Vadodara" })).toMatchObject({ ok: true });
  });

  it("guesses 'the' + name and name + trade", async () => {
    const { candidateDomains } = await import("@/lib/enrich/discover");
    expect(candidateDomains("The Morsel Restaurant", "Vadodara", "Restaurant")).toContain("themorsel.in");
    expect(candidateDomains("Anjoy", "Vadodara", "Restaurant")).toContain("anjoyrestaurant.com");
    expect(candidateDomains("Cafe Brewito", "Vadodara", "Café & bakery")).toContain("cafebrewito.com");
  });

  it("benchmark doesn't use brand store pages, hotel groups, directories or link pages as answers", () => {
    for (const w of ["https://stores.nilkamalhomes.com/x", "https://www.marriott.com/x", "https://sites.google.com/view/x", "https://superyou.bio/x", "https://gharpedia.com/x", "https://www.pepperfry.com/x"])
      expect(truthWebsite({ id: "x", name: "X", category: "Furniture shop", city: "Vadodara", knownWebsite: w }), w).toBeUndefined();
    expect(truthWebsite({ id: "x", name: "X", category: "Salon & spa", city: "Vadodara", knownWebsite: "https://vyom-dental-care.grexa.site" })).toBe("vyom-dental-care.grexa.site");
  });
});

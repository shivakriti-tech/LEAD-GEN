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

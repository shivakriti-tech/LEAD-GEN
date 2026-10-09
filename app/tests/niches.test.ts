import { describe, expect, it } from "vitest";
import { hasNicheReason, isNiche, NICHE_KEYS, NICHES, nicheChips, scoreNiche } from "@/lib/niches";
import { siteFacts, mergeFacts } from "@/lib/enrich/facts";
import { techHints } from "@/lib/enrich/tech";
import { parsePage } from "@/lib/enrich/crawl";
import { CATEGORIES, categoriesFor, categoryByKey, NICHE_CATEGORIES } from "@/lib/categories";
import { firstMessage, followUpMessage, issueChips, lastFollowUp, subjectLine } from "@/lib/outreach";
import { linkedinNote, NOTE_MAX } from "@/lib/linkedin";
import { leadsReport } from "@/lib/report";
import { leadsToCsv } from "@/lib/csv";
import { needLabels } from "@/lib/score/agency";
import { parseBrain } from "@/lib/brain";
import { offerFromWords } from "@/lib/brainAnalyze";
import type { Lead, NicheKey, SearchRecord, WebsiteAudit } from "@/lib/types";

const NOW = new Date("2026-10-01T12:00:00Z");
const audit = (over: Partial<WebsiteAudit> = {}): WebsiteAudit => ({ status: "ok", emails: [], phones: [], socials: {}, finalUrl: "https://example.in/", https: true, mobileViewport: true, copyrightYear: 2026, ...over });
const lead = (over: Partial<Lead> = {}): Lead => ({
  id: "1", name: "Shree Polymers", category: "Manufacturer", city: "Vadodara", phone: "+919876543210", phones: ["+919876543210"], emails: [], sources: ["google"], signals: [], score: 0, tier: "cold", whyNow: "", ...over,
});
const scored = (l: Lead, key: NicheKey) => {
  const r = scoreNiche(l, key, NOW);
  return { ...l, ...r } as Lead;
};
const keys = (l: Lead) => l.signals.map((s) => s.key);

describe("niche registry", () => {
  it("has five niches, each with business types that exist, defaults among them, and needs", () => {
    expect(NICHE_KEYS).toEqual(["marketing", "solar", "accounting", "staffing", "insurance"]);
    for (const k of NICHE_KEYS) {
      const n = NICHES[k];
      const cats = categoriesFor(k).map((c) => c.key);
      expect(cats.length, k).toBe(NICHE_CATEGORIES[k].length); // every key is a real category
      for (const d of n.defaults) expect(cats, `${k} default ${d}`).toContain(d);
      expect(Object.keys(n.needs).length, k).toBeGreaterThan(0);
      expect(n.tiers[0]).toBeGreaterThan(n.tiers[1]);
    }
    expect(isNiche("solar")).toBe(true);
    expect(isNiche("logistics")).toBe(false);
    expect(isNiche(undefined)).toBe(false);
  });

  it("category keys and labels are unique (labels map leads back to their type)", () => {
    expect(new Set(CATEGORIES.map((c) => c.key)).size).toBe(CATEGORIES.length);
    expect(new Set(CATEGORIES.map((c) => c.label)).size).toBe(CATEGORIES.length);
  });

  it("adds new local business types to website searches, and keeps institutions out of them", () => {
    const web = categoriesFor("website_development").map((c) => c.key);
    for (const k of ["vet", "diagnostic", "pharmacy", "optician", "preschool", "classes", "driving", "venue", "photographer", "travel", "car_service", "car_dealer", "architect", "jeweller", "electronics", "hardware"]) expect(web).toContain(k);
    for (const k of ["hospital", "school", "cold_storage", "warehouse", "it_company"]) expect(web).not.toContain(k);
    expect(categoryByKey("cold_storage")?.osm.length).toBeGreaterThan(0);
  });
});

describe("site facts", () => {
  it("reads solar, power use, booking, certificates, staff size and hazardous goods", () => {
    const f = siteFacts("We installed a 250 kWp rooftop solar plant in 2024. Our cold storage runs 24x7. Book an appointment online. ISO 9001:2015 and ISO 14001 certified. FSSAI licensed. A team of 1,200+ employees. We handle flammable solvents.");
    expect(f.solar).toMatch(/solar/i);
    expect(f.heavyPower).toBe("cold storage");
    expect(f.booking).toBe(true);
    expect(f.certs).toEqual(["ISO 9001", "ISO 14001", "FSSAI"]);
    expect(f.employees).toBe(1200);
    expect(f.hazardous).toBe(true);
  });

  it("finds booking widgets by their links and ignores pages with nothing to say", () => {
    expect(siteFacts("Welcome", ["practo.com"]).booking).toBe(true);
    expect(siteFacts("Family-run since 1990. Call us for prices.")).toEqual({});
    expect(siteFacts("We sell solar water heaters").solar).toBeUndefined();
  });

  it("merges facts across pages", () => {
    const m = mergeFacts({ certs: ["ISO 9001"], employees: 40 }, { certs: ["GMP"], employees: 120, booking: true });
    expect(m).toEqual({ certs: ["ISO 9001", "GMP"], employees: 120, booking: true });
  });

  it("the crawler returns facts and analytics / ad tags", () => {
    const html = `<html><body><script async src="https://www.googletagmanager.com/gtag/js?id=G-ABC123"></script><script>fbq('init', '123');</script><p>Book now. ISO 14001 certified.</p></body></html>`;
    const p = parsePage(html, "https://clinic.example.in/");
    expect(p.facts).toMatchObject({ booking: true, certs: ["ISO 14001"] });
    expect(p.tech.marketing).toEqual(["Google Analytics", "Meta Pixel"]);
    expect(techHints(`<script src="https://www.googletagmanager.com/gtm.js?id=GTM-K9X2"></script><script>gtag('config','AW-12345')</script>`, "").marketing).toEqual(["Google Tag Manager", "Google Ads"]);
    expect(techHints("<p>plain</p>", "").marketing).toBeUndefined();
  });
});

describe("digital marketing & SEO", () => {
  it("few reviews, no tracking, no Instagram and no booking make a strong lead with evidence", () => {
    const l = scored(lead({ name: "Smile Dental Care", category: "Dentist", reviews: 7, rating: 4.6, audit: audit({ tech: {} }) }), "marketing");
    expect(keys(l)).toEqual(expect.arrayContaining(["few_reviews", "no_tracking", "no_instagram", "no_booking"]));
    expect(l.signals.find((s) => s.key === "few_reviews")!.label).toBe("Only 7 Google reviews");
    expect(l.tier).toBe("hot");
    expect(l.pitchFor).toMatchObject({ kind: "niche", niche: "marketing" });
    expect((l.pitchFor as { needs: string[] }).needs).toEqual(expect.arrayContaining(["gbp", "reviews", "ads", "social"]));
    expect(l.whyNow).toMatch(/^Dentist in Vadodara: only 7 Google reviews/);
    expect(hasNicheReason(l)).toBe(true);
  });

  it("a low rating is a reason; a business already strong on Google scores lower", () => {
    const low = scored(lead({ name: "City Cafe", category: "Café & bakery", reviews: 80, rating: 3.6, audit: audit({ tech: { marketing: ["Google Analytics"] }, socials: { instagram: "https://instagram.com/citycafe" } }) }), "marketing");
    expect(keys(low)).toContain("low_rating");
    const strong = scored(lead({ name: "Top Salon", category: "Salon & spa", reviews: 400, rating: 4.8, audit: audit({ tech: { marketing: ["Google Analytics", "Meta Pixel"] }, socials: { instagram: "https://instagram.com/top" }, facts: { booking: true } }) }), "marketing");
    expect(keys(strong)).toEqual(expect.arrayContaining(["strong_google", "runs_ads"]));
    expect(strong.score).toBeLessThan(low.score);
  });

  it("doesn't guess reviews from the free map, which has none", () => {
    const l = scored(lead({ category: "Dentist", sources: ["osm"], audit: audit() }), "marketing");
    expect(keys(l)).not.toContain("no_reviews");
  });

  it("marks marketing agencies as competitors", () => {
    const l = scored(lead({ name: "Pixel Digital Marketing Agency", category: "Retail shop" }), "marketing");
    expect(l.score).toBe(0);
    expect(l.whyNow).toMatch(/competitor/);
    expect(issueChips(l)[0]).toEqual({ label: "Marketing agency", kind: "bad" });
  });
});

describe("rooftop solar", () => {
  it("a cold storage in GIDC that exports to Europe is a strong lead", () => {
    const l = scored(lead({ name: "Gujarat Frozen Foods", category: "Cold storage & ice plant", address: "Plot 12, GIDC Makarpura, Vadodara", audit: audit({ trade: { exports: true, countries: ["Germany", "UAE"] }, facts: { heavyPower: "cold storage", certs: ["ISO 14001"] } }) }), "solar");
    expect(keys(l)).toEqual(expect.arrayContaining(["cold_chain", "industrial", "exporter_green", "iso14001"]));
    expect(l.tier).toBe("hot");
    expect((l.pitchFor as { needs: string[] }).needs).toEqual(expect.arrayContaining(["rooftop", "battery"]));
    expect(nicheChips(l).map((c) => c.label)).toEqual(["Cold storage", "Exporter", "Industrial area"]);
  });

  it("a site that's already on solar scores much lower; solar companies are competitors", () => {
    const base = lead({ category: "Manufacturer", address: "GIDC Por" });
    const without = scored({ ...base, audit: audit() }, "solar");
    const withSolar = scored({ ...base, audit: audit({ facts: { solar: "rooftop solar plant" } }) }, "solar");
    expect(withSolar.score).toBeLessThan(without.score - 20);
    expect(scored(lead({ name: "SunRise Solar Solutions", category: "Manufacturer" }), "solar").score).toBe(0);
  });

  it("hospitals are institutions with 24×7 load", () => {
    const l = scored(lead({ name: "Sterling Hospital", category: "Hospital & nursing home", openHours: { Monday: "Open 24 hours" } }), "solar");
    expect(keys(l)).toEqual(expect.arrayContaining(["institution", "open_24"]));
  });
});

describe("CA, GST & compliance", () => {
  it("an online-selling exporter that's hiring needs export compliance, GST and payroll", () => {
    const l = scored(lead({ name: "Rangoli Handicrafts", category: "Exporter", audit: audit({ trade: { exports: true, sellsOnline: true, iec: true, countries: ["USA"] }, growth: { hiring: "we are hiring" }, tech: { marketplaces: ["Amazon"] } }) }), "accounting");
    expect(keys(l)).toEqual(expect.arrayContaining(["exports", "sells_online", "iec", "hiring"]));
    expect((l.pitchFor as { needs: string[] }).needs).toEqual(expect.arrayContaining(["gst", "export", "payroll"]));
    expect(l.tier).toBe("hot");
  });

  it("a brand-new business needs GST registration, books and ROC filings", () => {
    const l = scored(lead({ name: "Nova Traders", category: "Wholesaler", audit: audit({ growth: { opened: "newly opened" } }) }), "accounting");
    expect(keys(l)).toEqual(expect.arrayContaining(["new_business", "trader"]));
    expect((l.pitchFor as { needs: string[] }).needs).toEqual(expect.arrayContaining(["gst", "books", "company"]));
  });

  it("CA firms are competitors", () => {
    expect(scored(lead({ name: "Mehta & Associates", category: "Wholesaler" }), "accounting").score).toBe(0);
    expect(scored(lead({ name: "Shah Chartered Accountants", category: "IT & services company" }), "accounting").score).toBe(0);
  });
});

describe("hiring & staffing", () => {
  it("hiring now is the strongest reason, quoted from the website", () => {
    const l = scored(lead({ name: "Apex Engineering", category: "Engineering & fabrication", audit: audit({ growth: { hiring: "current openings", expanding: "new plant" }, facts: { employees: 220 } }) }), "staffing");
    expect(keys(l)).toEqual(expect.arrayContaining(["hiring", "expanding", "shift_work", "size"]));
    expect(l.tier).toBe("hot");
    expect(firstMessage(l, "en", { name: "Asha", company: "TalentBridge" })).toMatch(/I saw Apex Engineering is hiring \("current openings" on your website\)/);
  });

  it("staffing agencies are competitors; a business with no hiring signal stays low", () => {
    expect(scored(lead({ name: "Prime Manpower Services", category: "Manufacturer" }), "staffing").score).toBe(0);
    expect(scored(lead({ name: "Quiet Office", category: "IT & services company", phone: undefined, phones: [] }), "staffing").tier).toBe("cold");
  });
});

describe("business insurance", () => {
  it("an exporter with a factory and a growing team needs cargo, fire and health cover", () => {
    const l = scored(lead({ category: "Chemical & plastics", audit: audit({ trade: { exports: true, manufactures: true, countries: ["Kenya"] }, facts: { employees: 60, hazardous: true } }) }), "insurance");
    expect(keys(l)).toEqual(expect.arrayContaining(["ships_abroad", "factory", "hazardous", "team"]));
    expect((l.pitchFor as { needs: string[] }).needs).toEqual(["marine", "fire", "health", "liability"]);
    expect(needLabels(l.pitchFor)).toEqual(["marine cargo insurance", "fire & property insurance", "group health insurance", "liability insurance"]);
  });

  it("insurers and brokers are competitors", () => {
    expect(scored(lead({ name: "Secure Insurance Brokers", category: "Warehouse & godown" }), "insurance").score).toBe(0);
  });
});

describe("niche messages", () => {
  const me = { name: "Divy", company: "Shree Solar" };
  const l = scored(lead({ category: "Manufacturer", address: "GIDC Makarpura", owner: { name: "Rakesh Patel", via: "website" }, audit: audit() }), "solar");

  it("name the business, what we saw, the offer and a small ask, in English and Hinglish", () => {
    const en = firstMessage(l, "en", me);
    expect(en).toMatch(/^Hi Rakesh, I'm Divy from Shree Solar\. I came across Shree Polymers in GIDC Makarpura/);
    expect(en).toMatch(/free savings estimate/);
    const hi = firstMessage(l, "hi", me);
    expect(hi).toMatch(/^Namaste Rakesh ji, main Divy Shree Solar se\./);
    expect(hi).toMatch(/bill/);
    expect(firstMessage(l, "hi", { name: "Divy", work: "solar consultant" })).toMatch(/^Namaste Rakesh ji, main Divy, solar consultant\./);
    const short = firstMessage(l, "en", me, "short");
    expect(short.length).toBeLessThan(en.length);
  });

  it("has its own subject, follow-ups and LinkedIn note", () => {
    expect(subjectLine(l)).toBe("Shree Polymers power bill");
    expect(followUpMessage(l, "en", me)).toMatch(/following up on my note about rooftop solar for Shree Polymers/);
    expect(lastFollowUp(l, "en", me)).toMatch(/one last note about rooftop solar/);
    const note = linkedinNote(l, me);
    expect(note.length).toBeLessThanOrEqual(NOTE_MAX);
    expect(note).toMatch(/rooftop solar/);
  });

  it("every niche writes a message with no placeholders left when you've filled in your details", () => {
    for (const k of NICHE_KEYS) {
      const x = scored(lead({ name: "Test Co", category: NICHES[k].defaults.map((d) => categoryByKey(d)!.label)[0], audit: audit({ growth: { hiring: "we are hiring" } }), reviews: 5, rating: 4.5 }), k);
      for (const lang of ["en", "hi"] as const) {
        const m = firstMessage(x, lang, { name: "Divy", company: "Acme" });
        expect(m, `${k} ${lang}`).not.toMatch(/\[|undefined|null|NaN/);
        expect(m.length, `${k} ${lang}`).toBeGreaterThan(60);
      }
    }
  });
});

describe("reports and exports for a niche search", () => {
  const leads = [
    scored(lead({ id: "a", category: "Cold storage & ice plant", audit: audit({ facts: { heavyPower: "cold storage" } }) }), "solar"),
    scored(lead({ id: "b", name: "Bright Solar Co", category: "Manufacturer" }), "solar"),
  ];
  const search: SearchRecord = { id: "s1", createdAt: NOW.toISOString(), params: { sells: "solar", categories: ["cold_storage", "manufacturer"], city: "Vadodara", perCategory: 20, sources: { google: true, osm: true, apollo: false, instagram: false, facebook: false, web: false, gmaps: false }, pageSpeed: false, verifyWebsites: true, webSearch: true }, status: "done", counts: { found: 2, afterDedupe: 2, hot: 1, warm: 0, cold: 1 } };

  it("the report titles the niche, counts needs and leaves competitors out", () => {
    const html = leadsReport({ search, leads, all: true, now: NOW });
    expect(html).toMatch(/Leads for rooftop solar/);
    expect(html).toMatch(/Need rooftop solar/);
    expect(html).not.toMatch(/Bright Solar Co/);
  });

  it("the CSV lists what each lead likely needs", () => {
    const csv = leadsToCsv(leads);
    expect(csv).toMatch(/rooftop solar/);
  });
});

describe("client profiles for niches", () => {
  it("a client can be a solar installer, a CA firm and so on", () => {
    const r = parseBrain({ name: "Shree Solar", offer: "solar" });
    expect(r.ok).toBe(true);
    expect(parseBrain({ name: "X", offer: "agency" }).ok).toBe(false);
  });

  it("reading a client's site tells which niche it sells", () => {
    expect(offerFromWords("Rooftop solar for factories. On-grid and off-grid systems, net metering, 100 kWp plants. Solar EPC.")).toBe("solar");
    expect(offerFromWords("Chartered accountant. GST filing, GST return, income tax, TDS, audit and ROC compliance.")).toBe("accounting");
    expect(offerFromWords("Freight forwarding, customs clearance, cargo, shipping and warehousing.")).toBe("logistics");
    expect(offerFromWords("Website design, web development and WordPress websites.")).toBe("website_development");
    expect(offerFromWords("Recruitment and staffing: manpower supply, contract staff, placement and executive search.")).toBe("staffing");
    expect(offerFromWords("Marine cargo insurance, fire policy, group health insurance and claims settlement from every insurer.")).toBe("insurance");
    expect(offerFromWords("Digital marketing: Google Ads, Meta ads, social media marketing and local SEO for clinics.")).toBe("marketing");
  });
});

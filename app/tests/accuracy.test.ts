import { describe, expect, it } from "vitest";
import { contactConfidence } from "@/lib/confidence";
import { learnFrom, learnedSignal, MIN_CONTACTED, tierFor, withLearned } from "@/lib/learn";
import { runSearch, type Deps } from "@/lib/pipeline";
import { emptyAudit } from "@/lib/enrich/crawl";
import type { Lead, SearchRecord, Signal } from "@/lib/types";
import type { Store } from "@/lib/store";

const NOW = new Date("2026-10-01T12:00:00Z");
const lead = (over: Partial<Lead> = {}): Lead => ({ id: "1", name: "Sharma Dental", category: "Dentist", phones: [], emails: [], sources: ["google"], signals: [], score: 0, tier: "cold", whyNow: "", ...over });

describe("contact confidence", () => {
  it("is high when the phone matches the listing and the website and the mailbox is verified", () => {
    const c = contactConfidence(
      lead({
        phone: "+919822012345", phones: ["+919822012345"], sources: ["google", "osm"], businessStatus: "OPERATIONAL", email: "dr@sharmadental.in", checkedAt: NOW.toISOString(),
        emailInfo: [{ email: "dr@sharmadental.in", kind: "own_named", deliverable: true, mailbox: "valid" }],
        audit: { ...emptyAudit("ok"), finalUrl: "https://sharmadental.in/", phones: ["+91 98220 12345"] }, websiteCheck: { via: "source", tried: [] },
      }),
      NOW,
    );
    expect(c.level).toBe("high");
    expect(c.reasons).toEqual(expect.arrayContaining(["Phone matches the map listing and the website", "Email mailbox verified", "Found in 2 sources"]));
  });

  it("is low for one unconfirmed source, a dead email, a closed business or stale data", () => {
    const c = contactConfidence(
      lead({ sources: ["web"], phone: "+912652345678", phones: ["+912652345678"], email: "info@gone.in", emailInfo: [{ email: "info@gone.in", kind: "generic", deliverable: false }], businessStatus: "CLOSED_TEMPORARILY", checkedAt: "2026-07-01T00:00:00Z" }),
      NOW,
    );
    expect(c.level).toBe("low");
    expect(c.reasons).toEqual(expect.arrayContaining(["Email can't receive mail", "Google says temporarily closed"]));
    expect(c.reasons.some((r) => /Checked \d+ days ago/.test(r))).toBe(true);
  });

  it("says plainly when there's no phone", () => {
    expect(contactConfidence(lead(), NOW).reasons).toContain("No phone number");
  });
});

/** n messaged leads with these signals, `replied` of them replied. */
function batch(n: number, replied: number, keys: string[], from = 0): Lead[] {
  return Array.from({ length: n }, (_, i) =>
    lead({
      id: `l${from + i}`, name: `Biz ${from + i}`, placeId: `p${from + i}`,
      signals: keys.map((k) => ({ key: k, label: k, points: 10 })),
      followUp: { status: i < replied ? "replied" : "contacted", updatedAt: NOW.toISOString(), touches: [{ channel: "whatsapp", step: 0, at: NOW.toISOString() }] },
    }),
  );
}

describe("learning from your own replies", () => {
  // 40 messaged: leads with no website replied 12 of 20, the rest 2 of 20 → 35% overall
  const leads = [...batch(20, 12, ["no_website"], 0), ...batch(20, 2, ["stale", "has_phone"], 100)];
  const learned = learnFrom(leads);

  it("counts reply rates per reason, pulled towards your average", () => {
    expect(learned.contacted).toBe(40);
    expect(learned.replied).toBe(14);
    expect(learned.base).toBeCloseTo(0.35);
    expect(learned.signals.no_website.lift).toBeGreaterThan(1.3);
    expect(learned.signals.stale.lift).toBeLessThan(0.7);
    // contact details aren't a reason to pitch
    expect(learned.signals.has_phone).toBeUndefined();
  });

  it("nudges a new lead by at most 15 points, with the evidence", () => {
    const up = learnedSignal([{ key: "no_website", label: "No website", points: 55 }], learned)!;
    expect(up.points).toBeGreaterThan(0);
    expect(up.points).toBeLessThanOrEqual(15);
    expect(up.label).toMatch(/^Your results: leads with no website replied \d\.\d× as often \(12 of 20\)$/);
    const down = learnedSignal([{ key: "stale", label: "Not updated", points: 10 }], learned)!;
    expect(down.points).toBeLessThan(0);
    expect(down.points).toBeGreaterThanOrEqual(-15);
  });

  it("never lifts a competitor", () => {
    expect(learnedSignal([{ key: "competitor", label: "", points: -70 }, { key: "no_website", label: "", points: 55 }], learned)).toBeUndefined();
  });

  it("changes nothing until 30 leads were messaged, or for reasons seen fewer than 8 times", () => {
    expect(learnedSignal([{ key: "no_website", label: "", points: 55 }], learnFrom(batch(MIN_CONTACTED - 1, 10, ["no_website"])))).toBeUndefined();
    const few = learnFrom([...batch(35, 10, ["stale"]), ...batch(5, 5, ["exports"], 200)]);
    expect(learnedSignal([{ key: "exports", label: "", points: 20 }], few)).toBeUndefined();
  });

  it("counts the same business found in two searches once", () => {
    const twice = [...batch(1, 1, ["no_website"]), ...batch(1, 1, ["no_website"])];
    expect(learnFrom(twice).contacted).toBe(1);
  });

  it("re-tiers the lead at the offer's own thresholds", () => {
    const r = { signals: [{ key: "no_website", label: "No website", points: 55 }] as Signal[], score: 60, tier: "warm" as const };
    const out = withLearned(r, "website_development", learned);
    expect(out.score).toBeGreaterThan(60);
    expect(out.tier).toBe(tierFor("website_development", out.score));
    expect(out.signals.at(-1)!.key).toBe("learned");
    expect(withLearned(r, "website_development", undefined)).toBe(r);
    expect(tierFor("solar", 60)).toBe("hot");
    expect(tierFor("accounting", 30)).toBe("warm");
  });
});

describe("a niche search, end to end", () => {
  function memStore(): Store {
    const data = new Map<string, { search: SearchRecord; leads: Lead[] }>();
    return {
      kind: "local",
      async saveSearch(s) { data.set(s.id, { search: structuredClone(s), leads: data.get(s.id)?.leads ?? [] }); },
      async saveLeads(id, leads) { data.get(id)!.leads = leads; },
      async listSearches() { return [...data.values()].map((x) => x.search); },
      async getSearch(id) { return data.get(id) ?? null; },
      async updateFollowUps() { return []; },
      async deleteLeads() { return 0; },
    };
  }

  it("finds, checks and scores cold storages for a solar installer, with confidence and the learned nudge", async () => {
    // cold storages replied far more often than other factories in earlier solar searches
    const learned = learnFrom([...batch(20, 15, ["cold_chain"]), ...batch(20, 3, ["factory"], 100)]);
    const deps: Deps = {
      keys: { google: "k" },
      store: memStore(),
      now: () => NOW,
      google: async ({ category, city }) => ({
        requests: 1,
        places: [
          { source: "google", sourceId: "g1", name: "Arctic Cold Storage", category, city, address: "Plot 4, GIDC Por, Vadodara", phone: "+91 98250 11111", website: "https://arcticcold.in", rating: 4.2, reviews: 40 },
          { source: "google", sourceId: "g2", name: "Sunshine Solar Energy", category, city, phone: "+91 98250 22222" },
        ],
      }),
      geocode: async () => ({ box: { south: 22.2, west: 73.1, north: 22.4, east: 73.3 }, via: "test" }),
      osm: async () => [],
      discover: async () => ({ tried: [] }),
      audit: async (w) => (w ? { ...emptyAudit("ok"), finalUrl: w, phones: ["+919825011111"], facts: { heavyPower: "cold storage", certs: ["ISO 14001"] }, trade: { exports: true, countries: ["Germany"] } } : emptyAudit("none")),
      pageSpeed: async () => ({ score: 80 }),
      apollo: async () => null,
      social: async () => [],
      web: async () => ({ places: [], queries: 0, rejected: [] }),
      gmaps: async () => [],
      igLookup: async () => null,
      fbSearch: async () => [],
      checkCandidate: async () => ({ ok: false, evidence: "" }),
      learned: async () => learned,
    };
    const { leads } = await runSearch({ sells: "solar", client: { name: "Shree Solar", services: [] }, categories: ["cold_storage"], city: "Vadodara", perCategory: 20, sources: { google: true, osm: false, apollo: false, instagram: false, facebook: false, web: false, gmaps: false }, pageSpeed: false, verifyWebsites: false, webSearch: false }, deps, () => {});
    const arctic = leads.find((l) => l.name === "Arctic Cold Storage")!;
    expect(arctic.tier).toBe("hot");
    expect(arctic.pitchFor).toMatchObject({ kind: "niche", niche: "solar", client: "Shree Solar" });
    expect(arctic.signals.map((s) => s.key)).toEqual(expect.arrayContaining(["cold_chain", "industrial", "exporter_green", "iso14001", "learned"]));
    expect(arctic.confidence?.reasons).toContain("Phone matches the map listing and the website");
    const rival = leads.find((l) => l.name === "Sunshine Solar Energy")!;
    expect(rival.score).toBe(0);
  });
});

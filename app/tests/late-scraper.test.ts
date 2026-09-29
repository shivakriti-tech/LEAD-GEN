import { describe, expect, it } from "vitest";
import { runSearch, type Deps } from "@/lib/pipeline";
import { emptyAudit } from "@/lib/enrich/crawl";
import { noStore } from "@/lib/prefill";
import type { ProgressEvent, RawPlace, SearchParams } from "@/lib/types";

const params = (over: Partial<SearchParams> = {}): SearchParams => ({
  sells: "website_development", categories: ["dentist"], city: "Vadodara", area: "Alkapuri", perCategory: 20,
  sources: { google: true, osm: false, apollo: false, instagram: false, facebook: false, web: false, gmaps: true },
  pageSpeed: false, verifyWebsites: false, webSearch: false, ...over,
});

function deps(release: Promise<void>, calls: { audits: string[] }): Deps {
  const gmapsPlaces: RawPlace[] = [
    { source: "gmaps", sourceId: "m1", name: "Aum Dental Care", category: "Dentist", city: "Vadodara", phone: "+91 98250 11111", rating: 4.8, reviews: 212, website: "https://aumdental.in" },
    { source: "gmaps", sourceId: "m2", name: "Late Smile Clinic", category: "Dentist", city: "Vadodara", phone: "+91 97000 33333", rating: 4.2, reviews: 40 },
  ];
  return {
    keys: { google: "k", gmapsScraper: "http://localhost:8090" }, store: noStore, revealMs: 0,
    google: async ({ category, city }) => ({ requests: 1, places: [{ source: "google", sourceId: "g1", name: "Aum Dental Care", category, city, phone: "+91 98250 11111" }] }),
    geocode: async () => ({ box: { south: 22.3, west: 73.1, north: 22.4, east: 73.2 }, via: "test" }),
    osm: async () => [],
    gmaps: async () => (await release, [{ category: "Dentist", places: gmapsPlaces }]),
    discover: async () => ({ tried: [] }),
    audit: async (w) => (calls.audits.push(w ?? "(none)"), w ? { ...emptyAudit("ok"), https: true, mobileViewport: true } : emptyAudit("none")),
    pageSpeed: async () => ({ score: 90 }), apollo: async () => null,
    social: async () => [], web: async () => ({ places: [], queries: 0, rejected: [] }), igLookup: async () => null, fbSearch: async () => [], checkCandidate: async () => ({ ok: false, evidence: "" }),
  };
}

describe("a slow Google Maps scraper doesn't hold up the search", () => {
  it("checks what the other sources found first, then adds the scraper's businesses", async () => {
    let open!: () => void;
    const release = new Promise<void>((r) => (open = r));
    const calls = { audits: [] as string[] };
    const events: ProgressEvent[] = [];
    const run = runSearch(params(), deps(release, calls), (e) => {
      events.push(e);
      // the Google result is checked while the scraper is still running; then the scraper finishes
      if (e.type === "lead") setTimeout(open, 5);
    });
    const r = await run;
    const firstLead = events.findIndex((e) => e.type === "lead");
    const lateList = events.findIndex((e, i) => i > firstLead && e.type === "leads");
    expect(firstLead).toBeGreaterThan(-1);
    expect(lateList).toBeGreaterThan(firstLead);
    expect(r.leads.map((l) => l.name).sort()).toEqual(["Aum Dental Care", "Late Smile Clinic"]);
    const aum = r.leads.find((l) => l.name === "Aum Dental Care")!;
    expect(aum).toMatchObject({ rating: 4.8, reviews: 212, website: "https://aumdental.in" });
    expect(aum.sources).toEqual(["google", "gmaps"]);
    expect(calls.audits).toContain("https://aumdental.in"); // its new website was checked
    expect(r.leads.every((l) => !l.pending)).toBe(true);
    const logs = events.filter((e) => e.type === "log").map((e) => (e as { message: string }).message);
    expect(logs.some((m) => /Checking the 1 results found so far/.test(m))).toBe(true);
    expect(logs.some((m) => /added 1 new business; 1 were already in the list/.test(m))).toBe(true);
  });

  it("waits for the scraper when it's the only source", async () => {
    const r = await runSearch(params({ sources: { ...params().sources, google: false } }), deps(new Promise((res) => setTimeout(res, 20)), { audits: [] }), () => {});
    expect(r.leads).toHaveLength(2);
  });

  it("stopping doesn't wait for the scraper", async () => {
    const ctrl = new AbortController();
    const started = Date.now();
    const run = runSearch(params({ sources: { ...params().sources, google: false } }), deps(new Promise(() => {}), { audits: [] }), () => {}, ctrl.signal);
    setTimeout(() => ctrl.abort(), 20);
    await run;
    expect(Date.now() - started).toBeLessThan(2000);
  });
});

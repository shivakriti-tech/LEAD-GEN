import { describe, expect, it } from "vitest";
import { runSearch, type Deps } from "@/lib/pipeline";
import { emptyAudit } from "@/lib/enrich/crawl";
import type { Lead, ProgressEvent, SearchRecord } from "@/lib/types";
import type { Store } from "@/lib/store";

const noSocial = {
  social: async () => [],
  web: async () => ({ places: [], queries: 0, rejected: [] }),
  gmaps: async () => [],
  igLookup: async () => null,
  fbSearch: async () => [],
  checkCandidate: async () => ({ ok: false, evidence: "" }),
};

function memStore(): Store & { data: Map<string, { search: SearchRecord; leads: Lead[] }> } {
  const data = new Map<string, { search: SearchRecord; leads: Lead[] }>();
  return {
    kind: "local", data,
    async saveSearch(s) { data.set(s.id, { search: structuredClone(s), leads: data.get(s.id)?.leads ?? [] }); },
    async saveLeads(id, leads) { data.get(id)!.leads = leads; },
    async listSearches() { return [...data.values()].map((x) => x.search); },
    async getSearch(id) { return data.get(id) ?? null; },
  };
}

describe("runSearch", () => {
  it("searches both sources, merges, audits, scores and saves", async () => {
    const store = memStore();
    const queries: string[] = [];
    const deps: Deps = {
      keys: { google: "test-key" },
      store,
      now: () => new Date("2026-09-22"),
      google: async ({ query, category, city }) => {
        queries.push(query);
        return {
          requests: 1,
          places: [
            { source: "google", sourceId: "g1", name: "Sharma Dental Care", category, city, phone: "+91 98220 12345", rating: 4.6, reviews: 212, lat: 18.5, lng: 73.8 },
            { source: "google", sourceId: "g2", name: "Smile Studio", category, city, phone: "+91 90000 22222", website: "https://smilestudio.in", rating: 4.1, reviews: 30 },
            { source: "google", sourceId: "g3", name: "Old Dental", category, city, businessStatus: "CLOSED_PERMANENTLY" },
          ],
        };
      },
      geocode: async () => ({ box: { south: 18.4, west: 73.7, north: 18.6, east: 73.9 }, via: "test" }),
      osm: async ({ category, city }) => [
        { source: "osm", sourceId: "node/1", name: "Sharma Dental", category, city, phone: "098220 12345", email: "info@sharmadental.in", lat: 18.5001, lng: 73.8001 },
      ],
      discover: async () => ({ tried: [] }),
      audit: async (w) => (w ? { ...emptyAudit("ok"), https: true, mobileViewport: false, copyrightYear: 2020, emails: ["hi@smilestudio.in"] } : emptyAudit("none")),
      pageSpeed: async () => ({ score: 35 }),
      apollo: async () => null, ...noSocial,
    };
    const events: ProgressEvent[] = [];
    const { search, leads } = await runSearch(
      { sells: "website_development", categories: ["dentist"], city: "Pune", area: "Kothrud", perCategory: 20, sources: { google: true, osm: true, apollo: false, instagram: false, facebook: false, web: false, gmaps: false }, pageSpeed: true, verifyWebsites: false, webSearch: false },
      deps,
      (e) => events.push(e),
    );

    expect(queries).toEqual(["dental clinic in Kothrud, Pune"]);
    expect(search.status).toBe("done");
    expect(search.counts).toMatchObject({ found: 4, afterDedupe: 2 });
    expect(leads.map((l) => l.name)).toEqual(["Sharma Dental Care", "Smile Studio"]);
    const sharma = leads[0];
    expect(sharma.sources.sort()).toEqual(["google", "osm"]);
    expect(sharma.email).toBe("info@sharmadental.in");
    expect(sharma.tier).toBe("hot");
    const smile = leads[1];
    expect(smile.audit?.pageSpeed?.score).toBe(35);
    expect(smile.signals.map((s) => s.key)).toEqual(expect.arrayContaining(["not_mobile", "slow", "stale"]));
    expect(store.data.get(search.id)!.leads).toHaveLength(2);
    expect(events.at(-1)).toMatchObject({ type: "log", message: expect.stringMatching(/^Done:/) });
  });

  it("skips Google without a key and keeps going when a source fails", async () => {
    const deps: Deps = {
      keys: {}, store: memStore(),
      google: async () => { throw new Error("should not be called"); },
      geocode: async () => ({ box: { south: 0, west: 0, north: 1, east: 1 }, via: "test" }),
      osm: async () => { throw new Error("Overpass 504"); },
      discover: async () => ({ tried: [] }),
      audit: async () => emptyAudit("none"), pageSpeed: async () => { throw new Error("off"); }, apollo: async () => null, ...noSocial,
    };
    const logs: string[] = [];
    const { search, leads } = await runSearch(
      { sells: "website_development", categories: ["dentist", "salon"], city: "Pune", perCategory: 10, sources: { google: true, osm: true, apollo: false, instagram: false, facebook: false, web: false, gmaps: false }, pageSpeed: false, verifyWebsites: false, webSearch: false },
      deps,
      (e) => { if (e.type === "log") logs.push(e.message); },
    );
    expect(search.status).toBe("done");
    expect(leads).toEqual([]);
    expect(logs.some((m) => /no API key/.test(m))).toBe(true);
    expect(logs.filter((m) => /Overpass 504/.test(m))).toHaveLength(2);
  });

  it("skips OpenStreetMap once, with one clear message, when the place can't be found", async () => {
    let osmCalls = 0;
    const deps: Deps = {
      keys: {}, store: memStore(),
      google: async () => ({ places: [], requests: 0 }),
      geocode: async () => { throw new Error("Couldn't locate \"Atlantis\": Nominatim 403"); },
      osm: async () => { osmCalls++; return []; },
      discover: async () => ({ tried: [] }),
      audit: async () => emptyAudit("none"), pageSpeed: async () => { throw new Error("off"); }, apollo: async () => null, ...noSocial,
    };
    const logs: string[] = [];
    const { search } = await runSearch(
      { sells: "website_development", categories: ["dentist", "salon", "cafe"], city: "Atlantis", perCategory: 10, sources: { google: false, osm: true, apollo: false, instagram: false, facebook: false, web: false, gmaps: false }, pageSpeed: false, verifyWebsites: false, webSearch: false },
      deps,
      (e) => { if (e.type === "log") logs.push(e.message); },
    );
    expect(osmCalls).toBe(0);
    expect(search.status).toBe("failed");
    expect(logs.filter((m) => /Nominatim 403/.test(m))).toHaveLength(1);
    expect(search.error).toMatch(/Check the city name/);
  });

  it("finds a website the map missed, marks chains, and reports PageSpeed errors", async () => {
    const discovered: string[] = [];
    const deps: Deps = {
      keys: { google: "k", pageSpeed: "bad" }, store: memStore(), now: () => new Date("2026-09-22"),
      google: async ({ category, city }) => ({ requests: 1, places: [
        { source: "google", sourceId: "a", name: "Tea Post", category, city, lat: 18.50, lng: 73.80, phone: "+91 90000 00001" },
        { source: "google", sourceId: "b", name: "Tea Post", category, city, lat: 18.60, lng: 73.90, phone: "+91 90000 00002" },
        { source: "google", sourceId: "c", name: "Chai Katta", category, city, lat: 18.52, lng: 73.81, phone: "+91 90000 00003" },
        { source: "google", sourceId: "d", name: "Nowhere Cafe", category, city, lat: 18.53, lng: 73.82, phone: "+91 90000 00004" },
      ] }),
      geocode: async () => ({ box: { south: 0, west: 0, north: 1, east: 1 }, via: "t" }),
      osm: async () => [],
      discover: async (l) => {
        discovered.push(l.name);
        return l.name === "Chai Katta"
          ? { website: "https://chaikatta.in/", via: "domain_guess" as const, evidence: "business name and phone number are on the page", tried: ["10 likely web addresses"] }
          : { tried: ["10 likely web addresses", "web search"] };
      },
      webSearch: async () => [],
      audit: async (w) => (w ? { ...emptyAudit("ok"), https: true, mobileViewport: true } : emptyAudit("none")),
      pageSpeed: async () => { throw new Error("PageSpeed 403: your key isn't allowed to use the PageSpeed Insights API."); },
      apollo: async () => null, ...noSocial,
    };
    const logs: string[] = [];
    const { leads } = await runSearch(
      { sells: "website_development", categories: ["cafe"], city: "Pune", perCategory: 20, sources: { google: true, osm: false, apollo: false, instagram: false, facebook: false, web: false, gmaps: false }, pageSpeed: true, verifyWebsites: true, webSearch: true },
      deps, (e) => { if (e.type === "log") logs.push(e.message); },
    );
    // chains aren't searched and score low
    expect(discovered.sort()).toEqual(["Chai Katta", "Nowhere Cafe"]);
    const tea = leads.filter((l) => l.name === "Tea Post");
    expect(tea).toHaveLength(2);
    expect(tea.every((l) => l.tier === "cold" && l.chain?.outlets === 2)).toBe(true);
    expect(tea[0].whyNow).toMatch(/part of a chain/);
    // found website is used, not "no website"
    const chai = leads.find((l) => l.name === "Chai Katta")!;
    expect(chai.website).toBe("https://chaikatta.in/");
    expect(chai.websiteCheck?.via).toBe("domain_guess");
    expect(chai.signals.some((s) => s.key === "no_website")).toBe(false);
    // a real "no website" lists what was checked
    const none = leads.find((l) => l.name === "Nowhere Cafe")!;
    expect(none.websiteCheck?.via).toBe("none_found");
    expect(none.websiteCheck?.tried).toEqual(["Google Maps listing", "10 likely web addresses", "web search"]);
    expect(none.score).toBe(60); // no website 55 + phone 5
    // PageSpeed failure is explained, once
    expect(logs.some((m) => /Mobile speed checked for 0 of 1/.test(m))).toBe(true);
    expect(logs.filter((m) => /isn't allowed to use the PageSpeed/.test(m))).toHaveLength(1);
  });

  it("flags well-known chains even when only one outlet is found", async () => {
    const deps: Deps = {
      keys: {}, store: memStore(),
      google: async () => ({ places: [], requests: 0 }),
      geocode: async () => ({ box: { south: 0, west: 0, north: 1, east: 1 }, via: "t" }),
      osm: async ({ category, city }) => [
        { source: "osm", sourceId: "n/1", name: "Pizza Hut", category, city },
        { source: "osm", sourceId: "n/2", name: "Hampton by Hilton Vadodara-Alkapuri", category, city },
        { source: "osm", sourceId: "n/3", name: "Caffein Restro", category, city },
      ],
      discover: async () => ({ tried: [] }),
      audit: async () => emptyAudit("none"), pageSpeed: async () => { throw new Error("off"); }, apollo: async () => null, ...noSocial,
    };
    const { leads } = await runSearch(
      { sells: "website_development", categories: ["cafe"], city: "Vadodara", perCategory: 10, sources: { google: false, osm: true, apollo: false, instagram: false, facebook: false, web: false, gmaps: false }, pageSpeed: false, verifyWebsites: true, webSearch: false },
      deps, () => {},
    );
    const chain = (n: string) => leads.find((l) => l.name.startsWith(n))!.chain?.reason;
    expect(chain("Pizza Hut")).toBe("a well-known chain");
    expect(chain("Hampton")).toBe("a well-known chain");
    expect(chain("Caffein")).toBeUndefined();
  });

  it("Instagram: finds profiles, reads them through the API, verifies a bio website and scores active accounts", async () => {
    const lookups: string[] = [];
    const deps: Deps = {
      keys: { metaToken: "t", igUserId: "1784" }, store: memStore(), now: () => new Date("2026-09-22"),
      webSearch: async () => [],
      google: async () => ({ places: [], requests: 0 }),
      geocode: async () => ({ box: { south: 0, west: 0, north: 1, east: 1 }, via: "t" }),
      osm: async () => [],
      web: async () => ({ places: [], queries: 0, rejected: [] }),
      gmaps: async () => [],
      social: async ({ platform, category, city }) => platform === "instagram" ? [
        { source: "instagram", sourceId: "royalfurniture.vdr", name: "royal furniture vdr", category, city, website: "https://www.instagram.com/royalfurniture.vdr/" },
        { source: "instagram", sourceId: "woodcraft_studio", name: "Woodcraft Studio", category, city, website: "https://www.instagram.com/woodcraft_studio/" },
        { source: "instagram", sourceId: "someone.personal", name: "Some One", category, city, website: "https://www.instagram.com/someone.personal/" },
      ] : [],
      igLookup: async ({ handle }) => {
        lookups.push(handle);
        if (handle === "royalfurniture.vdr") return { handle, name: "Royal Furniture", bio: "Custom sofas. Call 98250 12345", followers: 2350, posts: 410, lastPostAt: "2026-09-18T10:00:00+0000" };
        if (handle === "woodcraft_studio") return { handle, name: "Woodcraft Studio", bio: "Handmade tables", website: "https://woodcraftstudio.in", followers: 800, lastPostAt: "2026-09-01T10:00:00+0000" };
        return null;
      },
      fbSearch: async () => [],
      checkCandidate: async (url) => ({ ok: url.includes("woodcraftstudio.in"), finalUrl: "https://woodcraftstudio.in/", evidence: "business name and phone number are on the page" }),
      discover: async () => ({ tried: ["10 likely web addresses"] }),
      audit: async (w) => (w && !w.includes("instagram.com") ? { ...emptyAudit("ok"), https: true, mobileViewport: true } : w ? emptyAudit("social_only", { socials: { instagram: w } }) : emptyAudit("none")),
      pageSpeed: async () => { throw new Error("off"); },
      apollo: async () => null,
    };
    const logs: string[] = [];
    const { leads, search } = await runSearch(
      { sells: "website_development", categories: ["furniture"], city: "Vadodara", perCategory: 10, sources: { google: false, osm: false, apollo: false, instagram: true, facebook: false, web: false, gmaps: false }, pageSpeed: false, verifyWebsites: true, webSearch: true },
      deps, (e) => { if (e.type === "log") logs.push(e.message); },
    );
    expect(search.status).toBe("done");
    expect(lookups.sort()).toEqual(["royalfurniture.vdr", "someone.personal", "woodcraft_studio"]);
    const royal = leads.find((l) => l.social?.instagram?.handle === "royalfurniture.vdr")!;
    expect(royal.name).toBe("Royal Furniture");
    expect(royal.phones).toContain("+919825012345");
    expect(royal.signals.map((s) => s.key)).toEqual(expect.arrayContaining(["social_only", "ig_active", "has_phone"]));
    expect(royal.whyNow).toMatch(/2,350 Instagram followers and posts regularly, but has no website/);
    expect(royal.tier).toBe("hot");
    const wood = leads.find((l) => l.social?.instagram?.handle === "woodcraft_studio")!;
    expect(wood.website).toBe("https://woodcraftstudio.in/");
    expect(wood.websiteCheck?.via).toBe("instagram_bio");
    expect(wood.audit?.status).toBe("ok");
    expect(leads.find((l) => l.social?.instagram?.handle === "someone.personal")!.social!.instagram!.checked).toBe("not_business");
  });

  it("Instagram without a token: keeps the links and says what's missing", async () => {
    const deps: Deps = {
      keys: {}, store: memStore(), webSearch: async () => [],
      google: async () => ({ places: [], requests: 0 }),
      geocode: async () => ({ box: { south: 0, west: 0, north: 1, east: 1 }, via: "t" }),
      osm: async () => [],
      web: async () => ({ places: [], queries: 0, rejected: [] }),
      gmaps: async () => [],
      social: async ({ category, city }) => [{ source: "instagram", sourceId: "a.b", name: "A B Furniture", category, city, website: "https://www.instagram.com/a.b/" }],
      igLookup: async () => { throw new Error("should not be called"); },
      fbSearch: async () => [], checkCandidate: async () => ({ ok: false, evidence: "" }),
      discover: async () => ({ tried: [] }),
      audit: async (w) => (w ? emptyAudit("social_only", { socials: { instagram: w } }) : emptyAudit("none")),
      pageSpeed: async () => { throw new Error("off"); }, apollo: async () => null,
    };
    const logs: string[] = [];
    const { leads } = await runSearch(
      { sells: "website_development", categories: ["furniture"], city: "Vadodara", perCategory: 10, sources: { google: false, osm: false, apollo: false, instagram: true, facebook: false, web: false, gmaps: false }, pageSpeed: false, verifyWebsites: false, webSearch: false },
      deps, (e) => { if (e.type === "log") logs.push(e.message); },
    );
    expect(leads).toHaveLength(1);
    expect(leads[0].social?.instagram?.checked).toBe("link_only");
    expect(logs.some((m) => /Add META_ACCESS_TOKEN/.test(m))).toBe(true);
  });

  it("Google Maps scraper: merges its results with the map and skips it when not available", async () => {
    const base = {
      store: memStore(), now: () => new Date("2026-09-24"),
      google: async () => ({ places: [], requests: 0 }),
      geocode: async () => ({ box: { south: 0, west: 0, north: 1, east: 1 }, via: "t" }),
      osm: async ({ category, city }: any) => [{ source: "osm" as const, sourceId: "n/1", name: "Kala Furnishers", category, city, lat: 22.3, lng: 73.18 }],
      discover: async () => ({ tried: [] }),
      audit: async () => emptyAudit("none"), pageSpeed: async () => { throw new Error("off"); }, apollo: async () => null,
      ...noSocial,
    };
    const calls: any[] = [];
    const deps: Deps = {
      ...base,
      keys: { gmapsScraper: "http://localhost:8090" },
      gmaps: async (o) => {
        calls.push(o);
        return [{ category: "Furniture shop", places: [
          { source: "gmaps", sourceId: "ChIJ1", name: "Kala Furnishers", category: "Furniture shop", city: "Vadodara", lat: 22.3001, lng: 73.1801, phone: "+91 90990 12345", rating: 4.6, reviews: 120, mapsUrl: "https://maps.google.com/?cid=1" },
          { source: "gmaps", sourceId: "ChIJ2", name: "Old Wood Works", category: "Furniture shop", city: "Vadodara", businessStatus: "CLOSED_PERMANENTLY" },
        ] }];
      },
    };
    const logs: string[] = [];
    const { leads } = await runSearch(
      { sells: "website_development", categories: ["furniture"], city: "Vadodara", perCategory: 20, sources: { google: false, osm: true, apollo: false, instagram: false, facebook: false, web: false, gmaps: true }, pageSpeed: false, verifyWebsites: false, webSearch: false },
      deps, (e) => { if (e.type === "log") logs.push(e.message); },
    );
    expect(calls[0].requests).toEqual([{ category: "Furniture shop", keyword: "furniture shop in Vadodara" }]);
    expect(leads).toHaveLength(1);
    expect(leads[0].sources.sort()).toEqual(["gmaps", "osm"]);
    expect(leads[0].phone).toBe("+919099012345");
    expect(leads[0].reviews).toBe(120);
    expect(logs.some((m) => /Google Maps scraper: 2 × Furniture shop/.test(m))).toBe(true);

    const logs2: string[] = [];
    await runSearch(
      { sells: "website_development", categories: ["furniture"], city: "Vadodara", perCategory: 20, sources: { google: false, osm: true, apollo: false, instagram: false, facebook: false, web: false, gmaps: true }, pageSpeed: false, verifyWebsites: false, webSearch: false },
      { ...base, store: memStore(), keys: {}, gmaps: async () => { throw new Error("should not run"); } },
      (e) => { if (e.type === "log") logs2.push(e.message); },
    );
    expect(logs2.some((m) => /scraper is on but not available/.test(m))).toBe(true);
  });
});

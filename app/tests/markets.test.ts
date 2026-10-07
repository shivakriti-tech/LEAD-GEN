import { afterEach, describe, expect, it, vi } from "vitest";
import { inOfficeHours, marketOf, zoneFor } from "@/lib/markets";
import { currentCountry, withCountry } from "@/lib/marketContext";
import { serperSearch } from "@/lib/enrich/searchProviders";
import { runSearch, type Deps } from "@/lib/pipeline";
import { emptyAudit } from "@/lib/enrich/crawl";
import { noStore } from "@/lib/prefill";
import type { SearchParams } from "@/lib/types";

afterEach(() => vi.unstubAllGlobals());

describe("countries", () => {
  it("knows each country's time zones and working week", () => {
    expect(zoneFor("US", -95.37)).toBe("America/Chicago"); // Houston
    expect(zoneFor("US", -118.24)).toBe("America/Los_Angeles");
    expect(zoneFor("AU", 115.86)).toBe("Australia/Perth");
    expect(zoneFor("AE")).toBe("Asia/Dubai");
    // Monday 10:00 in Houston is office hours there; the same moment is 20:30 in India
    const houstonMon10 = new Date("2026-10-05T15:00:00Z");
    expect(inOfficeHours(houstonMon10, "US", -95.37)).toBe(true);
    expect(inOfficeHours(houstonMon10, "IN")).toBe(false);
    // Sunday is a working day in Saudi Arabia, Friday isn't
    expect(inOfficeHours(new Date("2026-10-04T07:00:00Z"), "SA")).toBe(true);
    expect(inOfficeHours(new Date("2026-10-09T07:00:00Z"), "SA")).toBe(false);
    expect(marketOf("xx").code).toBe("IN");
  });

  it("search engines are asked for results in the search's country", async () => {
    let body = "";
    vi.stubGlobal("fetch", async (_u: string, init: RequestInit) => ((body = String(init.body)), new Response(JSON.stringify({ organic: [] }))));
    await withCountry("AE", () => serperSearch("logistics company Dubai", "k"));
    expect(JSON.parse(body).gl).toBe("ae");
    await serperSearch("x", "k");
    expect(JSON.parse(body).gl).toBe("in"); // outside a search: India, as before
  });

  it("a US search reads US numbers, tags leads with the country, and each lookup sees it", async () => {
    const seen: string[] = [];
    const deps: Deps = {
      keys: { google: "k" }, store: noStore, revealMs: 0, previewMs: 0,
      google: async ({ category, city }) => (seen.push(currentCountry()), { requests: 1, places: [{ source: "google", sourceId: "g1", name: "Lone Star Freight", category, city, phone: "(713) 555-0100", website: "https://lonestarfreight.com" }] }),
      geocode: async () => (seen.push(currentCountry()), { box: { south: 29.6, west: -95.5, north: 29.9, east: -95.2 }, via: "test" }),
      osm: async () => [],
      discover: async () => ({ tried: [] }),
      audit: async () => (seen.push(currentCountry()), { ...emptyAudit("ok"), https: true, mobileViewport: true }),
      pageSpeed: async () => ({ score: 90 }), apollo: async () => null, social: async () => [], web: async () => ({ places: [], queries: 0, rejected: [] }), gmaps: async () => [], igLookup: async () => null, fbSearch: async () => [], checkCandidate: async () => ({ ok: false, evidence: "" }),
    };
    const params: SearchParams = { sells: "website_development", categories: ["dentist"], city: "Houston", perCategory: 20, country: "US", sources: { google: true, osm: false, apollo: false, instagram: false, facebook: false, web: false, gmaps: false }, pageSpeed: false, verifyWebsites: false, webSearch: false };
    const r = await runSearch(params, deps, () => {});
    expect(seen.every((c) => c === "US")).toBe(true);
    expect(r.leads[0]).toMatchObject({ country: "US", phone: "+17135550100" });
    expect(currentCountry()).toBe("IN");
  });
});

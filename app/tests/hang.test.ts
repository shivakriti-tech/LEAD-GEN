import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import { emptyAudit } from "@/lib/enrich/crawl";
import { runSearch, type Deps } from "@/lib/pipeline";
import { fetchWithTimeout } from "@/lib/util";
import type { Lead, ProgressEvent, SearchRecord } from "@/lib/types";
import type { Store } from "@/lib/store";

const store = (): Store => {
  const data = new Map<string, { search: SearchRecord; leads: Lead[] }>();
  return {
    kind: "local",
    async saveSearch(s) { data.set(s.id, { search: structuredClone(s), leads: data.get(s.id)?.leads ?? [] }); },
    async saveLeads(id, leads) { data.get(id)!.leads = structuredClone(leads); },
    async listSearches() { return [...data.values()].map((x) => x.search); },
    async getSearch(id) { return data.get(id) ?? null; },
    async updateFollowUps() { return []; },
    async deleteLeads() { return 0; },
  };
};

describe("searches never hang", () => {
  it("times out a site that sends headers and then stalls the page", async () => {
    const server = createServer((_, res) => { res.writeHead(200, { "content-type": "text/html" }); res.write("<html>"); /* never ends */ });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    try {
      const { port } = server.address() as AddressInfo;
      const res = await fetchWithTimeout(`http://127.0.0.1:${port}/`, {}, 300);
      const t0 = Date.now();
      await expect(res.text()).rejects.toThrow();
      expect(Date.now() - t0).toBeLessThan(2000);
    } finally {
      server.closeAllConnections();
      server.close();
    }
  });

  it("moves on when one source never answers, keeping everything else", async () => {
    const deps: Deps = {
      keys: {}, store: store(), jobTimeoutMs: 100,
      google: async () => ({ requests: 0, places: [] }),
      osm: async () => [{ source: "osm", sourceId: "n/1", name: "Bright Smile Dental", category: "Dentist", city: "Vadodara", phone: "+919825012345" }],
      geocode: async () => ({ box: { south: 0, west: 0, north: 1, east: 1 }, via: "t" }),
      discover: async () => ({ tried: [] }),
      audit: async () => emptyAudit("none"),
      pageSpeed: async () => ({ score: 0 }), apollo: async () => null,
      social: async () => [], web: () => new Promise(() => {}), gmaps: async () => [],
      igLookup: async () => null, fbSearch: async () => [], checkCandidate: async () => ({ ok: false, evidence: "" }),
      webSearch: async () => [],
    };
    const events: ProgressEvent[] = [];
    const { search, leads } = await runSearch(
      { sells: "website_development", categories: ["dentist"], city: "Vadodara", perCategory: 10, sources: { google: false, osm: true, apollo: false, instagram: false, facebook: false, web: true, gmaps: false }, pageSpeed: false, verifyWebsites: false, webSearch: false },
      deps, (e) => events.push(e),
    );
    expect(search.status).toBe("done");
    expect(leads.map((l) => l.name)).toEqual(["Bright Smile Dental"]);
    expect(events.some((e) => e.type === "log" && /failed for Dentist: no answer after/.test(e.message))).toBe(true);
  });
});

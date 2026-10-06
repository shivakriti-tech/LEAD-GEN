import { describe, expect, it } from "vitest";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { runSearch, type Deps } from "@/lib/pipeline";
import { discoverWebsite } from "@/lib/enrich/discover";
import { emptyAudit } from "@/lib/enrich/crawl";
import { mergePlaces } from "@/lib/dedupe";
import { fetchWithTimeout } from "@/lib/util";
import type { Lead, ProgressEvent, SearchRecord } from "@/lib/types";
import type { Store } from "@/lib/store";

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

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

describe("search speed", () => {
  it("fetchWithTimeout's limit covers a page that trickles in after its headers", async () => {
    const server = createServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.write("<html>");
      // never finishes the page
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const { port } = server.address() as AddressInfo;
    try {
      const started = Date.now();
      const res = await fetchWithTimeout(`http://127.0.0.1:${port}/`, {}, 300);
      await expect(res.text()).rejects.toThrow();
      expect(Date.now() - started).toBeLessThan(3000);
    } finally {
      server.closeAllConnections();
      server.close();
    }
  });

  it("loads the top search results at the same time, and still prefers the first that is theirs", async () => {
    const lead = mergePlaces([{ source: "google", sourceId: "x", name: "Kavya Sweets", category: "Bakery", city: "Pune", phone: "+91 90000 12345" } as any])[0];
    let inFlight = 0, most = 0;
    const fetchHtml = async (url: string) => {
      inFlight++;
      most = Math.max(most, inFlight);
      await wait(50);
      inFlight--;
      if (!url.includes("kavya")) return null;
      return { html: `<html><head><title>Kavya Sweets</title></head><body>Call 90000 12345</body></html>`, finalUrl: url };
    };
    const r = await discoverWebsite(lead, undefined, {
      fetchHtml,
      resolves: async () => false, // no guessed address exists
      search: async () => [
        { url: "https://one.example/", title: "a" },
        { url: "https://kavyasweets.in/", title: "Kavya Sweets" },
        { url: "https://kavyasweets-pune.com/", title: "Kavya Sweets Pune" },
      ],
    });
    expect(most).toBe(3);
    expect(r.website).toBe("https://kavyasweets.in/");
  });

  it("tests mobile speed while other businesses are still being checked", async () => {
    const order: string[] = [];
    const deps: Deps = {
      keys: { google: "k", pageSpeed: "p" },
      store: memStore(),
      now: () => new Date("2026-09-22"),
      google: async ({ category, city }) => ({
        requests: 1,
        places: Array.from({ length: 4 }, (_, i) => ({ source: "google" as const, sourceId: `g${i}`, name: `Shop ${"ABCD"[i]}`, category, city, website: `https://shop${i}.in`, phone: `+91 9000${i}12345` })),
      }),
      geocode: async () => ({ box: { south: 0, west: 0, north: 1, east: 1 }, via: "test" }),
      osm: async () => [],
      discover: async () => ({ tried: [] }),
      audit: async (w) => {
        await wait(w === "https://shop0.in" ? 0 : 40);
        order.push(`audit ${w}`);
        return { ...emptyAudit("ok"), finalUrl: w };
      },
      pageSpeed: async (u) => {
        order.push(`speed ${u}`);
        return { score: 40 };
      },
      apollo: async () => null,
      social: async () => [], web: async () => ({ places: [], queries: 0, rejected: [] }), gmaps: async () => [], igLookup: async () => null, fbSearch: async () => [], checkCandidate: async () => ({ ok: false, evidence: "" }),
      concurrency: 1,
    };
    const events: ProgressEvent[] = [];
    const { leads } = await runSearch(
      { sells: "website_development", categories: ["dentist"], city: "Pune", perCategory: 20, sources: { google: true, osm: false, apollo: false, instagram: false, facebook: false, web: false, gmaps: false }, pageSpeed: true, verifyWebsites: false, webSearch: false },
      deps,
      (e) => events.push(e),
    );
    // the first site's speed test started before the last site was checked
    expect(order.indexOf("speed https://shop0.in")).toBeLessThan(order.indexOf("audit https://shop3.in"));
    expect(leads.every((l) => l.audit?.pageSpeed?.score === 40)).toBe(true);
    expect(order.filter((x) => x.startsWith("speed"))).toHaveLength(4);
    expect(events.some((e) => e.type === "log" && /Mobile speed checked for 4 of 4/.test(e.message))).toBe(true);
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { capBox, overpass } from "@/lib/sources/osm";
import { runPrefill } from "@/lib/prefill";
import { runSearch, type Deps } from "@/lib/pipeline";
import { memoryDirectory } from "@/lib/directory";
import { emptyAudit } from "@/lib/enrich/crawl";
import { noStore } from "@/lib/prefill";

const EPS = ["https://a.test/api/interpreter", "https://b.test/api/interpreter"];
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const node = { type: "node", id: 1, lat: 22.3, lon: 73.1, tags: { name: "Aum Dental" } };

afterEach(() => vi.unstubAllGlobals());

describe("Overpass (OpenStreetMap) when servers are busy", () => {
  it("treats a 'runtime error' answer with no data as busy and tries the next server", async () => {
    const hosts: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      hosts.push(new URL(url).host);
      return hosts.length === 1 ? json({ elements: [], remark: "runtime error: Query timed out in \"query\" at line 1 after 41 seconds." }) : json({ elements: [node] });
    });
    const els = await overpass("q", { endpoints: EPS, sleep: async () => {} });
    expect(els).toHaveLength(1);
    expect(hosts).toHaveLength(2);
    expect(new Set(hosts).size).toBe(2);
  });

  it("waits and tries every server once more, then says the servers are busy", async () => {
    let calls = 0;
    const sleeps: number[] = [];
    vi.stubGlobal("fetch", async () => (calls++, json({ error: "x" }, calls % 2 ? 429 : 504)));
    await expect(overpass("q", { endpoints: EPS, sleep: async (ms) => void sleeps.push(ms) })).rejects.toThrow(/map servers are busy \(.*too many requests.*busy/);
    expect(calls).toBe(4);
    expect(sleeps).toEqual([10_000]);
  });

  it("recovers on the second round", async () => {
    let calls = 0;
    vi.stubGlobal("fetch", async () => (++calls <= 2 ? json({}, 504) : json({ elements: [node, node] })));
    expect(await overpass("q", { endpoints: EPS, sleep: async () => {} })).toHaveLength(2);
  });

  it("races the servers: a hanging one doesn't hold the answer up, and is cancelled", async () => {
    let aborted = false;
    vi.stubGlobal("fetch", (url: string, init: RequestInit) =>
      new URL(url).host === "a.test"
        ? new Promise((_, reject) => init.signal?.addEventListener("abort", () => ((aborted = true), reject(new Error("aborted")))))
        : Promise.resolve(json({ elements: [node] })),
    );
    // queries start on alternating servers, so one of two runs starts on the hanging one
    for (let i = 0; i < 2; i++) {
      const t = Date.now();
      expect(await overpass("q", { endpoints: EPS, sleep: async () => {}, hedgeMs: 50, timeoutMs: 10_000 })).toHaveLength(1);
      expect(Date.now() - t).toBeLessThan(2000);
    }
    expect(aborted).toBe(true);
  });

  it("an empty answer without a remark is a real 'nothing here'", async () => {
    vi.stubGlobal("fetch", async () => json({ elements: [] }));
    expect(await overpass("q", { endpoints: EPS, sleep: async () => {} })).toEqual([]);
  });

  it("widens a neighbourhood the geocoder only knows as a point", () => {
    const b = capBox({ south: 22.31, north: 22.3102, west: 73.17, east: 73.1701 });
    expect(b.north - b.south).toBeCloseTo(0.024, 5);
    expect(b.east - b.west).toBeCloseTo(0.024, 5);
    const big = capBox({ south: 22.2, north: 22.4, west: 73.1, east: 73.3 });
    expect(big).toEqual({ south: 22.2, north: 22.4, west: 73.1, east: 73.3 });
  });
});

function deps(osmFails: (cat: string) => boolean): Deps {
  return {
    keys: { google: "k" }, store: noStore, revealMs: 0, now: () => new Date("2026-09-29T10:00:00Z"),
    google: async ({ category, city }) => ({ requests: 1, places: [{ source: "google", sourceId: `g-${category}`, name: `${category} One`, category, city, phone: `+91 98250 ${String(category.length).padStart(5, "1")}` }] }),
    geocode: async () => ({ box: { south: 22.3, west: 73.1, north: 22.4, east: 73.2 }, via: "test" }),
    osm: async ({ category }) => { if (osmFails(category)) throw new Error("map servers are busy"); return []; },
    discover: async () => ({ tried: [] }), audit: async () => emptyAudit("none"), pageSpeed: async () => ({ score: 90 }), apollo: async () => null,
    social: async () => [], web: async () => ({ places: [], queries: 0, rejected: [] }), gmaps: async () => [], igLookup: async () => null, fbSearch: async () => [], checkCandidate: async () => ({ ok: false, evidence: "" }),
  };
}

describe("busy map servers during a search and a prefill", () => {
  it("doesn't record the map as searched for a type whose map listing failed", async () => {
    const directory = memoryDirectory();
    const sources = { google: true, osm: true, apollo: false, instagram: false, facebook: false, web: false, gmaps: false };
    await runSearch({ sells: "website_development", categories: ["dentist", "salon"], city: "Vadodara", area: "Gotri", perCategory: 20, sources, pageSpeed: false, verifyWebsites: false, webSearch: false }, { ...deps((c) => c === "Dentist"), directory }, () => {});
    expect((await directory.get("Vadodara", "Gotri", "dentist"))!.sources).toEqual(["google"]);
    expect((await directory.get("Vadodara", "Gotri", "salon"))!.sources).toEqual(["google", "osm"]);
  });

  it("counts the types it missed and waits when most map listings fail", async () => {
    const lines: string[] = [];
    const r = await runPrefill({
      city: "Vadodara", deps: deps(() => true), sources: { osm: true, web: false, google: true }, log: (m) => lines.push(m), pauseMs: 0, busyPauseMs: 0,
      jobs: [{ offer: "website_development", area: "Gotri", categories: ["dentist", "salon", "gym"] }, { offer: "website_development", area: "Sama", categories: ["cafe"] }],
    });
    expect(r.missed).toBe(4);
    expect(lines.some((l) => /overloaded: waiting a minute/.test(l))).toBe(true);
  });
});

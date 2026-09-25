import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("geocodeBBox fallbacks", () => {
  it("falls back to Photon when Nominatim returns 403", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      calls.push(new URL(url).hostname);
      if (url.includes("nominatim")) return new Response("blocked", { status: 403 });
      return json({ features: [{ geometry: { coordinates: [73.807, 18.507] }, properties: { type: "district", countrycode: "IN", extent: [73.78, 18.53, 73.83, 18.49] } }] });
    });
    const { geocodeBBox } = await import("@/lib/sources/osm");
    const warns: string[] = [];
    const r = await geocodeBBox("Kothrud, Pune", (m) => warns.push(m));
    expect(r.via).toBe("Photon");
    expect(r.box).toEqual({ west: 73.78, north: 18.53, east: 73.83, south: 18.49 });
    expect(calls).toEqual(["nominatim.openstreetmap.org", "photon.komoot.io"]);
    expect(warns[0]).toMatch(/Nominatim 403/);
  });

  it("uses the built-in city list when both geocoders are down", async () => {
    vi.stubGlobal("fetch", async () => { throw new Error("offline"); });
    const { geocodeBBox } = await import("@/lib/sources/osm");
    const r = await geocodeBBox("Pune");
    expect(r.via).toBe("built-in city list");
    expect(r.box.south).toBeCloseTo(18.3704);
    expect(r.box.north).toBeCloseTo(18.6704);
  });

  it("caches the answer so a search looks the place up once", async () => {
    let n = 0;
    vi.stubGlobal("fetch", async () => { n++; return json([{ boundingbox: ["18.4", "18.6", "73.7", "73.9"] }]); });
    const { geocodeBBox } = await import("@/lib/sources/osm");
    await geocodeBBox("Pune");
    await geocodeBBox("pune ");
    expect(n).toBe(1);
  });

  it("fails clearly for an unknown place", async () => {
    vi.stubGlobal("fetch", async (url: string) => (url.includes("nominatim") ? json([]) : json({ features: [] })));
    const { geocodeBBox } = await import("@/lib/sources/osm");
    await expect(geocodeBBox("Atlantis")).rejects.toThrow(/Couldn't locate "Atlantis"/);
  });
});

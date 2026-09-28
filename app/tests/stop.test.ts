import { describe, expect, it } from "vitest";
import { emptyAudit } from "@/lib/enrich/crawl";
import { runSearch, type Deps } from "@/lib/pipeline";
import { live, settle, track } from "@/lib/live";
import type { Lead, ProgressEvent, SearchRecord } from "@/lib/types";
import type { Store } from "@/lib/store";

function memStore() {
  const data = new Map<string, { search: SearchRecord; leads: Lead[] }>();
  const store: Store = {
    kind: "local",
    async saveSearch(s) { data.set(s.id, { search: structuredClone(s), leads: data.get(s.id)?.leads ?? [] }); },
    async saveLeads(id, leads) { data.get(id)!.leads = structuredClone(leads); },
    async listSearches() { return [...data.values()].map((x) => x.search); },
    async getSearch(id) { return data.get(id) ?? null; },
    async updateLead() { return null; },
  };
  return { store, data };
}

describe("stopping a search", () => {
  it("keeps what's checked, marks the rest not checked, and saves it as stopped", async () => {
    const { store, data } = memStore();
    const ctrl = new AbortController();
    let audits = 0;
    const places = Array.from({ length: 30 }, (_, i) => ({ source: "osm" as const, sourceId: `n/${i}`, name: `Clinic Number ${i}`, category: "Dentist", city: "Vadodara", phone: `+9198250${String(10000 + i)}` }));
    const deps: Deps = {
      keys: {}, store,
      google: async () => ({ requests: 0, places: [] }),
      osm: async () => places,
      geocode: async () => ({ box: { south: 0, west: 0, north: 1, east: 1 }, via: "t" }),
      discover: async () => ({ tried: [] }),
      audit: async () => { if (++audits === 10) ctrl.abort(); await new Promise((r) => setTimeout(r, 2)); return emptyAudit("none"); },
      pageSpeed: async () => ({ score: 0 }), apollo: async () => null,
      social: async () => [], web: async () => ({ places: [], queries: 0, rejected: [] }), gmaps: async () => [],
      igLookup: async () => null, fbSearch: async () => [], checkCandidate: async () => ({ ok: false, evidence: "" }),
    };
    const events: ProgressEvent[] = [];
    const { search, leads } = await runSearch(
      { sells: "website_development", categories: ["dentist"], city: "Vadodara", perCategory: 60, sources: { google: false, osm: true, apollo: false, instagram: false, facebook: false, web: false, gmaps: false }, pageSpeed: false, verifyWebsites: true, webSearch: false },
      deps, (e) => events.push(e), ctrl.signal,
    );
    expect(search.status).toBe("stopped");
    expect(audits).toBeLessThan(30);
    const checked = leads.filter((l) => !l.pending);
    expect(checked.length).toBe(audits);
    expect(leads).toHaveLength(30); // nothing lost
    expect(leads.slice(0, checked.length).every((l) => !l.pending)).toBe(true); // checked ones first
    expect(search.counts.hot + search.counts.warm + search.counts.cold).toBe(checked.length);
    expect(data.get(search.id)!.search.status).toBe("stopped");
    expect(data.get(search.id)!.leads).toHaveLength(30);
    expect(events.some((e) => e.type === "log" && /^Stopped: \d+ of 30/.test(e.message))).toBe(true);
  });
});

describe("live searches", () => {
  it("tracks a running search's log and progress, and forgets it when it ends", () => {
    const ctrl = new AbortController();
    const emit = track(ctrl, () => {});
    emit({ type: "start", searchId: "s-live" });
    emit({ type: "log", level: "info", message: "Google Maps: 20 × Dentist" });
    emit({ type: "stage", stage: "enrich", done: 3, total: 20 });
    expect(live.get("s-live")).toMatchObject({ logs: [{ message: "Google Maps: 20 × Dentist" }], stage: { done: 3, total: 20 } });
    emit.end();
    expect(live.has("s-live")).toBe(false);
  });

  it("a search saved as running that this server isn't working on is shown and saved as stopped", async () => {
    const { store, data } = memStore();
    const s: SearchRecord = { id: "old", createdAt: "2026-09-22T10:00:00Z", params: {} as SearchRecord["params"], status: "running", counts: { found: 0, afterDedupe: 4, hot: 0, warm: 0, cold: 0 } };
    await store.saveSearch(s);
    expect((await settle(s, store)).status).toBe("stopped");
    expect(data.get("old")!.search.status).toBe("stopped");
    // one this server is running is left alone
    live.set("busy", { ctrl: new AbortController(), logs: [] });
    expect((await settle({ ...s, id: "busy" }, store)).status).toBe("running");
    live.delete("busy");
  });
});

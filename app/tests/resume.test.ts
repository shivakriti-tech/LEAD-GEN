import { describe, expect, it } from "vitest";
import { runSearch, resumeCount, type Deps } from "@/lib/pipeline";
import { emptyAudit } from "@/lib/enrich/crawl";
import { noStore } from "@/lib/prefill";
import type { Lead, ProgressEvent, SearchParams, SearchRecord } from "@/lib/types";

const params: SearchParams = {
  sells: "website_development", categories: ["dentist"], city: "Vadodara", perCategory: 20,
  sources: { google: true, osm: false, apollo: false, instagram: false, facebook: false, web: false, gmaps: false },
  pageSpeed: false, verifyWebsites: false, webSearch: false,
};

const lead = (id: string, name: string, pending: boolean): Lead =>
  ({ id, name, category: "Dentist", city: "Vadodara", phones: [], emails: [], sources: ["google"], score: 0, tier: "cold", reasons: [], pending, ...(pending ? {} : { checkedAt: new Date().toISOString() }) }) as unknown as Lead;

describe("resuming a search after a restart", () => {
  it("keeps the id, skips the sources and only checks businesses still pending", async () => {
    const audits: string[] = [];
    const sourceCalls = { n: 0 };
    const d = {
      keys: { google: "k" }, store: noStore, revealMs: 0,
      google: async () => (sourceCalls.n++, { requests: 1, places: [] }),
      geocode: async () => ({ box: { south: 0, west: 0, north: 1, east: 1 }, via: "t" }),
      osm: async () => (sourceCalls.n++, []),
      discover: async () => ({ tried: [] }),
      audit: async (w?: string) => (audits.push(w ?? "(none)"), emptyAudit("none")),
      pageSpeed: async () => ({ score: 1 }), apollo: async () => null,
    } as unknown as Deps;
    const search: SearchRecord = { id: "11111111-1111-1111-1111-111111111111", createdAt: "2026-10-08T00:00:00Z", params, status: "running", counts: { found: 3, afterDedupe: 3, hot: 0, warm: 0, cold: 0 } };
    const done = lead("a", "Done Dental", false);
    const events: ProgressEvent[] = [];
    const r = await runSearch(params, d, (e) => events.push(e), undefined, { search, leads: [done, lead("b", "Pending One", true), lead("c", "Pending Two", true)] });
    expect(r.search.id).toBe(search.id);
    expect(r.search.status).toBe("done");
    expect(sourceCalls.n).toBe(0);
    expect(r.leads).toHaveLength(3);
    expect(r.leads.every((l) => !l.pending)).toBe(true);
    expect(audits).toHaveLength(2); // only the two pending ones
    expect(r.leads.find((l) => l.id === "a")!.checkedAt).toBe(done.checkedAt);
  });

  it("starts over with the same id when nothing was saved", async () => {
    const d = {
      keys: { google: "k" }, store: noStore, revealMs: 0,
      google: async () => ({ requests: 1, places: [{ source: "google", sourceId: "g1", name: "New Dental", category: "Dentist", city: "Vadodara" }] }),
      geocode: async () => ({ box: { south: 0, west: 0, north: 1, east: 1 }, via: "t" }),
      osm: async () => [], discover: async () => ({ tried: [] }), audit: async () => emptyAudit("none"),
      pageSpeed: async () => ({ score: 1 }), apollo: async () => null,
    } as unknown as Deps;
    const search: SearchRecord = { id: "22222222-2222-2222-2222-222222222222", createdAt: "2026-10-08T00:00:00Z", params, status: "stopped", counts: { found: 0, afterDedupe: 0, hot: 0, warm: 0, cold: 0 }, error: "Resumed after a restart (1)" };
    const r = await runSearch(params, d, () => {}, undefined, { search, leads: [] });
    expect(r.search.id).toBe(search.id);
    expect(r.leads.map((l) => l.name)).toEqual(["New Dental"]);
    expect(resumeCount("Resumed after a restart (2)")).toBe(2);
  });
});

import { describe, expect, it } from "vitest";
import { runSearch, type Deps } from "@/lib/pipeline";
import { emptyAudit } from "@/lib/enrich/crawl";
import { memoryDirectory, whatChanged } from "@/lib/directory";
import { prefillPlan, noStore } from "@/lib/prefill";
import type { ProgressEvent, SearchParams } from "@/lib/types";

const params = (over: Partial<SearchParams> = {}): SearchParams => ({
  sells: "website_development", categories: ["dentist"], city: "Vadodara", area: "Alkapuri", perCategory: 20,
  sources: { google: true, osm: true, apollo: false, instagram: false, facebook: false, web: false, gmaps: false },
  pageSpeed: false, verifyWebsites: false, webSearch: false, ...over,
});

function deps(now: string, calls: { google: number; osm: number; audits: string[] }, opts: { osmExtra?: boolean; site?: (w?: string) => ReturnType<typeof emptyAudit> } = {}): Deps {
  return {
    keys: { google: "k" },
    store: noStore,
    now: () => new Date(now),
    revealMs: 0,
    google: async ({ category, city }) => {
      calls.google++;
      return { requests: 1, places: [
        { source: "google", sourceId: "g1", name: "Aum Dental Care", category, city, phone: "+91 98250 11111", rating: 4.8, reviews: 212 },
        { source: "google", sourceId: "g2", name: "Smile Studio", category, city, phone: "+91 90000 22222", website: "https://smilestudio.in" },
      ] };
    },
    geocode: async () => ({ box: { south: 22.3, west: 73.1, north: 22.4, east: 73.2 }, via: "test" }),
    osm: async ({ category, city }) => {
      calls.osm++;
      return opts.osmExtra ? [{ source: "osm", sourceId: "node/9", name: "New Tooth Clinic", category, city, phone: "+91 97000 33333" }] : [];
    },
    discover: async () => ({ tried: [] }),
    audit: async (w) => {
      calls.audits.push(w ?? "(none)");
      return opts.site ? opts.site(w) : w ? { ...emptyAudit("ok"), https: true, mobileViewport: true } : emptyAudit("none");
    },
    pageSpeed: async () => ({ score: 90 }),
    apollo: async () => null,
    social: async () => [], web: async () => ({ places: [], queries: 0, rejected: [] }), gmaps: async () => [], igLookup: async () => null, fbSearch: async () => [], checkCandidate: async () => ({ ok: false, evidence: "" }),
  };
}

describe("the saved lead directory", () => {
  it("saves what a search finds, and the next search starts from it (only a free map top-up runs live)", async () => {
    const directory = memoryDirectory();
    const c1 = { google: 0, osm: 0, audits: [] as string[] };
    const first = await runSearch(params(), { ...deps("2026-09-20T10:00:00Z", c1), directory }, () => {});
    expect(first.leads).toHaveLength(2);
    expect(c1.google).toBe(1);
    const entry = await directory.get("Vadodara", "Alkapuri", "dentist");
    expect(entry?.leads.map((l) => l.name).sort()).toEqual(["Aum Dental Care", "Smile Studio"]);
    expect(entry?.sources).toEqual(["google", "osm"]);
    expect(entry?.leads[0].followUp).toBeUndefined();

    // three days later: saved data is used, Google isn't called, nothing needs a recheck, a new place is added
    const c2 = { google: 0, osm: 0, audits: [] as string[] };
    const events: ProgressEvent[] = [];
    const second = await runSearch(params(), { ...deps("2026-09-23T10:00:00Z", c2, { osmExtra: true }), directory }, (e) => events.push(e));
    expect(c2.google).toBe(0);
    expect(c2.osm).toBe(1);
    expect([...new Set(c2.audits)]).toEqual(["(none)"]); // only the new business is checked
    expect(second.leads.map((l) => l.name).sort()).toEqual(["Aum Dental Care", "New Tooth Clinic", "Smile Studio"]);
    expect(second.leads.find((l) => l.name === "Aum Dental Care")!.saved).toBe(true);
    const logs = events.filter((e) => e.type === "log").map((e) => (e as { message: string }).message);
    expect(logs.some((m) => /Found saved data for Dentist in Alkapuri, Vadodara \(checked 3 days ago\)/.test(m))).toBe(true);
    expect(logs.some((m) => /1 new business since the saved data/.test(m))).toBe(true);
    // every saved business still arrives one by one as a checked lead, like a live search
    expect(events.filter((e) => e.type === "lead")).toHaveLength(3);
  });

  it("rechecks saved businesses older than a week and says what changed", async () => {
    const directory = memoryDirectory();
    await runSearch(params(), { ...deps("2026-09-10T10:00:00Z", { google: 0, osm: 0, audits: [] }), directory }, () => {});
    // 12 days later Aum has a website and Smile Studio's is down
    const c = { google: 0, osm: 0, audits: [] as string[] };
    const d = deps("2026-09-22T10:00:00Z", c, { site: (w) => (w?.includes("smilestudio") ? emptyAudit("down", { error: "HTTP 500" }) : w ? { ...emptyAudit("ok"), mobileViewport: true } : emptyAudit("none")) });
    d.discover = async (l) => (l.name === "Aum Dental Care" ? { tried: ["found"], website: "https://aumdental.in", via: "domain_guess", evidence: "name + phone" } : { tried: [] });
    const r = await runSearch(params({ verifyWebsites: true }), { ...d, directory }, () => {});
    expect(c.google).toBe(0);
    expect(r.leads.find((l) => l.name === "Aum Dental Care")!.changes).toEqual(["Now has a website"]);
    expect(r.leads.find((l) => l.name === "Smile Studio")!.changes).toEqual(["Website stopped working"]);
    expect((await directory.get("Vadodara", "Alkapuri", "dentist"))!.leads.every((l) => l.checkedAt === "2026-09-22T10:00:00.000Z" && !l.changes)).toBe(true);
  });

  it("can be skipped for a fully live search, and a search with more sources still runs the missing ones", async () => {
    const directory = memoryDirectory();
    await runSearch(params({ sources: { ...params().sources, google: false } }), { ...deps("2026-09-20T10:00:00Z", { google: 0, osm: 0, audits: [] }), directory }, () => {});
    const c = { google: 0, osm: 0, audits: [] as string[] };
    await runSearch(params(), { ...deps("2026-09-21T10:00:00Z", c), directory }, () => {});
    expect(c.google).toBe(1); // saved data came from the map only, so Google still runs
    const c2 = { google: 0, osm: 0, audits: [] as string[] };
    await runSearch(params({ fresh: true }), { ...deps("2026-09-21T11:00:00Z", c2), directory }, () => {});
    expect(c2.google).toBe(1);
  });

  it("describes changes in plain words", () => {
    expect(whatChanged({ audit: emptyAudit("none") }, { audit: emptyAudit("ok"), website: "https://x.in" })).toEqual(["Now has a website"]);
    expect(whatChanged({ audit: emptyAudit("down") }, { audit: emptyAudit("ok") })).toEqual(["Website working again"]);
    expect(whatChanged({ audit: emptyAudit("ok"), website: "https://a.in", phone: "+911" }, { audit: emptyAudit("ok"), website: "https://b.in/", phone: "+912" })).toEqual(["Moved to a new website", "New phone number"]);
    expect(whatChanged({ audit: emptyAudit("ok"), website: "https://a.in" }, { audit: emptyAudit("ok"), website: "https://www.a.in/" })).toEqual([]);
  });

  it("plans a prefill: skips what's fresh, splits types into searches of up to 8", async () => {
    const directory = memoryDirectory();
    const now = new Date("2026-09-29T10:00:00Z");
    await directory.put({ city: "Vadodara", area: "Alkapuri", category: "dentist", savedAt: "2026-09-27T10:00:00Z", leads: [{ id: "x" } as never] });
    await directory.put({ city: "Vadodara", area: "Alkapuri", category: "salon", savedAt: "2026-09-01T10:00:00Z", leads: [{ id: "y" } as never] });
    const types = ["dentist", "salon", "cafe", "gym", "skin", "physio", "clinic", "restaurant", "coaching", "realestate"];
    const { jobs, skipped } = await prefillPlan({ city: "Vadodara", areas: [{ offer: "website_development", area: "Alkapuri", types }], directory, now });
    expect(skipped).toBe(1); // dentist was saved 2 days ago; salon is 4 weeks old so it's refilled
    expect(jobs.map((j) => j.categories.length)).toEqual([8, 1]);
    expect(jobs[0].categories[0]).toBe("salon");
    const all = await prefillPlan({ city: "Vadodara", areas: [{ offer: "website_development", area: "Alkapuri", types }], directory, now, force: true });
    expect(all.skipped).toBe(0);
  });
});

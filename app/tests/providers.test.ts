import { afterEach, describe, expect, it, vi } from "vitest";
import { exactSearchChain, googleCseSearch, providersFromEnv, searchUsage, serperSearch } from "@/lib/enrich/searchProviders";
import { memoryUsage, parseLimits } from "@/lib/usage";
import { emptyAudit } from "@/lib/enrich/crawl";
import { runSearch, type Deps } from "@/lib/pipeline";
import type { SearchHit } from "@/lib/enrich/discover";

const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });

describe("Google-quality providers", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("Serper: sends the query for India and reads organic results", async () => {
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      expect(url).toBe("https://google.serper.dev/search");
      expect((init.headers as Record<string, string>)["X-API-KEY"]).toBe("k");
      expect(JSON.parse(String(init.body))).toMatchObject({ q: '"98250 11111"', gl: "in" });
      return json({ organic: [{ link: "https://sdcclinic.in/", title: "SDC", snippet: "Call 98250 11111" }] });
    });
    expect(await serperSearch('"98250 11111"', "k")).toEqual([{ url: "https://sdcclinic.in/", title: "SDC", snippet: "Call 98250 11111" }]);
  });

  it("Google Programmable Search: reads items and explains a used-up day", async () => {
    vi.stubGlobal("fetch", async (url: string) => {
      expect(url).toContain("customsearch/v1?");
      expect(url).toContain("cx=cx1");
      return json({ items: [{ link: "https://a.in", title: "A" }] });
    });
    expect(await googleCseSearch("x", "k", "cx1")).toEqual([{ url: "https://a.in", title: "A", snippet: undefined }]);
    vi.stubGlobal("fetch", async () => json({ error: { message: "Quota exceeded for quota metric 'Queries'" } }, 429));
    await expect(googleCseSearch("x", "k", "cx1")).rejects.toThrow(/free searches are used up/);
  });
});

describe("provider order and free limits", () => {
  const env = { GOOGLE_CSE_KEY: "k", GOOGLE_CSE_CX: "c", SERPER_API_KEY: "s", SEARXNG_URL: "http://localhost:8888", TAVILY_API_KEY: "t" };

  it("puts Google-quality providers first, SEARCH_ORDER overrides", () => {
    expect(providersFromEnv(env, memoryUsage()).map((p) => p.id)).toEqual(["google_cse", "serper", "searxng", "tavily", "duckduckgo"]);
    expect(providersFromEnv({ ...env, SEARCH_ORDER: "searxng, tavily" }, memoryUsage()).map((p) => p.id)).toEqual(["searxng", "tavily", "google_cse", "serper", "duckduckgo"]);
    expect(providersFromEnv(env, memoryUsage()).filter((p) => p.exact).map((p) => p.id)).toEqual(["google_cse", "serper"]);
  });

  it("stops a provider at its free limit, and the next one takes over", async () => {
    let t = new Date("2026-09-26T10:00:00Z");
    const usage = memoryUsage(() => t);
    vi.stubGlobal("fetch", async (url: string) => (url.includes("customsearch") ? json({ items: [{ link: "https://g.in", title: "G" }] }) : json({ organic: [{ link: "https://s.in", title: "S" }] })));
    const providers = providersFromEnv({ ...env, SEARCH_LIMITS: "google_cse=2/day" }, usage);
    const google = providers[0];
    await google.search("a");
    await google.search("b");
    await expect(google.search("c")).rejects.toThrow(/free limit reached \(2 a day/);
    t = new Date("2026-09-27T10:00:00Z"); // next day: allowed again
    await expect(google.search("d")).resolves.toHaveLength(1);
    expect(searchUsage({ ...env, SEARCH_LIMITS: "google_cse=2/day" }, usage).find((u) => u.id === "google_cse")).toMatchObject({ today: 1, month: 3, limit: { n: 2, per: "day" } });
    vi.unstubAllGlobals();
  });

  it("reads limits like 'serper=2500/month'", () => {
    expect(parseLimits("google_cse=100/day, serper = 2500/month, junk")).toEqual({ google_cse: { n: 100, per: "day" }, serper: { n: 2500, per: "month" } });
  });

  it("phone searches only go to providers that match exact numbers", () => {
    expect(exactSearchChain(providersFromEnv({ SEARXNG_URL: "http://x", TAVILY_API_KEY: "t" }, memoryUsage()))).toBeUndefined();
    expect(exactSearchChain(providersFromEnv(env, memoryUsage()))).toBeTypeOf("function");
  });
});

describe("pipeline: phone search routing", () => {
  const baseDeps = (numberSearch: ((q: string) => Promise<SearchHit[]>) | undefined, phoneSearch?: "auto" | "on" | "off") => {
    const calls: string[] = [];
    const deps: Deps = {
      keys: { phoneSearch },
      store: { kind: "local", saveSearch: async () => {}, saveLeads: async () => {}, listSearches: async () => [], getSearch: async () => null },
      makeWebSearch: () => async (q) => { calls.push(`web:${q}`); return []; },
      makeNumberSearch: numberSearch ? () => async (q) => { calls.push(`num:${q}`); return numberSearch(q); } : undefined,
      google: async () => ({ requests: 0, places: [] }),
      osm: async ({ category, city }) => [{ source: "osm" as const, sourceId: "n/1", name: "Shah's Dental Care", category, city, phone: "+919825011111" }],
      geocode: async () => ({ box: { south: 0, west: 0, north: 1, east: 1 }, via: "t" }),
      discover: async (l, area, d) => {
        await d?.search?.("name");
        if (d?.numberSearch) await d.numberSearch("phone");
        return { tried: [] };
      },
      audit: async () => emptyAudit("none"), pageSpeed: async () => ({ score: 0 }), apollo: async () => null,
      social: async () => [], web: async () => ({ places: [], queries: 0, rejected: [] }), gmaps: async () => [],
      igLookup: async () => null, fbSearch: async () => [], checkCandidate: async () => ({ ok: false, evidence: "" }),
    };
    return { deps, calls };
  };
  const params = { sells: "website_development" as const, categories: ["dentist"], city: "Vadodara", perCategory: 20, sources: { google: false, osm: true, apollo: false, instagram: false, facebook: false, web: false, gmaps: false }, pageSpeed: false, verifyWebsites: true, webSearch: true };

  it("auto: uses the exact-number providers when there are some", async () => {
    const { deps, calls } = baseDeps(async () => []);
    await runSearch(params, deps, () => {});
    expect(calls).toEqual(["web:name", "num:phone"]);
  });
  it("auto: skips phone search when no provider matches exact numbers", async () => {
    const { deps, calls } = baseDeps(undefined);
    await runSearch(params, deps, () => {});
    expect(calls).toEqual(["web:name"]);
  });
  it("on: uses the normal search for numbers; off: never", async () => {
    const on = baseDeps(undefined, "on");
    await runSearch(params, on.deps, () => {});
    expect(on.calls).toEqual(["web:name", "web:phone"]);
    const off = baseDeps(async () => [], "off");
    await runSearch(params, off.deps, () => {});
    expect(off.calls).toEqual(["web:name"]);
  });
});

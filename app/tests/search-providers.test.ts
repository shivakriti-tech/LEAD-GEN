import { afterEach, describe, expect, it, vi } from "vitest";
import { providersFromEnv, searchChain, searxngSearch, splitSite, tavilySearch } from "@/lib/enrich/searchProviders";

afterEach(() => vi.unstubAllGlobals());
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });

describe("providers", () => {
  it("splits site: out of a query", () => {
    expect(splitSite("site:instagram.com furniture shop Vadodara")).toEqual({ site: "instagram.com", rest: "furniture shop Vadodara" });
    expect(splitSite("Tea Post Bhayli")).toEqual({ rest: "Tea Post Bhayli" });
  });
  it("Tavily: turns site: into include_domains", async () => {
    let body: any;
    vi.stubGlobal("fetch", async (_u: string, init: RequestInit) => {
      body = JSON.parse(String(init.body));
      return json({ results: [{ url: "https://www.instagram.com/royalfurniture.vdr/", title: "Royal Furniture (@royalfurniture.vdr)" }] });
    });
    const r = await tavilySearch("site:instagram.com furniture shop Vadodara", "tvly-x");
    expect(body).toMatchObject({ query: "furniture shop Vadodara", include_domains: ["instagram.com"], search_depth: "basic" });
    expect(r[0].url).toContain("royalfurniture.vdr");
  });
  it("Tavily: explains a used-up quota", async () => {
    vi.stubGlobal("fetch", async () => new Response("usage limit exceeded", { status: 432 }));
    await expect(tavilySearch("x", "k")).rejects.toThrow(/monthly free searches used up/);
  });
  it("SearXNG: reads JSON and explains a missing json format", async () => {
    vi.stubGlobal("fetch", async (u: string) => {
      expect(u).toContain("http://localhost:8888/search?");
      expect(u).toContain("format=json");
      return json({ results: [{ url: "https://teapost.in/", title: "Tea Post" }] });
    });
    expect(await searxngSearch("Tea Post", "http://localhost:8888/")).toEqual([{ url: "https://teapost.in/", title: "Tea Post" }]);
    vi.stubGlobal("fetch", async () => new Response("Forbidden", { status: 403 }));
    await expect(searxngSearch("x", "http://localhost:8888")).rejects.toThrow(/formats/);
  });
  it("order: SearXNG, Tavily, Brave, then DuckDuckGo", () => {
    expect(providersFromEnv({ TAVILY_API_KEY: "t", SEARXNG_URL: "http://localhost:8888" }).map((p) => p.id)).toEqual(["searxng", "tavily", "duckduckgo"]);
    expect(providersFromEnv({}).map((p) => p.id)).toEqual(["duckduckgo"]);
  });
  it("falls through to the next provider and stays there", async () => {
    const calls: string[] = [];
    const msgs: string[] = [];
    const s = searchChain(
      [
        { id: "searxng", label: "SearXNG", search: async () => { calls.push("sx"); throw new Error("not running"); } },
        { id: "tavily", label: "Tavily", search: async () => { calls.push("tv"); return [{ url: "https://a.in", title: "A" }]; } },
      ],
      (m) => msgs.push(m),
    );
    expect(await s("q1")).toHaveLength(1);
    expect(await s("q2")).toHaveLength(1);
    expect(calls).toEqual(["sx", "tv", "tv"]);
    expect(msgs).toEqual(["SearXNG search stopped: not running. Using Tavily instead, and trying SearXNG again in 5 minutes."]);
  });
  it("tries a failed provider again after a while, so a short block doesn't use up the paid quota", async () => {
    let t = 0, sxUp = false;
    const calls: string[] = [];
    const msgs: string[] = [];
    const s = searchChain(
      [
        { id: "searxng", label: "SearXNG", search: async () => { calls.push("sx"); if (!sxUp) throw new Error("engines blocked"); return [{ url: "https://a.in", title: "A" }]; } },
        { id: "tavily", label: "Tavily", search: async () => { calls.push("tv"); return [{ url: "https://b.in", title: "B" }]; } },
      ],
      (m) => msgs.push(m), 60_000, () => t,
    );
    await s("q1");
    t = 30_000; await s("q2"); // still resting
    t = 61_000; await s("q3"); // retried, still blocked
    sxUp = true;
    t = 125_000; await s("q4"); // retried, back
    await s("q5");
    expect(calls).toEqual(["sx", "tv", "tv", "sx", "tv", "sx", "sx"]);
    expect(msgs).toHaveLength(2);
    expect(msgs[1]).toBe("SearXNG search is working again.");
  });
  it("says clearly when every provider has failed", async () => {
    const s = searchChain([{ id: "duckduckgo", label: "DuckDuckGo", search: async () => { throw new Error("captcha"); } }]);
    await expect(s("q")).rejects.toThrow(/No web search available \(captcha\)/);
  });
});

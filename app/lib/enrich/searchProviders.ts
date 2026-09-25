import type { SearchHit } from "./discover";
import { braveSearch, duckDuckGoSearch } from "./discover";
import { fetchWithTimeout } from "../util";

/**
 * Web search providers, free first:
 *  - SearXNG: self-hosted on your own computer. Free, unlimited, no key.
 *  - Tavily: 1,000 searches/month free, no credit card.
 *  - Brave: optional, needs a card on file.
 *  - DuckDuckGo's HTML page: free, no key, but may block after many searches.
 * The app uses the first one that's set up and falls through to the next if one fails.
 */

export type ProviderId = "searxng" | "tavily" | "brave" | "duckduckgo";

export interface Provider {
  id: ProviderId;
  label: string;
  search: (q: string) => Promise<SearchHit[]>;
}

/** Split "site:instagram.com furniture shop Vadodara" into the site and the rest. */
export function splitSite(q: string): { site?: string; rest: string } {
  const m = q.match(/(^|\s)site:(\S+)/i);
  if (!m) return { rest: q.trim() };
  return { site: m[2].toLowerCase(), rest: q.replace(m[0], " ").replace(/\s+/g, " ").trim() };
}

export async function tavilySearch(query: string, apiKey: string): Promise<SearchHit[]> {
  const { site, rest } = splitSite(query);
  const res = await fetchWithTimeout(
    "https://api.tavily.com/search",
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ query: rest, search_depth: "basic", max_results: 10, ...(site ? { include_domains: [site] } : {}) }),
    },
    20_000,
  );
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`Tavily ${res.status}${res.status === 432 || /limit|credit|quota/i.test(t) ? ": monthly free searches used up" : res.status === 401 ? ": API key not valid" : ""}`);
  }
  const j = (await res.json()) as { results?: Array<{ url: string; title: string; content?: string }> };
  return (j.results ?? []).map((r) => ({ url: r.url, title: r.title, snippet: r.content }));
}

export async function searxngSearch(query: string, baseUrl: string): Promise<SearchHit[]> {
  const url = `${baseUrl.replace(/\/+$/, "")}/search?${new URLSearchParams({ q: query, format: "json", language: "en-IN", safesearch: "0" })}`;
  let res: Response;
  try {
    res = await fetchWithTimeout(url, { headers: { Accept: "application/json" } }, 20_000);
  } catch (e) {
    throw new Error(`SearXNG not reachable at ${baseUrl}. Is it running? (${e instanceof Error ? e.message : e})`);
  }
  if (res.status === 403) throw new Error("SearXNG refused JSON. Add `json` under search → formats in its settings.yml (see README).");
  if (!res.ok) throw new Error(`SearXNG ${res.status}`);
  const j = (await res.json()) as { results?: Array<{ url: string; title: string; content?: string }>; unresponsive_engines?: Array<[string, string]> };
  const results = j.results ?? [];
  const blocked = j.unresponsive_engines ?? [];
  // No results because the engines behind SearXNG refused (captcha / too many requests)? That's a failure,
  // not "nothing exists", so the app should move on to the next search option.
  if (!results.length && blocked.length) {
    throw new Error(`SearXNG's engines are blocked right now (${blocked.map(([e, why]) => `${e}: ${why.replace(/^Suspended:\s*/i, "")}`).join(", ")})`);
  }
  return results.slice(0, 10).map((r) => ({ url: r.url, title: r.title, snippet: r.content }));
}

export function providersFromEnv(env: Record<string, string | undefined> = process.env): Provider[] {
  const out: Provider[] = [];
  if (env.SEARXNG_URL) out.push({ id: "searxng", label: "SearXNG (your own)", search: (q) => searxngSearch(q, env.SEARXNG_URL!) });
  if (env.TAVILY_API_KEY) out.push({ id: "tavily", label: "Tavily", search: (q) => tavilySearch(q, env.TAVILY_API_KEY!) });
  if (env.BRAVE_SEARCH_API_KEY) out.push({ id: "brave", label: "Brave", search: (q) => braveSearch(q, env.BRAVE_SEARCH_API_KEY!) });
  let last = 0;
  out.push({
    id: "duckduckgo",
    label: "DuckDuckGo",
    search: async (q) => {
      // one query at a time, at least 1.5 s apart
      const wait = last + 1500 - Date.now();
      last = Math.max(Date.now(), last + 1500);
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      return duckDuckGoSearch(q);
    },
  });
  return out;
}

/**
 * One search function over several providers. If a provider fails (quota, captcha,
 * not running), it's skipped for the rest of the run and the next one is used.
 */
export function searchChain(providers: Provider[], onSwitch?: (msg: string) => void): (q: string) => Promise<SearchHit[]> {
  const dead = new Set<ProviderId>();
  return async (q: string) => {
    let lastErr: unknown;
    for (const p of providers) {
      if (dead.has(p.id)) continue;
      try {
        return await p.search(q);
      } catch (e) {
        lastErr = e;
        dead.add(p.id);
        const next = providers.find((x) => !dead.has(x.id));
        onSwitch?.(`${p.label} search stopped: ${e instanceof Error ? e.message : e}.${next ? ` Using ${next.label} instead.` : ""}`);
      }
    }
    throw new Error(`No web search available${lastErr instanceof Error ? ` (${lastErr.message})` : ""}`);
  };
}

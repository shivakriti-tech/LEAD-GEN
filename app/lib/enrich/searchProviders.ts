import type { SearchHit } from "./discover";
import { braveSearch, duckDuckGoSearch } from "./discover";
import { fetchWithTimeout } from "../util";
import { fileUsage, memoryUsage, parseLimits, type Limit, type UsageBook } from "../usage";

/**
 * Web search providers. Each one is a plug: adding a paid service later means adding a key,
 * not changing the lead engine.
 *  - Google Programmable Search: real Google results, ~100 free searches a day (if Google still offers it on your account).
 *  - Serper: real Google results, free starter credits, then paid.
 *  - SearXNG: self-hosted on your own computer. Free, unlimited, no key, but weak for local businesses.
 *  - Tavily: 1,000 searches/month free, no credit card.
 *  - Brave: needs a card on file.
 *  - DuckDuckGo's HTML page: free, no key, but may block after many searches.
 * Best quality first (SEARCH_ORDER changes the order); each provider stops at its free limit
 * (SEARCH_LIMITS), then the next one is used.
 */

export type ProviderId = "google_cse" | "serper" | "searxng" | "tavily" | "brave" | "duckduckgo";

export interface Provider {
  id: ProviderId;
  label: string;
  search: (q: string) => Promise<SearchHit[]>;
  /** Matches exact phrases and phone numbers (Google-quality). Only these are used for phone searches. */
  exact?: boolean;
  limit?: Limit;
}

/** Free allowances we know about; SEARCH_LIMITS overrides or adds ("serper=2500/month"). */
export const DEFAULT_LIMITS: Partial<Record<ProviderId, Limit>> = {
  google_cse: { n: 100, per: "day" },
  tavily: { n: 1000, per: "month" },
};
const DEFAULT_ORDER: ProviderId[] = ["google_cse", "serper", "searxng", "tavily", "brave", "duckduckgo"];

export async function serperSearch(query: string, apiKey: string): Promise<SearchHit[]> {
  const res = await fetchWithTimeout(
    "https://google.serper.dev/search",
    { method: "POST", headers: { "X-API-KEY": apiKey, "Content-Type": "application/json" }, body: JSON.stringify({ q: query, gl: "in", hl: "en", num: 10 }) },
    15_000,
  );
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`Serper ${res.status}${res.status === 401 || res.status === 403 || /credit|limit|quota/i.test(t) ? ": key not valid or free credits used up" : ""}`);
  }
  const j = (await res.json()) as { organic?: Array<{ link: string; title: string; snippet?: string }> };
  return (j.organic ?? []).map((r) => ({ url: r.link, title: r.title, snippet: r.snippet }));
}

export async function googleCseSearch(query: string, key: string, cx: string): Promise<SearchHit[]> {
  const res = await fetchWithTimeout(`https://www.googleapis.com/customsearch/v1?${new URLSearchParams({ key, cx, q: query, gl: "in", num: "10" })}`, { headers: { Accept: "application/json" } }, 15_000);
  if (!res.ok) {
    const j = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
    const m = j.error?.message ?? `HTTP ${res.status}`;
    throw new Error(`Google search ${res.status}: ${res.status === 429 || /quota/i.test(m) ? "today's free searches are used up" : m}`);
  }
  const j = (await res.json()) as { items?: Array<{ link: string; title: string; snippet?: string }> };
  return (j.items ?? []).map((r) => ({ url: r.link, title: r.title, snippet: r.snippet }));
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
  const url = `${baseUrl.replace(/\/+$/, "")}/search?${new URLSearchParams({ q: query, format: "json", language: "en-IN", safesearch: "1" })}`;
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

export function providersFromEnv(env: Record<string, string | undefined> = process.env, usage: UsageBook = sharedUsage()): Provider[] {
  const out: Provider[] = [];
  if (env.GOOGLE_CSE_KEY && env.GOOGLE_CSE_CX) out.push({ id: "google_cse", label: "Google", exact: true, search: (q) => googleCseSearch(q, env.GOOGLE_CSE_KEY!, env.GOOGLE_CSE_CX!) });
  if (env.SERPER_API_KEY) out.push({ id: "serper", label: "Serper (Google)", exact: true, search: (q) => serperSearch(q, env.SERPER_API_KEY!) });
  if (env.SEARXNG_URL) out.push({ id: "searxng", label: "SearXNG (your own)", search: (q) => searxngSearch(q, env.SEARXNG_URL!) });
  if (env.TAVILY_API_KEY) out.push({ id: "tavily", label: "Tavily", search: (q) => tavilySearch(q, env.TAVILY_API_KEY!) });
  if (env.BRAVE_SEARCH_API_KEY) out.push({ id: "brave", label: "Brave", exact: true, search: (q) => braveSearch(q, env.BRAVE_SEARCH_API_KEY!) });
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

  // order: SEARCH_ORDER first (e.g. "searxng,google_cse"), then the rest best-first
  const wanted = (env.SEARCH_ORDER ?? "").split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);
  const rank = (id: ProviderId) => (wanted.includes(id) ? wanted.indexOf(id) : wanted.length + DEFAULT_ORDER.indexOf(id));
  out.sort((a, b) => rank(a.id) - rank(b.id));

  // count every search; stop a provider at its free limit so nothing is ever billed by surprise
  const limits = { ...DEFAULT_LIMITS, ...parseLimits(env.SEARCH_LIMITS) } as Partial<Record<ProviderId, Limit>>;
  return out.map((p) => {
    const limit = limits[p.id];
    return {
      ...p,
      limit,
      search: async (q: string) => {
        if (limit && usage.used(p.id, limit.per) >= limit.n) throw new Error(`free limit reached (${limit.n} a ${limit.per}; change it with SEARCH_LIMITS)`);
        usage.add(p.id);
        return p.search(q);
      },
    };
  });
}

let usageBook: UsageBook | undefined;
/** One usage book per server, stored in .data/usage.json. */
export function sharedUsage(): UsageBook {
  return (usageBook ??= process.env.NODE_ENV === "test" ? memoryUsage() : fileUsage());
}

/** How much of each provider's free allowance is used, for the app's status panel. */
export function searchUsage(env: Record<string, string | undefined> = process.env, usage: UsageBook = sharedUsage()) {
  return providersFromEnv(env, usage).map((p) => ({
    id: p.id,
    label: p.label,
    exact: !!p.exact,
    today: usage.used(p.id, "day"),
    month: usage.used(p.id, "month"),
    limit: p.limit ?? null,
  }));
}

/** A search over only the providers that match exact numbers, for phone searches. Undefined if none is set up. */
export function exactSearchChain(providers: Provider[], onSwitch?: (msg: string) => void): ((q: string) => Promise<SearchHit[]>) | undefined {
  const exact = providers.filter((p) => p.exact);
  return exact.length ? searchChain(exact, onSwitch) : undefined;
}

/**
 * One search function over several providers. If a provider fails (quota, captcha, not running),
 * the next one is used. A failed provider is tried again after `retryMs` (SearXNG's engines are
 * often blocked for a few minutes only), so a short block doesn't burn a paid quota for the whole run.
 */
export function searchChain(providers: Provider[], onSwitch?: (msg: string) => void, retryMs = 5 * 60_000, now: () => number = Date.now): (q: string) => Promise<SearchHit[]> {
  const deadUntil = new Map<ProviderId, number>();
  const isDead = (id: ProviderId) => (deadUntil.get(id) ?? 0) > now();
  return async (q: string) => {
    let lastErr: unknown;
    for (const p of providers) {
      if (isDead(p.id)) continue;
      const wasDead = deadUntil.has(p.id);
      try {
        const hits = await p.search(q);
        if (wasDead) {
          deadUntil.delete(p.id);
          onSwitch?.(`${p.label} search is working again.`);
        }
        return hits;
      } catch (e) {
        lastErr = e;
        deadUntil.set(p.id, now() + retryMs);
        const next = providers.find((x) => !isDead(x.id));
        if (!wasDead) onSwitch?.(`${p.label} search stopped: ${e instanceof Error ? e.message : e}.${next ? ` Using ${next.label} instead, and trying ${p.label} again in ${Math.round(retryMs / 60_000)} minutes.` : ""}`);
      }
    }
    throw new Error(`No web search available${lastErr instanceof Error ? ` (${lastErr.message})` : ""}`);
  };
}

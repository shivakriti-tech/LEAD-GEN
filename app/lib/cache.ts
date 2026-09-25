import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

/**
 * Small disk cache in .data/cache, so searching the same city again doesn't re-check
 * every website or re-run every web search. Each entry is one JSON file.
 *
 * LEAD_CACHE=off     nothing is reused
 * LEAD_CACHE=search  only web searches are reused (what the benchmark does, so code changes show up)
 * anything else      web searches, website checks and website finds are reused
 *
 * Bump CACHE_VERSION when the website check or website matching logic changes, so old answers
 * made by the old logic aren't reused.
 */
export const CACHE_VERSION = 1;

export const DAY = 86_400_000;

export interface CacheStats {
  hits: number;
  misses: number;
}

export type CacheMode = "off" | "search" | "all";
export function cacheMode(env: Record<string, string | undefined> = process.env): CacheMode {
  if (env.NODE_ENV === "test" || /^(off|0|false|no)$/i.test(env.LEAD_CACHE || "")) return "off";
  return /^search$/i.test(env.LEAD_CACHE || "") ? "search" : "all";
}

const root = () => path.join(process.cwd(), ".data", "cache");
const fileFor = (ns: string, key: string) => path.join(root(), ns, createHash("sha1").update(`v${CACHE_VERSION}|${key}`).digest("hex") + ".json");

export async function cacheGet<T>(ns: string, key: string): Promise<T | undefined> {
  try {
    const { at, ttl, value } = JSON.parse(await fs.readFile(fileFor(ns, key), "utf8")) as { at: number; ttl: number; value: T };
    return Date.now() - at < ttl ? value : undefined;
  } catch {
    return undefined;
  }
}

export async function cacheSet<T>(ns: string, key: string, value: T, ttl: number): Promise<void> {
  try {
    const f = fileFor(ns, key);
    await fs.mkdir(path.dirname(f), { recursive: true });
    await fs.writeFile(f, JSON.stringify({ at: Date.now(), ttl, key, value }));
  } catch {
    // a cache that can't write is just a slower run
  }
}

/**
 * Wrap an async function with the disk cache. `ttlFor` picks how long to keep each answer
 * (return 0 to not keep it, e.g. errors or "site down" that may be temporary).
 * Errors are never cached.
 */
export function cached<A extends unknown[], R>(
  ns: string,
  fn: (...args: A) => Promise<R>,
  keyOf: (...args: A) => string,
  ttlFor: (r: R) => number,
  stats?: CacheStats,
): (...args: A) => Promise<R> {
  return async (...args: A) => {
    const key = keyOf(...args);
    const hit = await cacheGet<R>(ns, key);
    if (hit !== undefined) {
      if (stats) stats.hits++;
      return hit;
    }
    if (stats) stats.misses++;
    const r = await fn(...args);
    const ttl = ttlFor(r);
    if (ttl > 0) await cacheSet(ns, key, r, ttl);
    return r;
  };
}

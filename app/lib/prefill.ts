import { categoriesFor } from "./categories";
import { RECHECK_AFTER, type Directory } from "./directory";
import type { Deps } from "./pipeline";
import { runSearch } from "./pipeline";
import type { Store } from "./store";
import type { Lead, Offer, SearchParams, SearchRecord } from "./types";

/**
 * Filling the lead directory ahead of time (`npm run prefill`), so searches start from checked
 * businesses. Free sources only by default: OpenStreetMap and likely web addresses.
 */

/** Vadodara to start with: shopping and clinic areas for website leads, industrial estates for logistics. */
export const VADODARA = {
  city: "Vadodara",
  website: ["Alkapuri", "Sayajigunj", "Fatehgunj", "Akota", "Gotri", "Vasna-Bhayli Road", "Manjalpur", "Karelibaug", "Nizampura", "Waghodia Road", "Old Padra Road", "Subhanpura", "Sama", "Harni", "Tandalja"],
  websiteTypes: ["dentist", "skin", "physio", "clinic", "salon", "gym", "restaurant", "cafe", "coaching", "realestate"],
  logistics: ["Makarpura GIDC", "Por GIDC", "Waghodia GIDC", "Nandesari GIDC", "Savli GIDC", "Ranoli", "Padra", "Makarpura"],
  logisticsTypes: categoriesFor("logistics").map((c) => c.key),
};

export interface PrefillJob {
  offer: Offer;
  area: string;
  categories: string[];
}

/** Which area × type sets still need filling: everything not saved within the last week (or all, with force). */
export async function prefillPlan(opts: { city: string; areas: Array<{ offer: Offer; area: string; types: string[] }>; directory: Directory; force?: boolean; now?: Date }): Promise<{ jobs: PrefillJob[]; skipped: number }> {
  const now = (opts.now ?? new Date()).getTime();
  const jobs: PrefillJob[] = [];
  let skipped = 0;
  for (const a of opts.areas) {
    const todo: string[] = [];
    for (const t of a.types) {
      const e = opts.force ? undefined : await opts.directory.get(opts.city, a.area, t);
      if (e && now - Date.parse(e.savedAt) < RECHECK_AFTER) skipped++;
      else todo.push(t);
    }
    // a search takes up to 8 business types
    for (let i = 0; i < todo.length; i += 8) jobs.push({ offer: a.offer, area: a.area, categories: todo.slice(i, i + 8) });
  }
  return { jobs, skipped };
}

/** A store that keeps nothing: prefill runs only fill the directory, they don't appear in Recent searches. */
export const noStore: Store = {
  kind: "local",
  saveSearch: async () => {},
  saveLeads: async () => {},
  listSearches: async () => [],
  getSearch: async () => null,
  updateFollowUps: async () => [],
  deleteLeads: async () => 0,
};

export async function runPrefill(opts: {
  city: string;
  jobs: PrefillJob[];
  deps: Deps;
  sources: { osm: boolean; web: boolean; google: boolean };
  perCategory?: number;
  log: (m: string) => void;
  signal?: AbortSignal;
}): Promise<{ saved: number; failed: number }> {
  let saved = 0, failed = 0;
  for (const [i, j] of opts.jobs.entries()) {
    if (opts.signal?.aborted) break;
    const params: SearchParams = {
      sells: j.offer,
      client: j.offer === "logistics" ? { services: ["customs", "freight", "courier", "forwarding", "warehousing"] } : undefined,
      categories: j.categories,
      city: opts.city,
      area: j.area,
      perCategory: opts.perCategory ?? 20,
      sources: { google: opts.sources.google, osm: opts.sources.osm, web: opts.sources.web, apollo: false, instagram: false, facebook: false, gmaps: false },
      pageSpeed: false,
      verifyWebsites: true,
      webSearch: opts.sources.web,
      fresh: true, // re-find everything; the directory is what we're refreshing
    };
    opts.log(`[${i + 1}/${opts.jobs.length}] ${j.area}: ${j.categories.join(", ")}`);
    let result: { search: SearchRecord; leads: Lead[] };
    try {
      result = await runSearch(params, { ...opts.deps, store: noStore, revealMs: 0 }, (e) => e.type === "log" && e.level !== "info" && opts.log(`   ${e.message}`), opts.signal);
    } catch (e) {
      failed++;
      opts.log(`   failed: ${e instanceof Error ? e.message : e}`);
      continue;
    }
    if (result.search.status === "failed") {
      failed++;
      opts.log(`   failed: ${result.search.error}`);
      continue;
    }
    saved += result.leads.length;
    opts.log(`   saved ${result.leads.length} businesses (${result.search.counts.hot} strong leads)`);
  }
  return { saved, failed };
}

import type { Lead } from "./types";
import type { Store } from "./store";
import { historyOf, touchKeys } from "./followups";
import { statusOf } from "./outreach";

/**
 * The numbers for the Home screen, from every saved search: what you did each day,
 * your pipeline, who replied, what you won, and the best leads still waiting for a message.
 */

/** A lead with just what Home needs to show it and message it. */
export type HomeLead = Pick<Lead, "id" | "name" | "category" | "city" | "address" | "phone" | "phones" | "placeId" | "email" | "website" | "audit" | "signals" | "score" | "tier" | "whyNow" | "owner" | "sources" | "reviews" | "rating" | "followUp"> & {
  searchId: string;
  search: string;
};

export interface HomeDay {
  date: string; // YYYY-MM-DD, your local day
  messaged: number;
  replied: number;
  meetings: number;
  won: number;
  wonValue: number;
}

export interface HomeData {
  today: string;
  /** The last 60 days, oldest first. */
  days: HomeDay[];
  /** Leads in each status now. */
  byStatus: Record<string, number>;
  /** Follow-ups set for today and the next 6 days (open leads only). */
  upcoming: Array<{ date: string; n: number }>;
  /** Recent status changes, newest first. */
  recent: Array<{ status: string; at: string; lead: HomeLead }>;
  /** Top leads not messaged yet (in any search), best first. */
  waiting: HomeLead[];
  waitingTotal: number;
  /** Per business type: how many you messaged and how many replied. */
  byCategory: Record<string, { messaged: number; replied: number }>;
  searches: number;
  leads: number;
  latest?: { id: string; search: string; createdAt: string; hot: number; leads: number };
}

const REPLIED = new Set(["replied", "meeting", "won", "interested"]);

/** Your local day for a timestamp. `tz` is the browser's getTimezoneOffset() (minutes, e.g. -330 for India). */
export function localDay(iso: string, tz: number): string {
  return new Date(Date.parse(iso) - tz * 60_000).toISOString().slice(0, 10);
}

function slim(l: Lead, searchId: string, search: string): HomeLead {
  const { id, name, category, city, address, phone, phones, placeId, email, website, audit, signals, score, tier, whyNow, owner, sources, reviews, rating, followUp } = l;
  return { id, name, category, city, address, phone, phones, placeId, email, website, audit, signals, score, tier, whyNow, owner, sources, reviews, rating, followUp, searchId, search };
}

export async function homeData(store: Store, opts: { today: string; tz: number }): Promise<HomeData> {
  const { today, tz } = opts;
  const days = new Map<string, HomeDay>();
  const start = new Date(`${today}T12:00:00Z`);
  for (let i = 59; i >= 0; i--) {
    const d = new Date(start.getTime() - i * 86_400_000).toISOString().slice(0, 10);
    days.set(d, { date: d, messaged: 0, replied: 0, meetings: 0, won: 0, wonValue: 0 });
  }
  const bump = (iso: string | undefined, k: keyof Omit<HomeDay, "date">, by = 1) => {
    const d = iso && days.get(localDay(iso, tz));
    if (d) d[k] += by;
  };

  const byStatus: Record<string, number> = {};
  const upcoming = Array.from({ length: 7 }, (_, i) => ({ date: new Date(start.getTime() + i * 86_400_000).toISOString().slice(0, 10), n: 0 }));
  const recent: HomeData["recent"] = [];
  const waiting: HomeLead[] = [];
  const contacted = new Set<string>();
  const byCategory: HomeData["byCategory"] = {};
  let searches = 0, total = 0;
  let latest: HomeData["latest"];

  for (const s of await store.listSearches()) {
    const hit = await store.getSearch(s.id);
    if (!hit) continue;
    searches++;
    const place = s.params.area ? `${s.params.area}, ${s.params.city}` : s.params.city;
    if (!latest && s.status !== "failed") latest = { id: s.id, search: place, createdAt: s.createdAt, hot: s.counts.hot, leads: hit.leads.length };
    for (const l of hit.leads) {
      total++;
      const st = statusOf(l);
      byStatus[st] = (byStatus[st] ?? 0) + 1;
      const on = l.followUp?.followUpOn;
      if (on && st !== "won" && st !== "lost") {
        const u = upcoming.find((x) => x.date === on);
        if (u) u.n++;
      }
      if (st === "new") {
        if (!l.pending && l.tier === "hot") waiting.push(slim(l, s.id, place));
        continue;
      }
      for (const k of touchKeys(l)) contacted.add(k);
      const fu = l.followUp!;
      const h = historyOf(fu);
      const firstOf = (want: (x: string) => boolean) => h.find((e) => want(e.status))?.at;
      const reply = firstOf((x) => REPLIED.has(x));
      const won = firstOf((x) => x === "won");
      bump(fu.contactedAt, "messaged");
      bump(reply, "replied");
      bump(firstOf((x) => x === "meeting"), "meetings");
      if (won && st === "won") {
        bump(won, "won");
        bump(won, "wonValue", fu.value ?? 0);
      }
      const c = (byCategory[l.category] ??= { messaged: 0, replied: 0 });
      c.messaged++;
      if (reply) c.replied++;
      const last = h[h.length - 1];
      if (last) recent.push({ status: st, at: last.at, lead: slim(l, s.id, place) });
    }
  }

  // the same business found by two searches is one lead; one you've contacted anywhere isn't waiting
  const seen = new Set<string>();
  const fresh = waiting
    .sort((a, b) => b.score - a.score)
    .filter((l) => {
      const keys = touchKeys(l);
      if (keys.some((k) => contacted.has(k) || seen.has(k))) return false;
      keys.forEach((k) => seen.add(k));
      return true;
    });
  recent.sort((a, b) => b.at.localeCompare(a.at));
  return {
    today,
    days: [...days.values()],
    upcoming,
    byStatus,
    recent: recent.slice(0, 8),
    waiting: fresh.slice(0, 6),
    waitingTotal: fresh.length,
    byCategory,
    searches,
    leads: total,
    latest,
  };
}

/** Sum a measure over the last `n` days, and the `n` days before that. */
export function windowed(days: HomeDay[], n: number, k: keyof Omit<HomeDay, "date">): { now: number; prev: number } {
  const last = days.slice(-n), before = days.slice(-2 * n, -n);
  const sum = (xs: HomeDay[]) => xs.reduce((t, d) => t + d[k], 0);
  return { now: sum(last), prev: sum(before) };
}

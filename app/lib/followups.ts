import type { FollowUp, Lead } from "./types";
import type { Store } from "./store";
import { FOLLOW_UP, isOpen, localDate, normalizeStatus, statusOf } from "./outreach";

/** A change to a lead's follow-up. Missing fields stay as they were; followUpOn: null clears the date. */
export interface FollowUpPatch {
  status?: string;
  note?: string;
  followUpOn?: string | null;
}

/** Apply a change, keeping the first-contacted time so "contacted this week" can be counted. */
export function mergeFollowUp(prev: FollowUp | undefined, patch: FollowUpPatch, now = new Date()): FollowUp {
  const status = patch.status !== undefined ? normalizeStatus(patch.status) : normalizeStatus(prev?.status);
  const next: FollowUp = { ...prev, status, updatedAt: now.toISOString() };
  if (patch.note !== undefined) next.note = patch.note.slice(0, 2000) || undefined;
  if (patch.followUpOn !== undefined) next.followUpOn = patch.followUpOn && /^\d{4}-\d{2}-\d{2}$/.test(patch.followUpOn) ? patch.followUpOn : undefined;
  if (status !== "new" && !prev?.contactedAt) next.contactedAt = now.toISOString();
  if (status === "new") delete next.contactedAt;
  // closed leads need no reminder
  if (status === "won" || status === "lost") delete next.followUpOn;
  return next;
}

export const validPatch = (b: unknown): FollowUpPatch | null => {
  if (!b || typeof b !== "object") return null;
  const x = b as Record<string, unknown>;
  const out: FollowUpPatch = {};
  if (typeof x.status === "string" && [...FOLLOW_UP.map((s) => s.key as string), "interested", "not_fit"].includes(x.status)) out.status = x.status;
  if (typeof x.note === "string") out.note = x.note;
  if (x.followUpOn === null || typeof x.followUpOn === "string") out.followUpOn = x.followUpOn as string | null;
  return out;
};

/** Keys that identify the same business across searches: its phone numbers and Google place. */
export function touchKeys(l: Pick<Lead, "phones" | "phone" | "placeId">): string[] {
  const phones = [l.phone, ...(l.phones ?? [])].filter(Boolean).map((p) => `p:${p!.replace(/\D/g, "").slice(-10)}`);
  return [...new Set([...phones, ...(l.placeId ? [`g:${l.placeId}`] : [])])];
}

/** A business you've already moved past New, in some search. */
export interface Touched {
  status: string;
  at?: string;
  searchId: string;
  leadId: string;
  search: string;
}

/** Results so far for a business type, overall ("*|Dentist") and per city ("vadodara|Dentist"). */
export interface CategoryStat {
  /** How many searches included this type. */
  searches: number;
  total: number;
  hot: number;
  noSite: number;
}

/** Was this lead already contacted in another search (or as another listing)? */
export function touchedElsewhere(l: Pick<Lead, "id" | "phones" | "phone" | "placeId">, searchId: string | null, touched: Record<string, Touched> | undefined): Touched | undefined {
  if (!touched) return undefined;
  for (const k of touchKeys(l)) {
    const t = touched[k];
    if (t && !(t.searchId === searchId && t.leadId === l.id)) return t;
  }
  return undefined;
}

export interface DueLead {
  searchId: string;
  search: string; // "Alkapuri, Vadodara"
  lead: Pick<Lead, "id" | "name" | "category" | "phone" | "phones" | "audit" | "city" | "whyNow" | "score" | "tier" | "followUp" | "signals" | "owner" | "website" | "email" | "reviews" | "rating" | "address" | "sources" | "emails">;
}

/** Across every saved search: leads due for a follow-up (today or earlier) and how many you contacted this week. */
export async function pipeline(store: Store, today = localDate(), now = new Date()) {
  const weekAgo = now.getTime() - 7 * 86_400_000;
  const due: DueLead[] = [];
  let contactedThisWeek = 0;
  const byStatus: Record<string, number> = {};
  const touched: Record<string, Touched> = {};
  const stats: Record<string, CategoryStat> = {};
  for (const s of await store.listSearches()) {
    const hit = await store.getSearch(s.id);
    if (!hit) continue;
    const place = s.params.area ? `${s.params.area}, ${s.params.city}` : s.params.city;
    const counted = new Set<string>();
    for (const l of hit.leads) {
      const st = statusOf(l);
      byStatus[st] = (byStatus[st] ?? 0) + 1;
      if (st !== "new") for (const k of touchKeys(l)) touched[k] ??= { status: st, at: l.followUp?.contactedAt, searchId: s.id, leadId: l.id, search: place };
      if (!l.pending && s.status !== "running" && s.status !== "failed")
        for (const key of [`*|${l.category}`, `${s.params.city.trim().toLowerCase()}|${l.category}`]) {
          const x = (stats[key] ??= { searches: 0, total: 0, hot: 0, noSite: 0 });
          if (!counted.has(key)) {
            counted.add(key);
            x.searches++;
          }
          x.total++;
          if (l.tier === "hot") x.hot++;
          if (["none", "social_only", "down"].includes(l.audit?.status ?? "none")) x.noSite++;
        }
      if (l.followUp?.contactedAt && Date.parse(l.followUp.contactedAt) >= weekAgo) contactedThisWeek++;
      if (l.followUp?.followUpOn && l.followUp.followUpOn <= today && isOpen(l)) {
        const { id, name, category, phone, phones, audit, city, whyNow, score, tier, followUp, signals, owner, website, email, reviews, rating, address, sources, emails } = l;
        due.push({ searchId: s.id, search: place, lead: { id, name, category, phone, phones, audit, city, whyNow, score, tier, followUp, signals, owner, website, email, reviews, rating, address, sources, emails } });
      }
    }
  }
  due.sort((a, b) => a.lead.followUp!.followUpOn!.localeCompare(b.lead.followUp!.followUpOn!) || b.lead.score - a.lead.score);
  return { due, contactedThisWeek, byStatus, today, touched, stats };
}

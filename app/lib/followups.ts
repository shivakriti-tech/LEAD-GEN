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
  for (const s of await store.listSearches()) {
    const hit = await store.getSearch(s.id);
    if (!hit) continue;
    for (const l of hit.leads) {
      const st = statusOf(l);
      byStatus[st] = (byStatus[st] ?? 0) + 1;
      if (l.followUp?.contactedAt && Date.parse(l.followUp.contactedAt) >= weekAgo) contactedThisWeek++;
      if (l.followUp?.followUpOn && l.followUp.followUpOn <= today && isOpen(l)) {
        const { id, name, category, phone, phones, audit, city, whyNow, score, tier, followUp, signals, owner, website, email, reviews, rating, address, sources, emails } = l;
        due.push({ searchId: s.id, search: s.params.area ? `${s.params.area}, ${s.params.city}` : s.params.city, lead: { id, name, category, phone, phones, audit, city, whyNow, score, tier, followUp, signals, owner, website, email, reviews, rating, address, sources, emails } });
      }
    }
  }
  due.sort((a, b) => a.lead.followUp!.followUpOn!.localeCompare(b.lead.followUp!.followUpOn!) || b.lead.score - a.lead.score);
  return { due, contactedThisWeek, byStatus, today };
}

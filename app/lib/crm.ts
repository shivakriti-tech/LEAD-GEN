import type { Store } from "./store";
import type { Lead } from "./types";
import { statusOf } from "./outreach";
import type { Handoff } from "./handoff";

/**
 * The mini CRM: every lead that replied, across all searches, on one board: your turn (replied),
 * meeting, handed to a client, won and lost, with value, next date and note.
 */

export type Column = "replied" | "meeting" | "handed" | "won" | "lost";
export const COLUMNS: Array<{ key: Column; label: string }> = [
  { key: "replied", label: "Replied: your turn" },
  { key: "meeting", label: "Meeting" },
  { key: "handed", label: "With a client" },
  { key: "won", label: "Won" },
  { key: "lost", label: "Lost" },
];

export interface CrmLead {
  searchId: string;
  search: string;
  lead: Pick<Lead, "id" | "name" | "category" | "city" | "country" | "email" | "phone" | "phones" | "website" | "whyNow" | "followUp" | "pitchFor" | "owner" | "score">;
  column: Column;
  handoff?: Pick<Handoff, "id" | "clientId" | "clientName" | "status" | "value" | "createdAt">;
}

export function columnOf(l: Pick<Lead, "followUp">, h?: Pick<Handoff, "status">): Column | undefined {
  const st = statusOf(l);
  if (st === "won" || h?.status === "won") return "won";
  if (st === "lost" || h?.status === "lost" || h?.status === "rejected") return "lost";
  if (h) return "handed";
  if (st === "meeting") return "meeting";
  if (st === "replied") return "replied";
  return undefined;
}

export async function crmBoard(store: Store, handoffs: Handoff[]): Promise<CrmLead[]> {
  const byLead = new Map(handoffs.filter((h) => h.status !== "rejected").map((h) => [`${h.searchId}|${h.leadId}`, h]));
  const rejected = new Map(handoffs.filter((h) => h.status === "rejected").map((h) => [`${h.searchId}|${h.leadId}`, h]));
  const out: CrmLead[] = [];
  for (const s of await store.listSearches()) {
    const got = await store.getSearch(s.id);
    const place = s.params.area ? `${s.params.area}, ${s.params.city}` : s.params.city;
    for (const l of got?.leads ?? []) {
      const h = byLead.get(`${s.id}|${l.id}`) ?? rejected.get(`${s.id}|${l.id}`);
      const column = columnOf(l, h);
      if (!column) continue;
      const { id, name, category, city, country, email, phone, phones, website, whyNow, followUp, pitchFor, owner, score } = l;
      out.push({ searchId: s.id, search: place, lead: { id, name, category, city, country, email, phone, phones, website, whyNow, followUp, pitchFor, owner, score }, column, handoff: h && { id: h.id, clientId: h.clientId, clientName: h.clientName, status: h.status, value: h.value, createdAt: h.createdAt } });
    }
  }
  return out.sort((a, b) => (b.lead.followUp?.updatedAt ?? "").localeCompare(a.lead.followUp?.updatedAt ?? ""));
}

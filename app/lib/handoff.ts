import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { ClientBrain } from "./brain";
import type { FollowUpPatch } from "./followups";
import { touchKeys } from "./followups";
import type { Lead } from "./types";
import { canCharge, charge, refund, territoryOwner, updateBilling, type BillingStore } from "./billing";
import { needLabels } from "./score/agency";

/**
 * Handoff: an interested lead goes to your client, with everything they need to close it, and a
 * private link where they say what happened (contacted, meeting, won and for how much, lost, or
 * "not a real lead"). Their answer updates your lead, so you see real outcomes per search and
 * business type: the closed loop. Saved in .data/handoffs.json.
 */

export type HandoffStatus = "sent" | "contacted" | "meeting" | "won" | "lost" | "rejected";
export const HANDOFF_LABEL: Record<HandoffStatus, string> = {
  sent: "Sent to client",
  contacted: "Client contacted them",
  meeting: "Meeting booked",
  won: "Won",
  lost: "Lost",
  rejected: "Not a real lead",
};
/** Days the client has to reject a lead for a refund. */
export const REJECT_DAYS = 7;

export interface Handoff {
  id: string;
  clientId: string;
  clientName: string;
  searchId: string;
  leadId: string;
  /** Phone / Google listing keys: the same business can't go to two clients. */
  keys: string[];
  lead: { name: string; category: string; city?: string; country?: string; contact?: string; email?: string; phone?: string; website?: string };
  /** Why it's a lead and what they said: the client reads this first. */
  summary: string;
  needs: string[];
  conversation?: Array<{ dir: "in" | "out"; text: string; at: string }>;
  note?: string;
  status: HandoffStatus;
  value?: number;
  createdAt: string;
  updates: Array<{ status: HandoffStatus; at: string; by: "you" | "client"; note?: string; value?: number }>;
}

export interface HandoffStore {
  read(): Promise<Handoff[]>;
  write(d: Handoff[]): Promise<void>;
}
export function localHandoffStore(file = () => path.join(process.cwd(), ".data", "handoffs.json")): HandoffStore {
  return {
    async read() {
      try {
        return JSON.parse(await fs.readFile(file(), "utf8")) as Handoff[];
      } catch {
        return [];
      }
    },
    async write(d) {
      await fs.mkdir(path.dirname(file()), { recursive: true });
      await fs.writeFile(file(), JSON.stringify(d));
    },
  };
}
export function memoryHandoffStore(init: Handoff[] = []): HandoffStore & { data: Handoff[] } {
  const s = { data: init, read: async () => s.data, write: async (d: Handoff[]) => void (s.data = d) };
  return s;
}
let chain: Promise<unknown> = Promise.resolve();
export function updateHandoffs<T>(store: HandoffStore, fn: (d: Handoff[]) => T | Promise<T>): Promise<T> {
  const run = chain.then(async () => {
    const d = await store.read();
    const out = await fn(d);
    await store.write(d);
    return out;
  });
  chain = run.catch(() => {});
  return run;
}

const open = (h: Handoff) => h.status !== "rejected";

/** Why this lead can't go to this client, or undefined. */
export function handoffBlock(all: Handoff[], lead: Pick<Lead, "id" | "phones" | "phone" | "placeId">, searchId: string, clientId: string): string | undefined {
  const keys = new Set(touchKeys(lead));
  const same = all.find((h) => open(h) && ((h.searchId === searchId && h.leadId === lead.id) || h.keys.some((k) => keys.has(k))));
  if (!same) return undefined;
  return same.clientId === clientId ? `Already handed to ${same.clientName}` : `Already handed to ${same.clientName}: each lead goes to one client only`;
}

export interface HandoffDeps {
  handoffs: HandoffStore;
  billing: BillingStore;
  patchLead: (searchId: string, leadId: string, p: FollowUpPatch) => Promise<void>;
  now?: () => Date;
}

/** Hand a lead to a client: check exclusivity and credits, charge, record it, note it on the lead. */
export async function createHandoff(deps: HandoffDeps, x: { searchId: string; lead: Lead; client: Pick<ClientBrain, "id" | "name">; note?: string; summary?: string; conversation?: Handoff["conversation"] }): Promise<{ ok: true; handoff: Handoff } | { ok: false; error: string }> {
  const now = deps.now?.() ?? new Date();
  const { lead, client } = x;
  const existing = await deps.handoffs.read();
  const blocked = handoffBlock(existing, lead, x.searchId, client.id);
  if (blocked) return { ok: false, error: blocked };
  const id = randomUUID();
  const billed = await updateBilling(deps.billing, (d) => {
    const owner = territoryOwner(d, lead.city, lead.category, client.id);
    if (owner) return { ok: false as const, error: `${lead.city} · ${lead.category} belongs to another client exclusively` };
    const can = canCharge(d, client.id);
    if (!can.ok) return { ok: false as const, error: can.why! };
    charge(d, client.id, id, `Lead: ${lead.name}`, now);
    return { ok: true as const };
  });
  if (!billed.ok) return billed;
  const h: Handoff = {
    id,
    clientId: client.id,
    clientName: client.name,
    searchId: x.searchId,
    leadId: lead.id,
    keys: touchKeys(lead),
    lead: { name: lead.name, category: lead.category, city: lead.city, country: lead.country, contact: lead.owner?.name ?? lead.audit?.ownerName, email: lead.email, phone: lead.phone ?? lead.phones[0], website: lead.audit?.finalUrl ?? lead.website },
    summary: (x.summary ?? lead.whyNow).slice(0, 1200),
    needs: needLabels(lead.pitchFor),
    conversation: x.conversation?.slice(-6).map((m) => ({ ...m, text: m.text.slice(0, 2000) })),
    note: x.note?.trim().slice(0, 1000) || undefined,
    status: "sent",
    createdAt: now.toISOString(),
    updates: [{ status: "sent", at: now.toISOString(), by: "you", note: x.note?.trim() || undefined }],
  };
  await updateHandoffs(deps.handoffs, (d) => void d.push(h));
  await deps.patchLead(x.searchId, lead.id, { note: `Handed to ${client.name} on ${now.toISOString().slice(0, 10)}` });
  return { ok: true, handoff: h };
}

/** What the lead's own status becomes for a handoff outcome. */
export function leadPatchFor(status: HandoffStatus, value?: number, clientName?: string): FollowUpPatch | undefined {
  if (status === "meeting") return { status: "meeting" };
  if (status === "won") return { status: "won", value: value ?? null, note: `Won by ${clientName ?? "the client"}` };
  if (status === "lost") return { status: "lost", note: `Lost (${clientName ?? "client"})` };
  if (status === "rejected") return { status: "lost", note: `${clientName ?? "Client"}: not a real lead` };
  return undefined;
}

/**
 * Record what happened. The client may reject a lead as "not a real lead" within REJECT_DAYS of
 * receiving it, which refunds its credits; after that, or once they've said it went further, no.
 */
export async function setOutcome(deps: HandoffDeps, id: string, u: { status: HandoffStatus; value?: number; note?: string }, by: "you" | "client"): Promise<{ ok: true; handoff: Handoff; refunded: boolean } | { ok: false; error: string }> {
  const now = deps.now?.() ?? new Date();
  const res = await updateHandoffs(deps.handoffs, (d) => {
    const h = d.find((x) => x.id === id);
    if (!h) return { ok: false as const, error: "Handoff not found" };
    if (u.status === "rejected") {
      if (h.status === "rejected") return { ok: false as const, error: "Already rejected" };
      const late = now.getTime() - Date.parse(h.createdAt) > REJECT_DAYS * 86_400_000;
      if (by === "client" && (late || ["meeting", "won"].includes(h.status))) return { ok: false as const, error: late ? `Leads can be rejected within ${REJECT_DAYS} days` : "This lead already went to a meeting" };
    }
    const value = u.status === "won" && u.value != null && Number.isFinite(u.value) && u.value >= 0 ? Math.round(u.value) : undefined;
    h.status = u.status;
    if (value != null) h.value = value;
    h.updates.push({ status: u.status, at: now.toISOString(), by, note: u.note?.trim().slice(0, 1000) || undefined, value });
    return { ok: true as const, handoff: { ...h } };
  });
  if (!res.ok) return res;
  const refunded = u.status === "rejected" ? !!(await updateBilling(deps.billing, (d) => refund(d, id, `Rejected: ${res.handoff.lead.name}`, now))) : false;
  const p = leadPatchFor(u.status, res.handoff.value, res.handoff.clientName);
  if (p) await deps.patchLead(res.handoff.searchId, res.handoff.leadId, p);
  return { ...res, refunded };
}

/** The email (or WhatsApp text) that hands the lead over. */
export function handoffMessage(h: Handoff, link?: string): { subject: string; text: string } {
  const l = h.lead;
  const lines = [
    `New interested lead: ${l.name}`,
    "",
    [l.category, [l.city, l.country].filter(Boolean).join(", ")].filter(Boolean).join(" · "),
    h.summary,
    h.needs.length ? `Likely needs: ${h.needs.join(", ")}` : "",
    "",
    "Contact",
    ...[l.contact && `Name: ${l.contact}`, l.email && `Email: ${l.email}`, l.phone && `Phone: ${l.phone}`, l.website && `Website: ${l.website}`].filter(Boolean),
    ...(h.conversation?.length ? ["", "What they said", ...h.conversation.filter((m) => m.dir === "in").slice(-2).map((m) => `"${m.text.replace(/\s+/g, " ").slice(0, 600)}"`)] : []),
    ...(h.note ? ["", `Note: ${h.note}`] : []),
    "",
    link ? `Please tell us how it goes (takes 10 seconds): ${link}` : "Please let us know how it goes: contacted, meeting, won or lost.",
    `If it isn't a real lead, mark it "Not a real lead" within ${REJECT_DAYS} days and it won't be charged.`,
  ];
  return { subject: `New lead: ${l.name}`, text: lines.filter((x, i, a) => !(x === "" && a[i - 1] === "")).join("\n") };
}

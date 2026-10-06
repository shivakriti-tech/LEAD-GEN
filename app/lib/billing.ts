import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

/**
 * Credits & billing: each client buys credits, and every interested lead you hand them costs
 * credits. A lead they reject as "not a real lead" within 7 days is refunded automatically.
 *
 * Money is recorded, not collected: you note a payment (bank transfer, UPI, Stripe, Razorpay…)
 * as a top-up, and the statement shows it. Saved in .data/billing.json.
 */

export interface Account {
  clientId: string;
  /** Credits one handed-off lead costs. */
  creditsPerLead: number;
  /** What one credit costs the client, for statements, e.g. 500 (INR) or 10 (USD). */
  pricePerCredit: number;
  currency: string;
  /** Tax on statements, e.g. 18 for GST; 0 for none. */
  taxRate: number;
  taxLabel: string;
  /** Hand off leads even when credits run out (the balance goes negative). */
  allowOverdraft: boolean;
  /** Areas this client has exclusively: "city|business type", e.g. "houston|Trucking & haulage". */
  territories: string[];
}

export type EntryKind = "topup" | "charge" | "refund" | "adjust";
export interface Entry {
  id: string;
  clientId: string;
  at: string;
  kind: EntryKind;
  /** + adds credits, − uses them. */
  credits: number;
  /** Money received (top-ups), in the account currency. */
  amount?: number;
  note?: string;
  handoffId?: string;
  /** Receipt number for a top-up: R-2026-0001. */
  receipt?: string;
}

export interface BillingData {
  accounts: Record<string, Account>;
  entries: Entry[];
}

export const DEFAULT_ACCOUNT = (clientId: string): Account => ({ clientId, creditsPerLead: 1, pricePerCredit: 0, currency: "INR", taxRate: 0, taxLabel: "GST", allowOverdraft: false, territories: [] });
export const accountOf = (d: BillingData, clientId: string): Account => ({ ...DEFAULT_ACCOUNT(clientId), ...d.accounts[clientId] });

export function balance(d: BillingData, clientId: string): number {
  return d.entries.filter((e) => e.clientId === clientId).reduce((t, e) => t + e.credits, 0);
}
/** Under 3 leads' worth left: time to ask for a top-up. */
export const lowBalance = (d: BillingData, clientId: string) => balance(d, clientId) < 3 * accountOf(d, clientId).creditsPerLead;

/** May this client receive another lead now? */
export function canCharge(d: BillingData, clientId: string): { ok: boolean; why?: string; cost: number } {
  const a = accountOf(d, clientId);
  const left = balance(d, clientId);
  if (!a.allowOverdraft && left < a.creditsPerLead) return { ok: false, cost: a.creditsPerLead, why: `Not enough credits (${left} left, a lead costs ${a.creditsPerLead}): add a top-up under Clients → Credits` };
  return { ok: true, cost: a.creditsPerLead };
}

export function charge(d: BillingData, clientId: string, handoffId: string, note: string, now = new Date()): Entry {
  const e: Entry = { id: randomUUID(), clientId, at: now.toISOString(), kind: "charge", credits: -accountOf(d, clientId).creditsPerLead, handoffId, note };
  d.entries.push(e);
  return e;
}

/** Give back what a handoff cost (once). */
export function refund(d: BillingData, handoffId: string, note: string, now = new Date()): Entry | undefined {
  const ch = d.entries.find((e) => e.kind === "charge" && e.handoffId === handoffId);
  if (!ch || d.entries.some((e) => e.kind === "refund" && e.handoffId === handoffId)) return undefined;
  const e: Entry = { id: randomUUID(), clientId: ch.clientId, at: now.toISOString(), kind: "refund", credits: -ch.credits, handoffId, note };
  d.entries.push(e);
  return e;
}

export function topUp(d: BillingData, clientId: string, credits: number, amount: number | undefined, note: string | undefined, now = new Date()): Entry {
  const year = now.getUTCFullYear();
  const n = d.entries.filter((e) => e.receipt?.startsWith(`R-${year}-`)).length + 1;
  const e: Entry = { id: randomUUID(), clientId, at: now.toISOString(), kind: "topup", credits: Math.round(credits), amount, note, receipt: `R-${year}-${String(n).padStart(4, "0")}` };
  d.entries.push(e);
  return e;
}

/** Which other client has this area exclusively, if any. */
export function territoryOwner(d: BillingData, city: string | undefined, category: string, exceptClient?: string): string | undefined {
  if (!city) return undefined;
  const key = `${city.trim().toLowerCase()}|${category.trim().toLowerCase()}`;
  return Object.values(d.accounts).find((a) => a.clientId !== exceptClient && a.territories.some((t) => t.toLowerCase() === key))?.clientId;
}

/** One month's statement: opening balance, every entry, totals, closing balance, money and tax. */
export function statement(d: BillingData, clientId: string, month: string) {
  const a = accountOf(d, clientId);
  const mine = d.entries.filter((e) => e.clientId === clientId).sort((x, y) => x.at.localeCompare(y.at));
  const inMonth = mine.filter((e) => e.at.slice(0, 7) === month);
  const opening = mine.filter((e) => e.at.slice(0, 7) < month).reduce((t, e) => t + e.credits, 0);
  const leads = inMonth.filter((e) => e.kind === "charge").length - inMonth.filter((e) => e.kind === "refund").length;
  const used = -inMonth.filter((e) => e.kind === "charge" || e.kind === "refund").reduce((t, e) => t + e.credits, 0);
  const paid = inMonth.filter((e) => e.kind === "topup").reduce((t, e) => t + (e.amount ?? 0), 0);
  const value = used * a.pricePerCredit;
  const tax = Math.round(value * a.taxRate) / 100;
  return { account: a, month, opening, entries: inMonth, closing: opening + inMonth.reduce((t, e) => t + e.credits, 0), leads, used, paid, value, tax, total: value + tax };
}

/* ---------- storage ---------- */

export interface BillingStore {
  read(): Promise<BillingData>;
  write(d: BillingData): Promise<void>;
}
export function localBillingStore(file = () => path.join(process.cwd(), ".data", "billing.json")): BillingStore {
  return {
    async read() {
      try {
        return JSON.parse(await fs.readFile(file(), "utf8")) as BillingData;
      } catch {
        return { accounts: {}, entries: [] };
      }
    },
    async write(d) {
      await fs.mkdir(path.dirname(file()), { recursive: true });
      await fs.writeFile(file(), JSON.stringify(d, null, 1));
    },
  };
}
export function memoryBillingStore(init: BillingData = { accounts: {}, entries: [] }): BillingStore & { data: BillingData } {
  const s = { data: init, read: async () => s.data, write: async (d: BillingData) => void (s.data = d) };
  return s;
}
let chain: Promise<unknown> = Promise.resolve();
export function updateBilling<T>(store: BillingStore, fn: (d: BillingData) => T | Promise<T>): Promise<T> {
  const run = chain.then(async () => {
    const d = await store.read();
    const out = await fn(d);
    await store.write(d);
    return out;
  });
  chain = run.catch(() => {});
  return run;
}

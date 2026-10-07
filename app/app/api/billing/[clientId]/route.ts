import { getClientStore } from "@/lib/store";
import { accountOf, balance, billingStore, lowBalance, topUp, updateBilling, type Account } from "@/lib/billing";
import { handoffStore } from "@/lib/handoff";
import { randomUUID } from "node:crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** A client's credits: settings, balance, every entry, and their handoffs. */
export async function GET(_req: Request, ctx: { params: Promise<{ clientId: string }> }) {
  const { clientId } = await ctx.params;
  const d = await billingStore().read();
  const handoffs = (await handoffStore().read()).filter((h) => h.clientId === clientId).reverse();
  return Response.json({ account: accountOf(d, clientId), balance: balance(d, clientId), low: lowBalance(d, clientId), entries: d.entries.filter((e) => e.clientId === clientId).reverse(), handoffs });
}

/**
 * { action: "settings", account: {...} }        price per lead, currency, tax, overdraft, territories
 * { action: "topup", credits, amount?, note? }   a payment received
 * { action: "adjust", credits, note }            a manual correction (+ or −)
 */
export async function POST(req: Request, ctx: { params: Promise<{ clientId: string }> }) {
  const { clientId } = await ctx.params;
  if (!(await getClientStore().getClient(clientId))) return Response.json({ error: "Client not found" }, { status: 404 });
  const b = (await req.json().catch(() => ({}))) as { action?: string; account?: Partial<Account>; credits?: number; amount?: number; note?: string };
  const num = (v: unknown, min: number, max: number) => (typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : undefined);
  const note = typeof b.note === "string" ? b.note.trim().slice(0, 300) : undefined;
  const r = await updateBilling(billingStore(), (d) => {
    if (b.action === "settings") {
      const a = accountOf(d, clientId), n = b.account ?? {};
      d.accounts[clientId] = {
        ...a,
        creditsPerLead: Math.round(num(n.creditsPerLead, 0, 1000) ?? a.creditsPerLead),
        pricePerCredit: num(n.pricePerCredit, 0, 1e7) ?? a.pricePerCredit,
        currency: typeof n.currency === "string" && /^[A-Z]{3}$/.test(n.currency) ? n.currency : a.currency,
        taxRate: num(n.taxRate, 0, 50) ?? a.taxRate,
        taxLabel: typeof n.taxLabel === "string" ? n.taxLabel.trim().slice(0, 20) || "Tax" : a.taxLabel,
        allowOverdraft: typeof n.allowOverdraft === "boolean" ? n.allowOverdraft : a.allowOverdraft,
        territories: Array.isArray(n.territories) ? [...new Set(n.territories.filter((t): t is string => typeof t === "string" && /^[^|]{2,80}\|[^|]{2,80}$/.test(t.trim())).map((t) => t.trim().toLowerCase()))].slice(0, 50) : a.territories,
      };
      return { ok: true };
    }
    const credits = num(b.credits, -100000, 100000);
    if (!credits) return { ok: false, error: "Enter the number of credits" };
    if (b.action === "topup") {
      if (credits < 0) return { ok: false, error: "A top-up adds credits" };
      return { ok: true, entry: topUp(d, clientId, credits, num(b.amount, 0, 1e9), note) };
    }
    if (b.action === "adjust") {
      if (!note) return { ok: false, error: "Say why (shows on the statement)" };
      const e = { id: randomUUID(), clientId, at: new Date().toISOString(), kind: "adjust" as const, credits: Math.round(credits), note };
      d.entries.push(e);
      return { ok: true, entry: e };
    }
    return { ok: false, error: "Unknown action" };
  });
  return r.ok ? Response.json(r) : Response.json(r, { status: 400 });
}

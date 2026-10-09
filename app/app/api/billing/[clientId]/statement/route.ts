import { getClientStore } from "@/lib/store";
import { billingStore, statement } from "@/lib/billing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const KIND = { topup: "Top-up", charge: "Lead", refund: "Refund", adjust: "Adjustment" } as const;

/** A printable monthly statement for a client: ?month=YYYY-MM (this month by default). */
export async function GET(req: Request, ctx: { params: Promise<{ clientId: string }> }) {
  const { clientId } = await ctx.params;
  const c = await getClientStore().getClient(clientId);
  if (!c) return new Response("Client not found", { status: 404 });
  const q = new URL(req.url).searchParams.get("month");
  const month = q && /^\d{4}-\d{2}$/.test(q) ? q : new Date().toISOString().slice(0, 7);
  const s = statement(await billingStore().read(), clientId, month);
  const money = (n: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: s.account.currency, maximumFractionDigits: 2 }).format(n);
  const title = new Date(`${month}-01T00:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
  const rows = s.entries.map((e) => `<tr><td>${esc(e.at.slice(0, 10))}</td><td>${KIND[e.kind]}${e.receipt ? ` ${esc(e.receipt)}` : ""}</td><td>${esc(e.note ?? "")}</td><td class="n">${e.credits > 0 ? "+" : ""}${e.credits}</td><td class="n">${e.amount ? money(e.amount) : ""}</td></tr>`).join("");
  return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Statement ${esc(c.name)} ${esc(month)}</title>
<style>body{font-family:system-ui,-apple-system,Segoe UI,sans-serif;max-width:780px;margin:32px auto;padding:0 20px;color:#1f2328}h1{font-size:22px;margin:0}table{width:100%;border-collapse:collapse;margin:16px 0}td,th{text-align:left;padding:6px 8px;border-bottom:1px solid #e5e5e5;font-size:14px}.n{text-align:right;font-variant-numeric:tabular-nums}.sum td{border:0;padding:3px 8px}.sum tr:last-child td{font-weight:700;border-top:1px solid #1f2328}.muted{color:#666}@media print{button{display:none}}</style></head><body>
<button onclick="print()" style="float:right;font:inherit;padding:6px 12px">Print / Save PDF</button>
<h1>Statement: ${esc(title)}</h1><p class="muted">${esc(c.name)}${c.email ? ` · ${esc(c.email)}` : ""}</p>
<table><thead><tr><th>Date</th><th>Type</th><th>Detail</th><th class="n">Credits</th><th class="n">Paid</th></tr></thead><tbody>
<tr><td></td><td>Opening balance</td><td></td><td class="n">${s.opening}</td><td></td></tr>${rows || `<tr><td colspan="5" class="muted">Nothing this month.</td></tr>`}
<tr><td></td><td><b>Closing balance</b></td><td></td><td class="n"><b>${s.closing}</b></td><td></td></tr></tbody></table>
<table class="sum" style="width:auto;margin-left:auto"><tr><td>Leads delivered</td><td class="n">${s.leads}</td></tr><tr><td>Credits used</td><td class="n">${s.used}</td></tr>${s.account.pricePerCredit ? `<tr><td>Value (${money(s.account.pricePerCredit)} per credit)</td><td class="n">${money(s.value)}</td></tr>${s.account.taxRate ? `<tr><td>${esc(s.account.taxLabel)} ${s.account.taxRate}%</td><td class="n">${money(s.tax)}</td></tr>` : ""}<tr><td>Total</td><td class="n">${money(s.total)}</td></tr>` : ""}<tr><td>Payments received</td><td class="n">${money(s.paid)}</td></tr></table>
<p class="muted" style="font-size:13px">Leads marked "Not a real lead" within 7 days are refunded and shown as Refund.</p></body></html>`, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}

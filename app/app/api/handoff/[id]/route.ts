import { HANDOFF_LABEL, localHandoffStore, REJECT_DAYS, setOutcome, type HandoffStatus } from "@/lib/handoff";
import { localBillingStore } from "@/lib/billing";
import { savedLeads } from "@/lib/mail/send";
import { signedOk } from "@/lib/mail/unsubscribe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The client's private page for one lead (signed link, no password): the lead, and a form to say
 * what happened. Their answer updates your lead and, for "Not a real lead", refunds the credits.
 */
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const page = (title: string, body: string, status = 200) =>
  new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${esc(title)}</title></head><body style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;max-width:560px;margin:6vh auto;padding:0 18px;color:#1f2328;line-height:1.55">${body}</body></html>`, { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });

async function load(req: Request, id: string) {
  const t = new URL(req.url).searchParams.get("t") ?? "";
  if (!(await signedOk("handoff", id, t))) return undefined;
  return (await localHandoffStore().read()).find((h) => h.id === id);
}

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const h = await load(req, id);
  if (!h) return page("Link not valid", "<p>This link isn't valid or has expired.</p>", 404);
  const l = h.lead;
  const row = (k: string, v?: string) => (v ? `<tr><td style="color:#666;padding:2px 12px 2px 0">${k}</td><td>${esc(v)}</td></tr>` : "");
  const opts = (Object.keys(HANDOFF_LABEL) as HandoffStatus[]).filter((s) => s !== "sent").map((s) => `<option value="${s}"${s === h.status ? " selected" : ""}>${HANDOFF_LABEL[s]}</option>`).join("");
  const said = (h.conversation ?? []).filter((m) => m.dir === "in").slice(-2).map((m) => `<blockquote style="margin:8px 0;padding:8px 12px;background:#f5f5f4;border-radius:8px;white-space:pre-wrap">${esc(m.text)}</blockquote>`).join("");
  return page(`Lead: ${l.name}`, `
<p style="color:#666;margin:0">For ${esc(h.clientName)}</p>
<h1 style="font-size:24px;margin:4px 0 8px">${esc(l.name)}</h1>
<p style="margin:0 0 12px">${esc([l.category, [l.city, l.country].filter(Boolean).join(", ")].filter(Boolean).join(" · "))}</p>
<p>${esc(h.summary)}</p>
${h.needs.length ? `<p><b>Likely needs:</b> ${esc(h.needs.join(", "))}</p>` : ""}
<table style="border-collapse:collapse;margin:12px 0">${row("Contact", l.contact)}${row("Email", l.email)}${row("Phone", l.phone)}${row("Website", l.website)}</table>
${said ? `<p style="margin-bottom:0"><b>What they said</b></p>${said}` : ""}
${h.note ? `<p><b>Note:</b> ${esc(h.note)}</p>` : ""}
<hr style="border:0;border-top:1px solid #e5e5e5;margin:20px 0">
<form method="post" style="display:grid;gap:10px">
  <label>How is it going?<br><select name="status" style="font:inherit;padding:6px;width:100%">${opts}</select></label>
  <label>Deal value, if won<br><input name="value" type="number" min="0" step="1" value="${h.value ?? ""}" style="font:inherit;padding:6px;width:100%"></label>
  <label>Note (optional)<br><textarea name="note" rows="3" style="font:inherit;padding:6px;width:100%"></textarea></label>
  <button style="font:inherit;padding:10px;border:0;border-radius:8px;background:#1f2328;color:#fff;cursor:pointer">Save</button>
</form>
<p style="color:#666;font-size:13px">"Not a real lead" can be chosen within ${REJECT_DAYS} days of receiving it; the lead is then not charged. Now: <b>${esc(HANDOFF_LABEL[h.status])}</b>.</p>`);
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const h = await load(req, id);
  if (!h) return page("Link not valid", "<p>This link isn't valid or has expired.</p>", 404);
  const f = await req.formData();
  const status = String(f.get("status") ?? "");
  if (!(status in HANDOFF_LABEL) || status === "sent") return page("Not saved", "<p>Pick how it's going.</p>", 400);
  const v = String(f.get("value") ?? "").trim();
  const r = await setOutcome({ handoffs: localHandoffStore(), billing: localBillingStore(), patchLead: savedLeads.patch }, id, { status: status as HandoffStatus, value: v ? Number(v) : undefined, note: String(f.get("note") ?? "") }, "client");
  if (!r.ok) return page("Not saved", `<p>${esc(r.error)}</p><p><a href="">Back</a></p>`, 400);
  return page("Saved", `<p>Thanks, saved: <b>${esc(HANDOFF_LABEL[r.handoff.status])}</b>${r.refunded ? ". This lead won't be charged." : "."}</p><p><a href="">Back to the lead</a></p>`);
}

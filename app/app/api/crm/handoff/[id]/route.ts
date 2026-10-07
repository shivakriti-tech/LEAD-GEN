import { HANDOFF_LABEL, handoffStore, setOutcome, type HandoffStatus } from "@/lib/handoff";
import { billingStore } from "@/lib/billing";
import { savedLeads } from "@/lib/mail/send";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** You record what happened with a handed-off lead. Body: { status, value?, note? } */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const b = (await req.json().catch(() => ({}))) as { status?: string; value?: number; note?: string };
  if (!b.status || !(b.status in HANDOFF_LABEL)) return Response.json({ error: "Unknown status" }, { status: 400 });
  const r = await setOutcome({ handoffs: handoffStore(), billing: billingStore(), patchLead: savedLeads.patch }, id, { status: b.status as HandoffStatus, value: b.value == null ? undefined : Number(b.value), note: b.note }, "you");
  return r.ok ? Response.json(r) : Response.json({ error: r.error }, { status: 400 });
}

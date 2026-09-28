import { getStore } from "@/lib/store";
import { live } from "@/lib/live";
import { FOLLOW_UP } from "@/lib/outreach";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Save your follow-up status and note on one lead: { status: "contacted", note: "call back Monday" }. */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string; leadId: string }> }) {
  const { id, leadId } = await ctx.params;
  // while a search runs it saves its own copy of the leads every few seconds, which would overwrite this
  if (live.has(id)) return Response.json({ error: "This search is still running. Statuses can be set when it finishes." }, { status: 409 });
  let body: { status?: string; note?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Send JSON." }, { status: 400 });
  }
  const status = FOLLOW_UP.find((s) => s.key === body.status)?.key ?? "new";
  const note = typeof body.note === "string" ? body.note.slice(0, 2000) : undefined;
  const lead = await getStore().updateLead(id, leadId, { status, note: note || undefined, updatedAt: new Date().toISOString() });
  if (!lead) return Response.json({ error: "Lead not found" }, { status: 404 });
  return Response.json({ lead });
}

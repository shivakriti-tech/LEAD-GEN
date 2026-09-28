import { getStore } from "@/lib/store";
import { live } from "@/lib/live";
import { mergeFollowUp, validPatch } from "@/lib/followups";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Change one lead's status, note or follow-up date: { status: "contacted", followUpOn: "2026-10-02" }. */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string; leadId: string }> }) {
  const { id, leadId } = await ctx.params;
  // while a search runs it saves its own copy of the leads every few seconds, which would overwrite this
  if (live.has(id)) return Response.json({ error: "This search is still running. You can update leads when it finishes." }, { status: 409 });
  const patch = validPatch(await req.json().catch(() => null));
  if (!patch) return Response.json({ error: "Send JSON." }, { status: 400 });
  const store = getStore();
  const hit = await store.getSearch(id);
  const cur = hit?.leads.find((l) => l.id === leadId);
  if (!cur) return Response.json({ error: "Lead not found" }, { status: 404 });
  const [lead] = await store.updateFollowUps(id, [{ id: leadId, followUp: mergeFollowUp(cur.followUp, patch) }]);
  return Response.json({ lead });
}

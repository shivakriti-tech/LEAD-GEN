import { getStore } from "@/lib/store";
import { live } from "@/lib/live";
import { mergeFollowUp, validPatch } from "@/lib/followups";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Change one lead's status, note or follow-up date: { status: "contacted", followUpOn: "2026-10-02" }. */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string; leadId: string }> }) {
  const { id, leadId } = await ctx.params;
  const patch = validPatch(await req.json().catch(() => null));
  if (!patch) return Response.json({ error: "Send JSON." }, { status: 400 });
  const store = getStore();
  // A running search saves its own copy of the leads every few seconds: change that copy, so the
  // status is kept, and the saved file too, so it's safe even if the app stops.
  const running = live.get(id);
  if (running) {
    const cur = running.leads?.find((l) => l.id === leadId);
    if (!cur) return Response.json({ error: "This business isn't in the list yet. Try again in a moment." }, { status: 409 });
    cur.followUp = mergeFollowUp(cur.followUp, patch);
    await store.updateFollowUps(id, [{ id: leadId, followUp: cur.followUp }]).catch(() => {});
    return Response.json({ lead: cur });
  }
  const hit = await store.getSearch(id);
  const cur = hit?.leads.find((l) => l.id === leadId);
  if (!cur) return Response.json({ error: "Lead not found" }, { status: 404 });
  const [lead] = await store.updateFollowUps(id, [{ id: leadId, followUp: mergeFollowUp(cur.followUp, patch) }]);
  return Response.json({ lead });
}

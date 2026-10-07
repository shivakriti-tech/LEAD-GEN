import { getStore } from "@/lib/store";
import { live } from "@/lib/live";
import { mergeFollowUp, validPatch } from "@/lib/followups";
import type { Lead, SearchRecord } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function body(req: Request): Promise<{ ids: string[]; rest: unknown } | null> {
  const b = (await req.json().catch(() => null)) as { ids?: unknown } | null;
  if (!b || !Array.isArray(b.ids) || !b.ids.every((x) => typeof x === "string")) return null;
  return { ids: (b.ids as string[]).slice(0, 1000), rest: b };
}
const busy = (id: string) => live.has(id) && Response.json({ error: "This search is still running. You can delete leads when it finishes." }, { status: 409 });

/** Change many leads at once: { ids: [...], status: "contacted" } (and/or note, followUpOn). Works while the search runs. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const b = await body(req);
  const patch = b && validPatch(b.rest);
  if (!b || !patch) return Response.json({ error: "Send { ids: [...], status }" }, { status: 400 });
  const store = getStore();
  const running = live.get(id);
  if (running) {
    // still running: change the search's own copy (see the single-lead route), then the file
    const want = new Set(b.ids);
    const hits = (running.leads ?? []).filter((l) => want.has(l.id));
    for (const l of hits) l.followUp = mergeFollowUp(l.followUp, patch);
    await store.updateFollowUps(id, hits.map((l) => ({ id: l.id, followUp: l.followUp! }))).catch(() => {});
    return Response.json({ leads: hits });
  }
  const hit = await store.getSearch(id);
  if (!hit) return Response.json({ error: "Search not found" }, { status: 404 });
  const want = new Set(b.ids);
  const updates = hit.leads.filter((l) => want.has(l.id)).map((l) => ({ id: l.id, followUp: mergeFollowUp(l.followUp, patch) }));
  return Response.json({ leads: await store.updateFollowUps(id, updates) });
}

/** Remove leads from this search: { ids: [...] }. The search's counts are updated. */
export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const b0 = busy(id);
  if (b0) return b0;
  const b = await body(req);
  if (!b) return Response.json({ error: "Send { ids: [...] }" }, { status: 400 });
  const store = getStore();
  const removed = await store.deleteLeads(id, b.ids);
  const hit = await store.getSearch(id);
  if (hit) {
    const left: Lead[] = hit.leads.filter((l) => !l.pending);
    const counts: SearchRecord["counts"] = { ...hit.search.counts, afterDedupe: hit.leads.length, hot: left.filter((l) => l.tier === "hot").length, warm: left.filter((l) => l.tier === "warm").length, cold: left.filter((l) => l.tier === "cold").length };
    await store.saveSearch({ ...hit.search, counts });
  }
  return Response.json({ removed });
}

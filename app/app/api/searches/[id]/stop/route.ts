import { getStore } from "@/lib/store";
import { live, resuming, settle } from "@/lib/live";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Stop a running search. Everything checked so far is kept and can be exported. */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const running = live.get(id);
  if (running) {
    running.ctrl.abort();
    return Response.json({ stopping: true });
  }
  // not running on this server (cut off earlier, or waiting to resume after a restart): mark it stopped
  const hit = await getStore().getSearch(id);
  if (!hit) return Response.json({ error: "Search not found" }, { status: 404 });
  if (resuming.delete(id) || hit.search.status === "running") {
    const search = { ...hit.search, status: "stopped" as const, error: `Stopped by you after checking ${hit.leads.filter((l) => !l.pending).length} of ${hit.leads.length} businesses` };
    await getStore().saveSearch(search);
    return Response.json({ search });
  }
  return Response.json({ search: await settle(hit.search, getStore()) });
}

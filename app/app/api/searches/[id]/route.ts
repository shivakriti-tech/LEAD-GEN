import { getStore } from "@/lib/store";
import { live, settle } from "@/lib/live";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const store = getStore();
  const running = live.get(id);
  // a running search's leads are already in memory: don't download them all again on every refresh
  const hit = running?.leads && store.getSearchRecord
    ? await store.getSearchRecord(id).then((search) => (search ? { search, leads: running.leads! } : null))
    : await store.getSearch(id);
  if (!hit) return Response.json({ error: "Search not found" }, { status: 404 });
  return Response.json({
    search: await settle(hit.search, store),
    leads: hit.leads,
    // while it runs: its log and progress, as the page shows for a search it started itself
    live: running ? { logs: running.logs, stage: running.stage, stopping: running.ctrl.signal.aborted } : null,
  });
}

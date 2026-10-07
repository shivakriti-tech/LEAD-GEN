import { getStore } from "@/lib/store";
import { live, settle } from "@/lib/live";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const hit = await getStore().getSearch(id);
  if (!hit) return Response.json({ error: "Search not found" }, { status: 404 });
  const running = live.get(id);
  return Response.json({
    search: await settle(hit.search, getStore()),
    leads: hit.leads,
    // while it runs: its log and progress, as the page shows for a search it started itself
    live: running ? { logs: running.logs, stage: running.stage, stopping: running.ctrl.signal.aborted } : null,
  });
}

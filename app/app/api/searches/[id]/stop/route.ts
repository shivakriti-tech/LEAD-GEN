import { getStore } from "@/lib/store";
import { live, settle } from "@/lib/live";

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
  // not running on this server (cut off earlier): just mark it stopped
  const hit = await getStore().getSearch(id);
  if (!hit) return Response.json({ error: "Search not found" }, { status: 404 });
  return Response.json({ search: await settle(hit.search, getStore()) });
}

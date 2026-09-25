import { leadsToCsv } from "@/lib/csv";
import { getStore } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const hit = await getStore().getSearch(id);
  if (!hit) return new Response("Search not found", { status: 404 });
  const p = hit.search.params;
  const name = `leads-${p.city}-${hit.search.createdAt.slice(0, 10)}.csv`.replace(/[^a-z0-9.-]+/gi, "-").toLowerCase();
  return new Response(leadsToCsv(hit.leads), {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${name}"` },
  });
}

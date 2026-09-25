import { getStore } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const hit = await getStore().getSearch(id);
  if (!hit) return Response.json({ error: "Search not found" }, { status: 404 });
  return Response.json(hit);
}

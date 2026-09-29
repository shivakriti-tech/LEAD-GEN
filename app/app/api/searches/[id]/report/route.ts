import { getStore } from "@/lib/store";
import { leadsReport } from "@/lib/report";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** A printable report of this search's best leads. ?by=<your name>, ?all=1 for every lead, ?download=1 to save it as a file. */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const hit = await getStore().getSearch(id);
  if (!hit) return new Response("Search not found", { status: 404 });
  const q = new URL(req.url).searchParams;
  const html = leadsReport({ search: hit.search, leads: hit.leads, by: q.get("by")?.slice(0, 80) || undefined, all: q.get("all") === "1" });
  const p = hit.search.params;
  const name = `lead-report-${p.area ?? ""}-${p.city}-${hit.search.createdAt.slice(0, 10)}.html`.replace(/[^a-z0-9.-]+/gi, "-").replace(/-+/g, "-").toLowerCase();
  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      // the report only runs its own "Save as PDF" button; nothing else
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:",
      ...(q.get("download") === "1" ? { "Content-Disposition": `attachment; filename="${name}"` } : {}),
    },
  });
}

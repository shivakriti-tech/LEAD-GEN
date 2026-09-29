import { getStore } from "@/lib/store";
import { leadsReport } from "@/lib/report";
import { htmlToPdf, NoBrowserError } from "@/lib/pdf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * A report of this search's best leads. ?format=pdf gives a ready PDF (opens in the browser's PDF
 * viewer, with its download button); otherwise a web page. ?by=<your name>, ?all=1 for every lead,
 * ?download=1 to save it as a file straight away.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const hit = await getStore().getSearch(id);
  if (!hit) return new Response("Search not found", { status: 404 });
  const q = new URL(req.url).searchParams;
  const by = q.get("by")?.slice(0, 80) || undefined;
  const all = q.get("all") === "1";
  const p = hit.search.params;
  const name = `lead-report-${p.area ?? ""}-${p.city}-${hit.search.createdAt.slice(0, 10)}`.replace(/[^a-z0-9.-]+/gi, "-").replace(/-+/g, "-").toLowerCase();
  const disposition = (ext: string) => `${q.get("download") === "1" ? "attachment" : "inline"}; filename="${name}.${ext}"`;
  const pdfHref = `?${new URLSearchParams({ format: "pdf", ...(by ? { by } : {}), ...(all ? { all: "1" } : {}) })}`;

  if (q.get("format") === "pdf") {
    try {
      const pdf = await htmlToPdf(leadsReport({ search: hit.search, leads: hit.leads, by, all }));
      return new Response(new Uint8Array(pdf), { headers: { "Content-Type": "application/pdf", "Content-Disposition": disposition("pdf"), "Cache-Control": "no-store" } });
    } catch (e) {
      // no browser to make the PDF with: show the web page instead, with its print button
      console.error("[report] PDF failed:", e instanceof Error ? e.message : e);
      const html = leadsReport({ search: hit.search, leads: hit.leads, by, all, notice: e instanceof NoBrowserError ? e.message : "Couldn't make the PDF. Use Print below and choose Save as PDF." });
      return htmlResponse(html, disposition("html"), q.get("download") === "1");
    }
  }
  return htmlResponse(leadsReport({ search: hit.search, leads: hit.leads, by, all, pdfHref }), disposition("html"), q.get("download") === "1");
}

function htmlResponse(html: string, disposition: string, download: boolean) {
  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      // the report only runs its own print button; nothing else
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:",
      ...(download ? { "Content-Disposition": disposition } : {}),
    },
  });
}

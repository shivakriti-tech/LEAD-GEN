export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** For your host's health check: no password needed, says nothing about the data. */
export function GET() {
  return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}

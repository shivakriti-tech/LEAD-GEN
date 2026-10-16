import { readCapped } from "@/lib/http";
import { parseWahaWebhook, wahaConfig, wahaRequestOk } from "@/lib/whatsapp";
import { handleWaEvents } from "@/lib/whatsappEvents";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Events from WAHA, the WhatsApp testing connection (see waha/docker-compose.yml). Off in a live build.
 * Each one must carry WAHA_WEBHOOK_SECRET (?token= in WAHA's hook URL, or an HMAC signature).
 */
export async function POST(req: Request) {
  const c = wahaConfig();
  if (!c) return new Response("Not found", { status: 404 });
  if (!c.webhookSecret) return new Response("Set WAHA_WEBHOOK_SECRET to accept WAHA's events", { status: 403 });
  const raw = await readCapped(req, 1_000_000);
  if (raw === undefined) return new Response("Too large", { status: 413 });
  if (!wahaRequestOk(raw, req.url, req.headers.get("x-webhook-hmac"), c.webhookSecret)) return new Response("Bad token or signature", { status: 401 });
  let events;
  try {
    events = parseWahaWebhook(JSON.parse(raw));
  } catch {
    return new Response("Bad JSON", { status: 400 });
  }
  await handleWaEvents(events);
  return Response.json({ ok: true });
}

import { readCapped } from "@/lib/http";
import { sameSecret } from "@/lib/security";
import { parseWebhook, signatureOk, waConfig } from "@/lib/whatsapp";
import { handleWaEvents } from "@/lib/whatsappEvents";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Meta checks the webhook once: echo its challenge if the verify token matches. */
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const c = waConfig();
  if (q.get("hub.mode") === "subscribe" && c?.provider === "meta" && c.verifyToken && sameSecret(q.get("hub.verify_token") ?? "", c.verifyToken))
    return new Response((q.get("hub.challenge") ?? "").slice(0, 200), { status: 200, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  return new Response("Forbidden", { status: 403 });
}

/** Replies and delivery updates. Only events signed with your app secret are accepted. */
export async function POST(req: Request) {
  const c = waConfig();
  if (c?.provider !== "meta" || !c.appSecret) return new Response("Set WHATSAPP_APP_SECRET to accept WhatsApp events", { status: 403 });
  // anyone can call this address: read at most 1 MB before the signature is checked
  const raw = await readCapped(req, 1_000_000);
  if (raw === undefined) return new Response("Too large", { status: 413 });
  if (!signatureOk(raw, req.headers.get("x-hub-signature-256"), c.appSecret)) return new Response("Bad signature", { status: 401 });
  let events;
  try {
    events = parseWebhook(JSON.parse(raw));
  } catch {
    return new Response("Bad JSON", { status: 400 });
  }
  await handleWaEvents(events);
  return Response.json({ ok: true });
}

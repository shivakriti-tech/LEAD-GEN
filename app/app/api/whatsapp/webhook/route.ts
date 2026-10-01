import { getStore } from "@/lib/store";
import { replyDeps, savedLeads } from "@/lib/mail/send";
import { handleWhatsAppMessage } from "@/lib/agent/inbox";
import { leadsWithNumber, parseWebhook, patchForInbound, signatureOk, updateWaLog, waConfig, waNumber } from "@/lib/whatsapp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Meta checks the webhook once: echo its challenge if the verify token matches. */
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const c = waConfig();
  if (q.get("hub.mode") === "subscribe" && c?.verifyToken && q.get("hub.verify_token") === c.verifyToken) return new Response(q.get("hub.challenge") ?? "", { status: 200 });
  return new Response("Forbidden", { status: 403 });
}

/** Replies and delivery updates. Only events signed with your app secret are accepted. */
export async function POST(req: Request) {
  const c = waConfig();
  const raw = await req.text();
  if (!c?.appSecret) return new Response("Set WHATSAPP_APP_SECRET to accept WhatsApp events", { status: 403 });
  if (!signatureOk(raw, req.headers.get("x-hub-signature-256"), c.appSecret)) return new Response("Bad signature", { status: 401 });
  let events;
  try {
    events = parseWebhook(JSON.parse(raw));
  } catch {
    return new Response("Bad JSON", { status: 400 });
  }
  const inbound = events.filter((e) => e.kind === "message");
  // which saved leads have these numbers (only looked up when someone wrote in)
  const all: Array<{ searchId: string; lead: import("@/lib/types").Lead }> = [];
  const searches = new Map<string, import("@/lib/types").SearchParams>();
  if (inbound.length) {
    const store = getStore();
    for (const s of await store.listSearches()) {
      searches.set(s.id, s.params);
      for (const lead of (await store.getSearch(s.id))?.leads ?? []) all.push({ searchId: s.id, lead });
    }
  }
  for (const e of inbound) {
    const matches = leadsWithNumber(all, e.number);
    await updateWaLog((l) => {
      l.lastInbound[waNumber(e.number)] = e.at;
      l.entries.push({ id: e.id, at: e.at, dir: "in", number: waNumber(e.number), text: e.text?.slice(0, 1000), leadName: matches[0]?.lead.name, searchId: matches[0]?.searchId, leadId: matches[0]?.lead.id });
    });
    for (const m of matches) await savedLeads.patch(m.searchId, m.lead.id, patchForInbound(e.text));
    // the conversation agent reads it and drafts an answer for the Inbox
    if (e.text && matches[0]) {
      const p = searches.get(matches[0].searchId);
      await handleWhatsAppMessage(replyDeps(), { number: waNumber(e.number), text: e.text, at: e.at, id: e.id, searchId: matches[0].searchId, lead: matches[0].lead, clientId: p?.clientId, sender: { company: p?.client?.name } }).catch(() => undefined);
    }
  }
  const statuses = events.filter((e) => e.kind === "status");
  if (statuses.length)
    await updateWaLog((l) => {
      for (const s of statuses) {
        const hit = l.entries.find((x) => x.id === s.id);
        if (hit) hit.status = s.status;
      }
    });
  return Response.json({ ok: true });
}

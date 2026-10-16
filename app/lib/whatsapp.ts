import { isMobile } from "./util";
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { savedDoc } from "./saved";
import type { Lead } from "./types";
import { canContact } from "./outreach";
import { touchKeys, type FollowUpPatch } from "./followups";
import { liveBuild, sameSecret } from "./security";

/**
 * WhatsApp Business Platform (Meta's Cloud API, direct: no reseller markup).
 *
 * WhatsApp's rules: businesses may message people only after they've agreed to it (opted in).
 * So the API here only messages leads who replied or opted in; a first hello to a new lead goes
 * from your own phone (click-to-chat), as before. Outside 24 hours from their last message, only
 * an approved template may be sent (WhatsApp Manager → Message templates).
 *
 *   WHATSAPP_TOKEN            permanent access token (System user in Meta Business settings)
 *   WHATSAPP_PHONE_NUMBER_ID  the sending number's id (WhatsApp Manager → Phone numbers)
 *   WHATSAPP_WABA_ID          WhatsApp Business Account id (to list templates)
 *   WHATSAPP_VERIFY_TOKEN     any secret you choose, typed again in Meta's webhook settings
 *   WHATSAPP_APP_SECRET       the Meta app's secret: incoming events must be signed with it
 *
 * TESTING ONLY, until Meta approves the API: WAHA (devlikeapro/waha, the WhatsApp connection
 * DeskcommCRM uses) runs in Docker on your own computer and sends from a normal WhatsApp number
 * linked by QR code. It isn't official, so WhatsApp can ban that number: use a spare one. The same
 * rules apply (only leads who replied or opted in, free text only within 24 hours). Ignored in a
 * live build, and as soon as WHATSAPP_TOKEN is set.
 *
 *   WAHA_URL                  e.g. http://localhost:3030 (see waha/docker-compose.yml)
 *   WAHA_API_KEY              the key WAHA was started with
 *   WAHA_SESSION              WAHA session name (default "default", the only one WAHA Core has)
 *   WAHA_WEBHOOK_SECRET       any long secret: WAHA's events must carry it (or be signed with it)
 */

export type WaConfig =
  | { provider: "meta"; token: string; phoneNumberId: string; wabaId?: string; verifyToken?: string; appSecret?: string; version: string }
  | { provider: "waha"; url: string; apiKey?: string; session: string; webhookSecret?: string };

export function waConfig(env: Record<string, string | undefined> = process.env): WaConfig | undefined {
  const token = env.WHATSAPP_TOKEN?.trim(), phoneNumberId = env.WHATSAPP_PHONE_NUMBER_ID?.trim();
  if (token && phoneNumberId) return { provider: "meta", token, phoneNumberId, wabaId: env.WHATSAPP_WABA_ID?.trim() || undefined, verifyToken: env.WHATSAPP_VERIFY_TOKEN?.trim() || undefined, appSecret: env.WHATSAPP_APP_SECRET?.trim() || undefined, version: env.WHATSAPP_API_VERSION?.trim() || "v23.0" };
  return wahaConfig(env);
}

/** The WAHA testing connection: only when configured AND not a live build. */
export function wahaConfig(env: Record<string, string | undefined> = process.env): Extract<WaConfig, { provider: "waha" }> | undefined {
  const url = env.WAHA_URL?.trim();
  if (!url || liveBuild(env)) return undefined;
  return { provider: "waha", url: url.replace(/\/+$/, ""), apiKey: env.WAHA_API_KEY?.trim() || undefined, session: env.WAHA_SESSION?.trim() || "default", webhookSecret: env.WAHA_WEBHOOK_SECRET?.trim() || undefined };
}

type MetaConfig = Extract<WaConfig, { provider: "meta" }>;
const graph = (c: MetaConfig, p: string) => `https://graph.facebook.com/${c.version}/${p}`;
/** "+919825012345" → "919825012345" (the API wants digits with the country code). */
export const waNumber = (phone: string) => phone.replace(/\D/g, "").replace(/^0+/, "");

export interface WaTemplate {
  name: string;
  language: string;
  category: string;
  status: string;
  body?: string;
  /** How many {{n}} variables the body has. */
  params: number;
}

export async function listTemplates(c: WaConfig, f: typeof fetch = fetch): Promise<WaTemplate[]> {
  if (c.provider !== "meta" || !c.wabaId) return [];
  const r = await f(`${graph(c, `${c.wabaId}/message_templates`)}?fields=name,status,language,category,components&limit=100`, { headers: { Authorization: `Bearer ${c.token}` } });
  const j = (await r.json().catch(() => ({}))) as { data?: Array<{ name: string; status: string; language: string; category: string; components?: Array<{ type: string; text?: string }> }>; error?: { message?: string } };
  if (!r.ok) throw new Error(`WhatsApp: ${j.error?.message ?? `HTTP ${r.status}`}`);
  return (j.data ?? []).map((t) => {
    const body = t.components?.find((x) => x.type === "BODY")?.text;
    return { name: t.name, language: t.language, category: t.category, status: t.status, body, params: new Set(body?.match(/\{\{\d+\}\}/g) ?? []).size };
  });
}

export type WaSend = { kind: "template"; name: string; language: string; params: string[] } | { kind: "text"; text: string };

export async function sendWhatsApp(c: WaConfig, to: string, msg: WaSend, f: typeof fetch = fetch): Promise<{ id: string }> {
  if (c.provider === "waha") return sendWaha(c, to, msg, f);
  const body =
    msg.kind === "template"
      ? { messaging_product: "whatsapp", to: waNumber(to), type: "template", template: { name: msg.name, language: { code: msg.language }, components: msg.params.length ? [{ type: "body", parameters: msg.params.map((text) => ({ type: "text", text })) }] : undefined } }
      : { messaging_product: "whatsapp", to: waNumber(to), type: "text", text: { body: msg.text, preview_url: false } };
  const r = await f(graph(c, `${c.phoneNumberId}/messages`), { method: "POST", headers: { Authorization: `Bearer ${c.token}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const j = (await r.json().catch(() => ({}))) as { messages?: Array<{ id: string }>; error?: { message?: string; code?: number } };
  if (!r.ok || !j.messages?.[0]?.id) {
    const m = j.error?.message ?? `HTTP ${r.status}`;
    throw new Error(j.error?.code === 131047 || /24 hours|re-engagement/i.test(m) ? "More than 24 hours since their last message: send an approved template instead" : `WhatsApp: ${m}`);
  }
  return { id: j.messages[0].id };
}

/** WAHA: POST /api/sendText. It has no templates (those are Meta's), so only free text goes. */
async function sendWaha(c: Extract<WaConfig, { provider: "waha" }>, to: string, msg: WaSend, f: typeof fetch): Promise<{ id: string }> {
  if (msg.kind !== "text") throw new Error("The WAHA testing connection can't send WhatsApp templates (they're Meta's): wait for them to write again, or use Meta's API");
  const r = await f(`${c.url}/api/sendText`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(c.apiKey ? { "X-Api-Key": c.apiKey } : {}) },
    body: JSON.stringify({ session: c.session, chatId: `${waNumber(to)}@c.us`, text: msg.text }),
    signal: AbortSignal.timeout(20_000),
  });
  const j = (await r.json().catch(() => ({}))) as { id?: string | { _serialized?: string; id?: string }; key?: { id?: string }; message?: string; error?: string };
  if (!r.ok) {
    const m = j.message ?? j.error ?? `HTTP ${r.status}`;
    throw new Error(r.status === 401 ? "WAHA: wrong WAHA_API_KEY" : /session|STOPPED|SCAN_QR|FAILED/i.test(m) ? `WAHA: the WhatsApp session isn't connected (${m}). Open the WAHA dashboard and scan the QR code` : `WAHA: ${m}`);
  }
  const id = typeof j.id === "string" ? j.id : j.id?._serialized ?? j.id?.id ?? j.key?.id;
  return { id: id || `waha-${randomUUID()}` };
}

/** Is WAHA's WhatsApp session linked? "WORKING" means yes; "SCAN_QR_CODE" means scan it in WAHA's dashboard. */
export async function wahaStatus(c: Extract<WaConfig, { provider: "waha" }>, f: typeof fetch = fetch): Promise<{ status: string; error?: string }> {
  try {
    const r = await f(`${c.url}/api/sessions/${encodeURIComponent(c.session)}`, { headers: c.apiKey ? { "X-Api-Key": c.apiKey } : {}, signal: AbortSignal.timeout(5_000) });
    if (r.status === 404) return { status: "STOPPED", error: `No session "${c.session}" yet: start it in WAHA's dashboard` };
    if (r.status === 401) return { status: "UNKNOWN", error: "WAHA refused WAHA_API_KEY" };
    const j = (await r.json().catch(() => ({}))) as { status?: string };
    return { status: j.status ?? "UNKNOWN" };
  } catch {
    return { status: "UNKNOWN", error: `WAHA isn't answering at ${c.url}: is its Docker container running?` };
  }
}

/* ---------- log: what was sent and received, and each number's last message (for the 24-hour window) ---------- */

export interface WaLogEntry {
  id: string;
  at: string;
  dir: "out" | "in";
  number: string;
  leadName?: string;
  searchId?: string;
  leadId?: string;
  text?: string;
  template?: string;
  status?: string;
}
export interface WaLog {
  entries: WaLogEntry[];
  lastInbound: Record<string, string>;
}
const logDoc = () => savedDoc<WaLog>("outreach/whatsapp", () => ({ entries: [], lastInbound: {} }));
export async function readWaLog(): Promise<WaLog> {
  return logDoc().read();
}
let chain: Promise<unknown> = Promise.resolve();
export function updateWaLog<T>(fn: (l: WaLog) => T): Promise<T> {
  const run = chain.then(async () => {
    const l = await readWaLog();
    const out = fn(l);
    l.entries = l.entries.slice(-2000);
    await logDoc().write(l);
    return out;
  });
  chain = run.catch(() => {});
  return run;
}

/** Can a free-text message go now (they wrote in the last 24 hours), or only a template? */
export const withinWindow = (log: Pick<WaLog, "lastInbound">, phone: string, now = Date.now()) => {
  const last = log.lastInbound[waNumber(phone)];
  return !!last && now - Date.parse(last) < 24 * 3600_000;
};

/** May the API message this lead now, and how? */
export function waPlan(l: Pick<Lead, "followUp" | "phone" | "phones" | "audit">, log: Pick<WaLog, "lastInbound">, now = Date.now()): { ok: boolean; why?: string; number?: string; freeText?: boolean } {
  const can = canContact(l, "whatsapp_api");
  if (!can.ok) return { ok: false, why: can.why };
  const number = l.audit?.whatsapp ?? [l.phone, ...(l.phones ?? [])].find((p) => isMobile(p));
  if (!number) return { ok: false, why: "No mobile number" };
  return { ok: true, number, freeText: withinWindow(log, number, now) };
}

/* ---------- webhook: Meta tells us about replies and delivery ---------- */

/** Meta signs each webhook with the app secret (X-Hub-Signature-256). */
export function signatureOk(raw: string, header: string | null, appSecret: string): boolean {
  if (!header?.startsWith("sha256=")) return false;
  const want = Buffer.from(createHmac("sha256", appSecret).update(raw).digest("hex"));
  const got = Buffer.from(header.slice(7));
  return want.length === got.length && timingSafeEqual(want, got);
}

export interface WaEvent {
  kind: "message" | "status";
  number: string;
  id: string;
  at: string;
  text?: string;
  status?: string;
}
export function parseWebhook(body: unknown): WaEvent[] {
  const out: WaEvent[] = [];
  const entries = (body as { entry?: Array<{ changes?: Array<{ value?: Record<string, unknown> }> }> })?.entry ?? [];
  for (const e of entries)
    for (const ch of e.changes ?? []) {
      const v = ch.value ?? {};
      for (const m of (v.messages as Array<{ from: string; id: string; timestamp: string; text?: { body?: string }; button?: { text?: string }; interactive?: { button_reply?: { title?: string } } }>) ?? [])
        out.push({ kind: "message", number: m.from, id: m.id, at: new Date(Number(m.timestamp) * 1000).toISOString(), text: m.text?.body ?? m.button?.text ?? m.interactive?.button_reply?.title });
      for (const s of (v.statuses as Array<{ id: string; status: string; recipient_id: string; timestamp: string }>) ?? [])
        out.push({ kind: "status", number: s.recipient_id, id: s.id, at: new Date(Number(s.timestamp) * 1000).toISOString(), status: s.status });
    }
  return out;
}

/* ---------- WAHA's events (testing connection) ---------- */

/**
 * WAHA calls WHATSAPP_HOOK_URL for each event. It must carry the secret: as ?token= in that URL, or
 * as an HMAC-SHA512 of the body in X-Webhook-Hmac (WHATSAPP_HOOK_HMAC_KEY). A wrong signature is
 * always refused, even when the token is right.
 */
export function wahaRequestOk(raw: string, url: string, hmacHeader: string | null, secret: string): boolean {
  if (hmacHeader) {
    const want = Buffer.from(createHmac("sha512", secret).update(raw, "utf8").digest("hex"));
    const got = Buffer.from(hmacHeader.replace(/^sha512=/i, "").trim());
    return want.length === got.length && timingSafeEqual(want, got);
  }
  const token = new URL(url).searchParams.get("token") ?? "";
  return token.length > 0 && sameSecret(token, secret);
}

/** "919825012345@c.us" → "919825012345". Newer WhatsApp hides the number behind an @lid id and sends it in _data.key.remoteJidAlt. */
function wahaPhone(p: { from?: unknown; to?: unknown; fromMe?: unknown; _data?: { key?: { remoteJidAlt?: unknown } } }): string | undefined {
  const chat = String((p.fromMe ? p.to : p.from) ?? "");
  if (/@(c\.us|s\.whatsapp\.net)$/.test(chat)) return waNumber(chat.split("@")[0]);
  const alt = p._data?.key?.remoteJidAlt;
  if (/@lid$/.test(chat) && typeof alt === "string" && /@(c\.us|s\.whatsapp\.net)$/.test(alt)) return waNumber(alt.split("@")[0]);
  return undefined; // a group, a status update, a channel: not a lead
}

const ACK: Record<string, string> = { PENDING: "sent", SERVER: "sent", DEVICE: "delivered", READ: "read", PLAYED: "read", ERROR: "failed" };

/** WAHA's event → the same events Meta's webhook gives. Only people writing to you ("message", not your own) and delivery updates. */
export function parseWahaWebhook(body: unknown): WaEvent[] {
  const e = body as { event?: string; payload?: Record<string, any> } | null;
  const p = e?.payload;
  if (!p || typeof p !== "object") return [];
  const at = new Date(typeof p.timestamp === "number" ? (p.timestamp > 1e12 ? p.timestamp : p.timestamp * 1000) : Date.now()).toISOString();
  const id = typeof p.id === "string" ? p.id : String(p.id?._serialized ?? "");
  if (e!.event === "message" && !p.fromMe) {
    const number = wahaPhone(p);
    return number && id ? [{ kind: "message", number, id, at, text: typeof p.body === "string" && p.body ? p.body : undefined }] : [];
  }
  if (e!.event === "message.ack" && p.fromMe) {
    const number = wahaPhone(p), status = ACK[String(p.ackName ?? "").toUpperCase()];
    return number && id && status ? [{ kind: "status", number, id, at, status }] : [];
  }
  return [];
}

/** "STOP", "unsubscribe", "don't message", Hindi/Hinglish too. */
export const isStop = (text?: string) => !!text && /^\s*(stop|unsubscribe|opt[ -]?out|don'?t (message|msg|contact)|mat bhejo|band karo|message mat karo|nahi chahiye)\b/i.test(text);

/** What to record on a lead for an incoming message: a reply (and opt-in), or an opt-out. */
export function patchForInbound(text?: string): FollowUpPatch {
  return isStop(text) ? { optOut: { via: "WhatsApp: asked to stop" } } : { replied: true, optIn: { via: "WhatsApp message" } };
}

/** Leads (across saved searches) with this number. */
export function leadsWithNumber<T extends { searchId: string; lead: Pick<Lead, "id" | "phone" | "phones" | "placeId"> }>(all: T[], number: string): T[] {
  const key = `p:${waNumber(number).slice(-10)}`;
  return all.filter((x) => touchKeys(x.lead).includes(key));
}

export const newId = () => randomUUID();

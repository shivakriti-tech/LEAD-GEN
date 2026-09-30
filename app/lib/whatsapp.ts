import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { Lead } from "./types";
import { canContact } from "./outreach";
import { touchKeys, type FollowUpPatch } from "./followups";

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
 */

export interface WaConfig {
  token: string;
  phoneNumberId: string;
  wabaId?: string;
  verifyToken?: string;
  appSecret?: string;
  version: string;
}
export function waConfig(env: Record<string, string | undefined> = process.env): WaConfig | undefined {
  const token = env.WHATSAPP_TOKEN?.trim(), phoneNumberId = env.WHATSAPP_PHONE_NUMBER_ID?.trim();
  if (!token || !phoneNumberId) return undefined;
  return { token, phoneNumberId, wabaId: env.WHATSAPP_WABA_ID?.trim() || undefined, verifyToken: env.WHATSAPP_VERIFY_TOKEN?.trim() || undefined, appSecret: env.WHATSAPP_APP_SECRET?.trim() || undefined, version: env.WHATSAPP_API_VERSION?.trim() || "v23.0" };
}

const graph = (c: WaConfig, p: string) => `https://graph.facebook.com/${c.version}/${p}`;
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
  if (!c.wabaId) return [];
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
const logFile = () => path.join(process.cwd(), ".data", "outreach", "whatsapp.json");
export async function readWaLog(): Promise<WaLog> {
  try {
    return JSON.parse(await fs.readFile(logFile(), "utf8")) as WaLog;
  } catch {
    return { entries: [], lastInbound: {} };
  }
}
let chain: Promise<unknown> = Promise.resolve();
export function updateWaLog<T>(fn: (l: WaLog) => T): Promise<T> {
  const run = chain.then(async () => {
    const l = await readWaLog();
    const out = fn(l);
    l.entries = l.entries.slice(-2000);
    await fs.mkdir(path.dirname(logFile()), { recursive: true });
    await fs.writeFile(logFile(), JSON.stringify(l));
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
  const number = l.audit?.whatsapp ?? [l.phone, ...(l.phones ?? [])].find((p) => p && /^\+91[6-9]\d{9}$/.test(p));
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

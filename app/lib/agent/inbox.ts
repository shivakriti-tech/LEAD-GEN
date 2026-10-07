import path from "node:path";
import { fileDoc, savedDoc } from "../saved";
import { randomUUID } from "node:crypto";
import type { ClientBrain } from "../brain";
import type { FollowUpPatch } from "../followups";
import { messageForStep, type Sender } from "../outreach";
import type { Lead } from "../types";
import { checkContent } from "../mail/guard";
import type { Mailbox } from "../mail/mailboxes";
import { applyInbox, mutate, signature, type LeadAccess, type QueueStore, type SendDeps } from "../mail/queue";
import { emailHtml } from "../mail/html";
import { emailLetter } from "../mail/letter";
import { runAgent, type AgentResult, type Msg } from "./agent";

/**
 * The inbox: every reply from a lead, what it means, and the drafted answer waiting for you.
 * Saved in Supabase (app_state) or .data/outreach/inbox.json.
 */

export type ConvStatus = "drafted" | "handoff" | "sent" | "closed";
export interface Conversation {
  id: string;
  channel: "email" | "whatsapp";
  /** Their email address or WhatsApp number. */
  address: string;
  searchId?: string;
  leadId?: string;
  leadName?: string;
  clientId?: string;
  mailbox?: string;
  subject?: string;
  /** For the email thread: the message to reply to, and the chain before it. */
  lastMessageId?: string;
  references?: string[];
  sender?: Sender;
  country?: string;
  messages: Array<Msg & { id?: string; by?: "you" | "agent" }>;
  agent?: AgentResult;
  draft?: string;
  status: ConvStatus;
  updatedAt: string;
}
export interface InboxData {
  conversations: Conversation[];
}
export interface InboxStore {
  read(): Promise<InboxData>;
  write(d: InboxData): Promise<void>;
}

const emptyInbox = (): InboxData => ({ conversations: [] });
/** The app's inbox: Supabase when it's set up, otherwise .data/outreach/inbox.json. */
export function inboxStore(): InboxStore {
  return savedDoc("outreach/inbox", emptyInbox);
}
export function localInboxStore(file = () => path.join(/*turbopackIgnore: true*/ process.cwd(), ".data", "outreach", "inbox.json")): InboxStore {
  return fileDoc(file, emptyInbox);
}
export function memoryInboxStore(init: InboxData = { conversations: [] }): InboxStore & { data: InboxData } {
  const s = { data: init, read: async () => s.data, write: async (d: InboxData) => void (s.data = d) };
  return s;
}
let chain: Promise<unknown> = Promise.resolve();
export function updateInbox<T>(store: InboxStore, fn: (d: InboxData) => T | Promise<T>): Promise<T> {
  const run = chain.then(async () => {
    const d = await store.read();
    const out = await fn(d);
    d.conversations = d.conversations.slice(-1000);
    await store.write(d);
    return out;
  });
  chain = run.catch(() => {});
  return run;
}

const addDays = (now: Date, n: number) => new Date(now.getTime() + n * 86_400_000).toISOString().slice(0, 10);

/** What the reply changes on the lead. */
export function patchFor(r: AgentResult, now = new Date()): FollowUpPatch | undefined {
  switch (r.intent) {
    case "out_of_office":
      return undefined;
    case "unsubscribe":
      return { optOut: { via: "Email: asked to unsubscribe" } };
    case "not_interested":
      return { status: "lost", note: `Said no: ${r.summary}`.slice(0, 300) };
    case "not_now":
      return { replied: true, followUpOn: addDays(now, 90), note: `Not now: ${r.summary}`.slice(0, 300) };
    case "referral":
      return { replied: true, note: `Referred to ${r.referral ?? "someone else"}` };
    default:
      return { replied: true };
  }
}

/** Intents the agent may answer by itself when AGENT_AUTO_SEND=safe: polite closes, never sales talk. */
export const SAFE_AUTO = new Set(["not_now", "not_interested", "wrong_person", "referral"]);

/**
 * A polite close the agent may send by itself: short, no links, no email addresses or numbers. A
 * reply that was talked into more than that (a message telling the AI what to write) waits for you.
 */
export const autoSafe = (reply: string) => reply.length <= 600 && !/https?:\/\/|www\.|@|\d{3,}/i.test(reply);

export interface ReplyDeps {
  inbox: InboxStore;
  queue: QueueStore;
  leads: LeadAccess;
  mailboxes: Mailbox[];
  send: SendDeps["send"];
  brainFor: (clientId?: string) => Promise<ClientBrain | null>;
  agent?: typeof runAgent;
  env?: Record<string, string | undefined>;
  now?: () => Date;
}

/** A reply by email from someone we emailed: log it, read it, draft the answer, update the lead. */
export async function handleEmailReply(deps: ReplyDeps, r: { mailbox: string; address: string; subject: string; text: string; messageId?: string; references?: string[]; at: string }): Promise<Conversation | undefined> {
  const now = deps.now?.() ?? new Date();
  const env = deps.env ?? process.env;
  const addr = r.address.toLowerCase();
  const q = await deps.queue.read();
  const sent = q.items.filter((i) => i.to.toLowerCase() === addr && i.status === "sent").sort((a, b) => (a.sentAt ?? "").localeCompare(b.sentAt ?? ""));
  const latest = sent.at(-1);
  if (!latest) return undefined; // not someone we emailed
  const lead = await deps.leads.get(latest.searchId, latest.leadId);
  const existing = (await deps.inbox.read()).conversations.find((c) => c.channel === "email" && c.address === addr);
  if (r.messageId && existing?.messages.some((m) => m.id === r.messageId)) return undefined; // seen already

  // the thread as the agent sees it: what we sent (rewritten from the lead), then their messages
  const ours: Msg[] = lead ? sent.map((i) => ({ dir: "out" as const, at: i.sentAt!, text: messageForStep(lead, i.lang, i.sender, i.tone, i.step) })) : [];
  const thread: Msg[] = [...(existing?.messages ?? ours), { dir: "in", text: r.text, at: r.at }];
  const brain = await deps.brainFor(latest.clientId).catch(() => null);
  const result = await (deps.agent ?? runAgent)({ lead: lead ?? { name: latest.leadName, category: "", whyNow: "" }, brain, sender: latest.sender, subject: r.subject || latest.threadSubject || "", thread, now, env });

  // the lead: replied, lost, opted out, or later
  const p = patchFor(result, now);
  if (lead && p) await deps.leads.patch(latest.searchId, latest.leadId, p);
  await mutate(deps.queue, (x) => {
    if (result.intent === "unsubscribe") applyInbox(x, latest.mailbox ?? r.mailbox, [{ kind: "unsubscribe", address: addr }], now);
    // away: the next follow-up waits until they're back, and their auto-reply doesn't count as a reply
    if (result.intent === "out_of_office")
      for (const i of x.items)
        if (i.status === "queued" && i.to.toLowerCase() === addr) {
          const back = result.returnOn ? Date.parse(`${result.returnOn}T00:00:00Z`) + 86_400_000 : now.getTime() + 7 * 86_400_000;
          i.notBefore = new Date(Math.max(Date.parse(i.notBefore), back)).toISOString();
          i.replyCheckFrom = now.toISOString();
        }
  });

  const closed = !result.reply || result.intent === "out_of_office" || result.intent === "unsubscribe";
  const conv: Conversation = {
    id: existing?.id ?? randomUUID(),
    channel: "email",
    address: addr,
    searchId: latest.searchId,
    leadId: latest.leadId,
    leadName: latest.leadName,
    clientId: latest.clientId,
    mailbox: latest.mailbox ?? r.mailbox,
    subject: (r.subject || latest.threadSubject || "").replace(/^(re:\s*)+/i, ""),
    lastMessageId: r.messageId,
    references: [...(r.references ?? latest.references ?? []), ...(latest.messageId ? [latest.messageId] : [])].filter((v, i, a) => a.indexOf(v) === i).slice(-10),
    sender: latest.sender,
    country: latest.country,
    messages: [...thread.slice(0, -1), { dir: "in", text: r.text, at: r.at, id: r.messageId }],
    agent: result,
    draft: result.reply,
    status: closed ? "closed" : result.handoff ? "handoff" : "drafted",
    updatedAt: now.toISOString(),
  };
  await updateInbox(deps.inbox, (d) => {
    d.conversations = [...d.conversations.filter((c) => c.id !== conv.id), conv];
  });
  if (!closed && !result.handoff && /^safe$/i.test(env.AGENT_AUTO_SEND ?? "") && SAFE_AUTO.has(result.intent) && result.reply && autoSafe(result.reply)) await sendEmailReply(deps, conv.id, result.reply, "agent");
  return conv;
}

/** Send an answer in the email thread, from the mailbox that started it. */
export async function sendEmailReply(deps: Pick<ReplyDeps, "inbox" | "mailboxes" | "send" | "now">, convId: string, text: string, by: "you" | "agent" = "you"): Promise<{ ok: boolean; error?: string }> {
  const now = deps.now?.() ?? new Date();
  const conv = (await deps.inbox.read()).conversations.find((c) => c.id === convId);
  if (!conv || conv.channel !== "email") return { ok: false, error: "Conversation not found" };
  const mbox = deps.mailboxes.find((m) => m.email === conv.mailbox);
  if (!mbox) return { ok: false, error: `The mailbox ${conv.mailbox} isn't set up any more` };
  const sender = conv.sender ?? {};
  // laid out as an email, with any sign-off removed: the signature (closing, name, company) follows
  const body = emailLetter(text, sender);
  if (!body) return { ok: false, error: "Write a reply first" };
  const spam = checkContent(`Re: ${conv.subject ?? ""}`, body).block[0];
  if (spam) return { ok: false, error: `Spam check: ${spam}` };
  const fromName = sender.name ? `${sender.name}${sender.company ? `, ${sender.company}` : ""}` : mbox.name;
  try {
    const { messageId } = await deps.send(mbox, { from: fromName ? `"${fromName.replace(/"/g, "")}" <${mbox.email}>` : mbox.email, to: conv.address, subject: `Re: ${conv.subject ?? ""}`.trim(), text: body + signature(sender), html: emailHtml(body + signature(sender), sender, { subject: `Re: ${conv.subject ?? ""}`.trim() }), inReplyTo: conv.lastMessageId, references: [...(conv.references ?? []), ...(conv.lastMessageId ? [conv.lastMessageId] : [])] });
    await updateInbox(deps.inbox, (d) => {
      const c = d.conversations.find((x) => x.id === convId);
      if (!c) return;
      c.messages.push({ dir: "out", text: body, at: now.toISOString(), id: messageId, by });
      c.references = [...(c.references ?? []), ...(c.lastMessageId ? [c.lastMessageId] : [])].slice(-10);
      c.lastMessageId = messageId;
      c.draft = undefined;
      c.status = "sent";
      c.updatedAt = now.toISOString();
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** A WhatsApp message from a lead: same reading and drafting; you send it from the Inbox. */
export async function handleWhatsAppMessage(deps: Pick<ReplyDeps, "inbox" | "leads" | "brainFor" | "agent" | "env" | "now">, m: { number: string; text: string; at: string; id: string; searchId?: string; lead?: Lead; sender: Sender; clientId?: string }): Promise<Conversation | undefined> {
  const now = deps.now?.() ?? new Date();
  const existing = (await deps.inbox.read()).conversations.find((c) => c.channel === "whatsapp" && c.address === m.number);
  if (existing?.messages.some((x) => x.id === m.id)) return undefined;
  const thread: Msg[] = [...(existing?.messages ?? []), { dir: "in", text: m.text, at: m.at }];
  const brain = await deps.brainFor(m.clientId).catch(() => null);
  const result = await (deps.agent ?? runAgent)({ lead: m.lead ?? { name: m.number, category: "", whyNow: "" }, brain, sender: m.sender, subject: "WhatsApp", thread, now, env: deps.env });
  const conv: Conversation = {
    id: existing?.id ?? randomUUID(),
    channel: "whatsapp",
    address: m.number,
    searchId: m.searchId,
    leadId: m.lead?.id,
    leadName: m.lead?.name ?? existing?.leadName,
    clientId: m.clientId,
    sender: m.sender,
    messages: [...thread.slice(0, -1), { dir: "in", text: m.text, at: m.at, id: m.id }],
    agent: result,
    draft: result.reply,
    status: !result.reply || result.intent === "unsubscribe" ? "closed" : result.handoff ? "handoff" : "drafted",
    updatedAt: now.toISOString(),
  };
  await updateInbox(deps.inbox, (d) => {
    d.conversations = [...d.conversations.filter((c) => c.id !== conv.id), conv];
  });
  return conv;
}

import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { Lead } from "../types";
import type { FollowUpPatch } from "../followups";
import { CADENCE, canContact, followUpAfter, MAX_STEPS, messageForStep, nextStep, statusOf, subjectLine, type Lang, type Sender, type Tone } from "../outreach";
import { dailyCap, inSendWindow, istParts, type Mailbox } from "./mailboxes";
import { inOfficeHours } from "../markets";
import { checkContent, companyKey, isBlock, isHardBounce, PER_COMPANY_DAY, pauseFor, recipientProblem, type Suppression } from "./guard";

/**
 * The email send queue. Emails wait here and go out one at a time: in Indian business hours, from a
 * mailbox that still has room today (warm-up), a few minutes apart, and only after checking again
 * that the lead may still be emailed (no reply yet, didn't opt out, not a customer).
 */

export type ItemStatus = "queued" | "sent" | "failed" | "skipped" | "cancelled";
export interface EmailItem {
  id: string;
  createdAt: string;
  searchId: string;
  leadId: string;
  leadName: string;
  to: string;
  /** 0 first message, 1 follow-up, 2 last follow-up. */
  step: number;
  lang: Lang;
  tone: Exclude<Tone, "follow">;
  /** Who it's from (your details with the client's Business Brain), as it was when queued. */
  sender: Sender;
  clientId?: string;
  /** Where the lead is: emails go in their office hours (their time zone, their working week). */
  country?: string;
  lng?: number;
  /** Your own text for this email; otherwise it's written when it's sent. */
  subject?: string;
  body?: string;
  /** Queue the follow-ups after this one (they're checked again before each goes out). */
  followUps: boolean;
  /** The mailbox that sent the first email: follow-ups come from the same one, in the same thread. */
  mailbox?: string;
  inReplyTo?: string;
  references?: string[];
  threadSubject?: string;
  notBefore: string;
  status: ItemStatus;
  reason?: string;
  sentAt?: string;
  messageId?: string;
  sentSubject?: string;
}
export interface MailboxState {
  startedOn: string;
  sent: Record<string, number>;
  lastAt?: string;
  nextAt?: string;
  error?: string;
  /** Paused for a while (bounces, a block, missing DNS records); sending resumes after this. */
  pausedUntil?: string;
  pauseReason?: string;
  /** Bounces and spam complaints per day (YYYY-MM-DD), for the auto-pause. */
  bounces?: Record<string, number>;
  complaints?: Record<string, number>;
  /** Last time the inbox was read for bounces and unsubscribe replies. */
  scannedAt?: string;
}
export interface QueueData {
  items: EmailItem[];
  mailboxes: Record<string, MailboxState>;
  /** Addresses never to email again (bounced, unsubscribed, complained), across all searches. */
  suppressed?: Record<string, Suppression>;
}
export interface QueueStore {
  read(): Promise<QueueData>;
  write(d: QueueData): Promise<void>;
}

export function localQueueStore(file = () => path.join(process.cwd(), ".data", "outreach", "email.json")): QueueStore {
  return {
    async read() {
      try {
        return JSON.parse(await fs.readFile(file(), "utf8")) as QueueData;
      } catch {
        return { items: [], mailboxes: {} };
      }
    },
    async write(d) {
      await fs.mkdir(path.dirname(file()), { recursive: true });
      const tmp = `${file()}.tmp`;
      await fs.writeFile(tmp, JSON.stringify(d));
      await fs.rename(tmp, file());
    },
  };
}
export function memoryQueueStore(init: QueueData = { items: [], mailboxes: {} }): QueueStore & { data: QueueData } {
  const box = { data: structuredClone(init) };
  return {
    get data() {
      return box.data;
    },
    async read() {
      return structuredClone(box.data);
    },
    async write(d) {
      box.data = structuredClone(d);
    },
  };
}

/** One change at a time, so two requests can't overwrite each other's edits. */
let chain: Promise<unknown> = Promise.resolve();
export function mutate<T>(store: QueueStore, fn: (d: QueueData) => T | Promise<T>): Promise<T> {
  const run = chain.then(async () => {
    const d = await store.read();
    const out = await fn(d);
    await store.write(d);
    return out;
  });
  chain = run.catch(() => {});
  return run;
}

export function subjectFor(l: Pick<Lead, "name" | "pitchFor">): string {
  return subjectLine(l);
}

/** The line under every email: who it's from and how to stop them. */
export function footer(sender: Sender, mailbox: Pick<Mailbox, "email">): string {
  const who = [sender.name, sender.company].filter(Boolean).join(", ");
  return `\n\n--\n${who ? `${who}\n` : ""}${sender.address ? `${sender.address}\n` : ""}${mailbox.email}\nIf you'd rather not get these emails, just reply and say so, and we won't email again.`;
}

/** US (CAN-SPAM) and Canadian (CASL) law: marketing email must carry the sender's postal address. */
export const NEEDS_ADDRESS = new Set(["US", "CA"]);

/** Access to leads (in saved searches) for the queue: read one, and record what happened. */
export interface LeadAccess {
  get(searchId: string, leadId: string): Promise<Lead | undefined>;
  patch(searchId: string, leadId: string, p: FollowUpPatch): Promise<void>;
}

export interface EnqueueRequest {
  searchId: string;
  leads: Lead[];
  lang: Lang;
  tone: Exclude<Tone, "follow">;
  sender: Sender;
  clientId?: string;
  followUps: boolean;
  /** Your edited text per lead id, for the first email. */
  texts?: Record<string, string>;
}
export interface EnqueueResult {
  queued: number;
  skipped: Array<{ leadId: string; name: string; why: string }>;
}

/** Add each lead's next email to the queue, or say why not. */
export function enqueue(d: QueueData, r: EnqueueRequest, now = new Date()): EnqueueResult {
  const out: EnqueueResult = { queued: 0, skipped: [] };
  for (const l of r.leads) {
    const skip = (why: string) => out.skipped.push({ leadId: l.id, name: l.name, why });
    if (!l.email) {
      skip("No email address");
      continue;
    }
    const can = canContact(l, "email");
    if (!can.ok) {
      skip(can.why!);
      continue;
    }
    const bad = recipientProblem(l.email, l.emailInfo?.find((e) => e.email.toLowerCase() === l.email!.toLowerCase()), d.suppressed);
    if (bad) {
      skip(bad);
      continue;
    }
    const own = r.texts?.[l.id];
    const spam = own ? checkContent(subjectLine(l), own).block : [];
    if (spam.length) {
      skip(`Spam check: ${spam[0]}`);
      continue;
    }
    if (NEEDS_ADDRESS.has(l.country ?? "IN") && !r.sender.address?.trim()) {
      skip("Emails to the US and Canada must include your postal address: add it under Your details");
      continue;
    }
    if (d.items.some((i) => i.searchId === r.searchId && i.leadId === l.id && i.status === "queued")) {
      skip("Already in the queue");
      continue;
    }
    const step = nextStep(l);
    if (step >= MAX_STEPS) {
      skip("Already had a first message and two follow-ups");
      continue;
    }
    // an earlier email from the queue: stay in its thread and mailbox
    const prev = d.items.filter((i) => i.searchId === r.searchId && i.leadId === l.id && i.status === "sent").sort((a, b) => (a.sentAt ?? "").localeCompare(b.sentAt ?? "")).at(-1);
    d.items.push({
      id: randomUUID(),
      createdAt: now.toISOString(),
      searchId: r.searchId,
      leadId: l.id,
      leadName: l.name,
      to: l.email,
      step,
      lang: r.lang,
      tone: r.tone,
      sender: r.sender,
      clientId: r.clientId,
      country: l.country ?? "IN",
      lng: l.lng,
      body: step === 0 ? r.texts?.[l.id]?.slice(0, 5000) : undefined,
      followUps: r.followUps,
      mailbox: prev?.mailbox,
      inReplyTo: prev?.messageId,
      references: prev ? [...(prev.references ?? []), prev.messageId!].filter(Boolean) : undefined,
      threadSubject: prev?.threadSubject ?? prev?.sentSubject,
      notBefore: now.toISOString(),
      status: "queued",
    });
    out.queued++;
  }
  return out;
}

export interface SendDeps {
  store: QueueStore;
  leads: LeadAccess;
  mailboxes: Mailbox[];
  send: (m: Mailbox, mail: { from: string; to: string; subject: string; text: string; inReplyTo?: string; references?: string[]; listUnsubscribe: string }) => Promise<{ messageId: string }>;
  /** Why this mailbox's domain isn't fit to send (missing SPF / DMARC), or undefined when it is. */
  domainProblem?: (m: Mailbox) => Promise<string | undefined>;
  /** Did this address reply to the mailbox since then? (IMAP) Undefined when it can't be checked. */
  replied?: (m: Mailbox, from: string, since: Date) => Promise<boolean | undefined>;
  now?: () => Date;
  rand?: () => number;
}

/** Minutes between two emails from one mailbox: 3–7, so the pattern doesn't look like a script. */
const gapMs = (rand: () => number) => (3 + rand() * 4) * 60_000;

/**
 * Send at most one email (the next one due). Returns what happened, for the log and tests.
 * Called every 30 seconds by the worker.
 */
export async function tick(deps: SendDeps): Promise<{ did: "sent" | "skipped" | "failed" | "idle"; detail?: string; itemId?: string }> {
  const now = deps.now?.() ?? new Date();
  const rand = deps.rand ?? Math.random;
  if (!deps.mailboxes.length) return { did: "idle", detail: "No mailboxes set up" };
  const today = istParts(now).date;

  const d = await deps.store.read();
  for (const m of deps.mailboxes) d.mailboxes[m.email] ??= { startedOn: m.start ?? today, sent: {} };
  // due now, and within office hours where the lead is (India: Mon–Sat 10:00–18:30 as before)
  const officeHours = (i: EmailItem) => (!i.country || i.country === "IN" ? inSendWindow(now) : inOfficeHours(now, i.country, i.lng));
  const queuedDue = d.items.filter((i) => i.status === "queued" && Date.parse(i.notBefore) <= now.getTime()).sort((a, b) => a.notBefore.localeCompare(b.notBefore));
  const due = queuedDue.filter(officeHours);
  if (queuedDue.length && !due.length) return { did: "idle", detail: "Waiting for office hours where the leads are" };
  const room = (m: Mailbox) => {
    const st = d.mailboxes[m.email];
    return !st.error && !(st.pausedUntil && Date.parse(st.pausedUntil) > now.getTime()) && (st.sent[today] ?? 0) < dailyCap(m, m.start ?? st.startedOn, today) && (!st.nextAt || Date.parse(st.nextAt) <= now.getTime());
  };

  for (const item of due) {
    const finish = async (status: ItemStatus, reason: string) => {
      await mutate(deps.store, (x) => {
        const it = x.items.find((i) => i.id === item.id);
        if (it) Object.assign(it, { status, reason });
      });
      return { did: status === "skipped" || status === "cancelled" ? ("skipped" as const) : ("failed" as const), detail: reason, itemId: item.id };
    };
    const lead = await deps.leads.get(item.searchId, item.leadId);
    if (!lead) return finish("skipped", "The lead was deleted");
    const can = canContact(lead, "email");
    if (!can.ok) return finish("skipped", can.why!);
    if (item.step > 0 && ["replied", "meeting", "interested", "won", "lost"].includes(statusOf(lead))) return finish("skipped", "They replied, so no follow-up");
    const bad = recipientProblem(item.to, lead.emailInfo?.find((e) => e.email.toLowerCase() === item.to.toLowerCase()), d.suppressed);
    if (bad) return finish("skipped", bad);
    // a few emails a day to one company at most: several at once looks like a blast to its mail server
    const co = companyKey(item.to);
    if (d.items.filter((i) => i.status === "sent" && i.sentAt && companyKey(i.to) === co && istParts(new Date(i.sentAt)).date === today).length >= PER_COMPANY_DAY) continue;
    // follow-ups stay with the mailbox that started the thread
    const mbox = item.mailbox ? deps.mailboxes.find((m) => m.email === item.mailbox) : deps.mailboxes.filter(room).sort((a, b) => (d.mailboxes[a.email].sent[today] ?? 0) - (d.mailboxes[b.email].sent[today] ?? 0))[0];
    if (item.mailbox && !mbox) return finish("skipped", `The mailbox ${item.mailbox} isn't set up any more`);
    if (!mbox || !room(mbox)) continue; // this one waits for its mailbox; try the next due email
    if (item.step > 0 && deps.replied) {
      const first = d.items.filter((i) => i.searchId === item.searchId && i.leadId === item.leadId && i.status === "sent").sort((a, b) => (a.sentAt ?? "").localeCompare(b.sentAt ?? ""))[0];
      const got = await deps.replied(mbox, item.to, new Date(first?.sentAt ?? item.createdAt)).catch(() => undefined);
      if (got) {
        await deps.leads.patch(item.searchId, item.leadId, { replied: true });
        return finish("skipped", "They replied (found in your inbox), so no follow-up");
      }
    }
    const subject = item.subject ?? (item.threadSubject ? `Re: ${item.threadSubject.replace(/^re:\s*/i, "")}` : subjectFor(lead));
    const plain = item.body ?? messageForStep(lead, item.lang, item.sender, item.tone, item.step);
    const spam = checkContent(subject, plain).block;
    if (spam.length) return finish("skipped", `Spam check: ${spam[0]}`);
    if (deps.domainProblem) {
      const why = await deps.domainProblem(mbox).catch(() => undefined);
      if (why) {
        await mutate(deps.store, (x) => Object.assign((x.mailboxes[mbox.email] ??= { startedOn: mbox.start ?? today, sent: {} }), { pausedUntil: new Date(now.getTime() + 6 * 3600_000).toISOString(), pauseReason: why }));
        return { did: "idle" as const, detail: `${mbox.email} paused: ${why}` };
      }
    }
    const text = plain + footer(item.sender, mbox);
    const fromName = item.sender.name ? `${item.sender.name}${item.sender.company ? `, ${item.sender.company}` : ""}` : mbox.name;
    let messageId: string;
    try {
      messageId = (await deps.send(mbox, { from: fromName ? `"${fromName.replace(/"/g, "")}" <${mbox.email}>` : mbox.email, to: item.to, subject, text, inReplyTo: item.inReplyTo, references: item.references, listUnsubscribe: `<mailto:${mbox.email}?subject=unsubscribe>` })).messageId;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const auth = /auth|login|credentials|535|534|password/i.test(msg) && !isBlock(msg);
      const block = !auth && isBlock(msg);
      const hard = !auth && !block && isHardBounce(msg);
      await mutate(deps.store, (x) => {
        const st = (x.mailboxes[mbox.email] ??= { startedOn: mbox.start ?? today, sent: {} });
        if (auth) st.error = `Sign-in failed: ${msg}`;
        // the provider is blocking or rate-limiting: stop this mailbox for a day; the email waits
        if (block) Object.assign(st, { pausedUntil: new Date(now.getTime() + 24 * 3600_000).toISOString(), pauseReason: `The mail server refused: ${msg.slice(0, 160)}` });
        if (hard) noteBounce(x, mbox.email, item.to, today, now);
        const it = x.items.find((i) => i.id === item.id);
        if (it && !auth && !block) Object.assign(it, { status: "failed", reason: hard ? `Bounced: ${msg}` : msg });
      });
      return { did: "failed", detail: auth ? `${mbox.email}: sign-in failed (paused)` : block ? `${mbox.email}: refused by the mail server (paused 24h)` : msg, itemId: item.id };
    }
    const sentAt = now.toISOString();
    await mutate(deps.store, (x) => {
      const st = (x.mailboxes[mbox.email] ??= { startedOn: mbox.start ?? today, sent: {} });
      st.sent[today] = (st.sent[today] ?? 0) + 1;
      st.lastAt = sentAt;
      st.nextAt = new Date(now.getTime() + gapMs(rand)).toISOString();
      for (const k of Object.keys(st.sent)) if (Date.parse(`${k}T00:00:00Z`) < now.getTime() - 40 * 86_400_000) delete st.sent[k];
      const it = x.items.find((i) => i.id === item.id);
      if (!it) return;
      Object.assign(it, { status: "sent", sentAt, messageId, sentSubject: subject, mailbox: mbox.email, threadSubject: item.threadSubject ?? subject });
      // the next follow-up waits its turn (and is checked again before it goes)
      const when = followUpAfter(item.step, now);
      if (it.followUps && when && item.step + 1 < MAX_STEPS) {
        const minutes = 15 + Math.floor(rand() * 150);
        // India: from 10:00 IST on that day; elsewhere: the same number of days later (office hours are checked when it's due)
        const notBefore = !item.country || item.country === "IN" ? Date.parse(`${when}T10:00:00+05:30`) + minutes * 60_000 : now.getTime() + CADENCE[item.step] * 86_400_000 + minutes * 60_000;
        x.items.push({ ...it, id: randomUUID(), createdAt: sentAt, step: item.step + 1, subject: undefined, body: undefined, inReplyTo: messageId, references: [...(item.references ?? []), messageId], notBefore: new Date(notBefore).toISOString(), status: "queued", reason: undefined, sentAt: undefined, messageId: undefined, sentSubject: undefined });
      }
    });
    await deps.leads.patch(item.searchId, item.leadId, { touch: { channel: "email", messageId, subject, to: item.to }, followUpOn: followUpAfter(item.step, now) });
    return { did: "sent", detail: `${item.leadName} (${item.to}) from ${mbox.email}`, itemId: item.id };
  }
  return { did: "idle", detail: due.length ? "Waiting for a mailbox with room (daily warm-up limit or spacing)" : "Nothing due" };
}

/* ---------- bounces, unsubscribes and complaints (from the inbox or the SMTP answer) ---------- */

const lastDays = (rec: Record<string, number> | undefined, days: number, now: Date) =>
  Object.entries(rec ?? {}).filter(([k]) => Date.parse(`${k}T00:00:00Z`) >= now.getTime() - days * 86_400_000).reduce((t, [, n]) => t + n, 0);

/** Never email this address again, stop what's queued for it, and pause the mailbox if bounces pile up. */
function noteBounce(d: QueueData, mailbox: string, to: string, today: string, now: Date, why: Suppression["why"] = "bounced") {
  const addr = to.toLowerCase();
  (d.suppressed ??= {})[addr] ??= { at: now.toISOString(), why };
  for (const i of d.items) if (i.status === "queued" && i.to.toLowerCase() === addr) Object.assign(i, { status: "cancelled", reason: why === "bounced" ? "The address bounced" : why === "complained" ? "Marked an email as spam" : "Asked not to be emailed" });
  if (why === "unsubscribed" || why === "manual") return;
  const st = (d.mailboxes[mailbox] ??= { startedOn: today, sent: {} });
  const rec = why === "complained" ? (st.complaints ??= {}) : (st.bounces ??= {});
  rec[today] = (rec[today] ?? 0) + 1;
  const sent7 = lastDays(st.sent, 7, now);
  const p = pauseFor({ sent7, bounced7: lastDays(st.bounces, 7, now), bouncedToday: st.bounces?.[today] ?? 0, complaints7: lastDays(st.complaints, 7, now) });
  if (p) Object.assign(st, { pausedUntil: new Date(now.getTime() + p.hours * 3600_000).toISOString(), pauseReason: p.why });
}

export type InboxEvent = { kind: "bounce" | "unsubscribe" | "complaint"; address: string };

/**
 * Apply what the inbox showed: bounced addresses and spam complaints are suppressed (and count toward
 * the mailbox's pause), unsubscribe replies stop all email to that person. Returns the leads to mark
 * as opted out.
 */
export function applyInbox(d: QueueData, mailbox: string, events: InboxEvent[], now = new Date()): Array<{ searchId: string; leadId: string; why: string }> {
  const today = istParts(now).date;
  const out: Array<{ searchId: string; leadId: string; why: string }> = [];
  for (const e of events) {
    const addr = e.address.toLowerCase();
    if (d.suppressed?.[addr]) continue;
    // only addresses we emailed: a bounce for someone else's mail isn't ours to count
    const ours = d.items.filter((i) => i.to.toLowerCase() === addr && i.status === "sent");
    if (!ours.length) continue;
    noteBounce(d, mailbox, addr, today, now, e.kind === "bounce" ? "bounced" : e.kind === "complaint" ? "complained" : "unsubscribed");
    if (e.kind !== "bounce") for (const i of new Map(ours.map((x) => [`${x.searchId}|${x.leadId}`, x])).values()) out.push({ searchId: i.searchId, leadId: i.leadId, why: e.kind === "complaint" ? "Email: marked as spam" : "Email: asked to unsubscribe" });
  }
  (d.mailboxes[mailbox] ??= { startedOn: today, sent: {} }).scannedAt = now.toISOString();
  return out;
}

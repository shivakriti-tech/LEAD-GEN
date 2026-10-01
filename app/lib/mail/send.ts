import nodemailer, { type Transporter } from "nodemailer";
import { ImapFlow } from "imapflow";
import { getStore } from "../store";
import { mergeFollowUp } from "../followups";
import { live } from "../live";
import { mailboxesFromEnv, type Mailbox } from "./mailboxes";
import { applyInbox, localQueueStore, mutate, tick, type InboxEvent, type LeadAccess, type SendDeps } from "./queue";
import { bouncedAddress, isBounceMail, isUnsubscribeReply } from "./guard";
import { checkDomain } from "./dnsHealth";
import { simpleParser } from "mailparser";
import { cleanReply } from "../agent/intent";
import { handleEmailReply, localInboxStore } from "../agent/inbox";
import { getClientStore } from "../store";

/** The real connections for the email queue: SMTP (nodemailer), IMAP reply checks, saved leads. */

interface MailState { transports: Map<string, Transporter>; timer?: ReturnType<typeof setInterval>; busy: boolean; last?: { at: string; did: string; detail?: string } }
const g = globalThis as unknown as { __mail?: MailState };
const state: MailState = (g.__mail ??= { transports: new Map(), busy: false });

export function transportFor(m: Mailbox): Transporter {
  let t = state.transports.get(m.email);
  if (!t) {
    t = nodemailer.createTransport({ host: m.smtp.host, port: m.smtp.port, secure: m.smtp.secure, auth: { user: m.smtp.user, pass: m.smtp.pass }, connectionTimeout: 20_000, greetingTimeout: 20_000, socketTimeout: 60_000 });
    state.transports.set(m.email, t);
  }
  return t;
}

/** Signs in to the mailbox's SMTP server without sending anything. */
export async function verifyMailbox(m: Mailbox): Promise<{ ok: boolean; error?: string }> {
  try {
    await transportFor(m).verify();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export const smtpSend: SendDeps["send"] = async (m, mail) => {
  // one-click unsubscribe headers come with the mail; no "X-Mailer: nodemailer" (a script marker)
  const info = await transportFor(m).sendMail({ ...mail, xMailer: false });
  return { messageId: info.messageId };
};

/** Any mail from this address in the inbox since the first email? */
export const imapReplied: NonNullable<SendDeps["replied"]> = async (m, from, since) => {
  if (!m.imap) return undefined;
  const client = new ImapFlow({ host: m.imap.host, port: m.imap.port, secure: true, auth: { user: m.smtp.user, pass: m.smtp.pass }, logger: false });
  try {
    await client.connect();
    const lock = await client.getMailboxLock("INBOX");
    try {
      const hits = await client.search({ from, since });
      return Array.isArray(hits) ? hits.length > 0 : undefined;
    } finally {
      lock.release();
    }
  } catch {
    return undefined; // can't check: the follow-up goes, as it would without a check
  } finally {
    await client.logout().catch(() => {});
  }
};

/**
 * Read the inbox for bounces, spam complaints and "unsubscribe" replies since the last look.
 * Undefined when the inbox can't be reached.
 */
export interface InboxReply { address: string; subject: string; text: string; messageId?: string; references?: string[]; at: string }
export async function imapScan(m: Mailbox, since: Date): Promise<{ events: InboxEvent[]; replies: InboxReply[] } | undefined> {
  if (!m.imap) return undefined;
  const client = new ImapFlow({ host: m.imap.host, port: m.imap.port, secure: true, auth: { user: m.smtp.user, pass: m.smtp.pass }, logger: false });
  const out: InboxEvent[] = [];
  const replies: InboxReply[] = [];
  try {
    await client.connect();
    const lock = await client.getMailboxLock("INBOX");
    try {
      const ids = await client.search({ since });
      if (!Array.isArray(ids) || !ids.length) return { events: out, replies };
      for await (const msg of client.fetch(ids.slice(-200), { envelope: true, source: { maxLength: 150_000 } })) {
        const from = msg.envelope?.from?.map((a) => a.address ?? "").join(" ") ?? "";
        const subject = msg.envelope?.subject ?? "";
        const raw = msg.source?.toString("utf8") ?? "";
        const parsed = await simpleParser(msg.source ?? Buffer.alloc(0)).catch(() => undefined);
        const body = parsed?.text ?? raw.split(/\r?\n\r?\n/).slice(1).join("\n\n");
        if (/Feedback-Type:\s*abuse/i.test(raw)) {
          const a = bouncedAddress(raw) ?? raw.match(/^To:\s*.*?([a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})/im)?.[1];
          if (a) out.push({ kind: "complaint", address: a });
        } else if (isBounceMail(from, subject)) {
          const a = bouncedAddress(body);
          if (a && a !== m.email) out.push({ kind: "bounce", address: a });
        } else if (from && isUnsubscribeReply(subject, cleanReply(body).slice(0, 2000))) {
          out.push({ kind: "unsubscribe", address: from.split(" ")[0] });
        } else if (from && from.split(" ")[0].toLowerCase() !== m.email) {
          const text = cleanReply(body);
          const refs = parsed?.references;
          if (text) replies.push({ address: from.split(" ")[0].toLowerCase(), subject, text, messageId: parsed?.messageId ?? msg.envelope?.messageId, references: Array.isArray(refs) ? refs : refs ? [refs] : undefined, at: new Date(msg.envelope?.date ?? Date.now()).toISOString() });
        }
      }
    } finally {
      lock.release();
    }
    return { events: out, replies };
  } catch {
    return undefined;
  } finally {
    await client.logout().catch(() => {});
  }
}

/** Sending domains must have SPF and DMARC (Gmail and Yahoo reject or spam bulk mail without them). */
const dnsCache = new Map<string, { at: number; why?: string }>();
export async function domainProblem(m: Mailbox): Promise<string | undefined> {
  if (/^(off|0|false|no)$/i.test(process.env.MAIL_REQUIRE_DNS ?? "")) return undefined;
  const hit = dnsCache.get(m.domain);
  if (hit && Date.now() - hit.at < 6 * 3600_000) return hit.why;
  const h = await checkDomain(m.domain);
  const missing = (["spf", "dmarc", "mx"] as const).filter((k) => !h.checks[k].ok).map((k) => h.checks[k].label);
  const why = missing.length ? `${m.domain} is missing ${missing.join(", ")}: fix it under Outreach → Email (domain health)` : undefined;
  dnsCache.set(m.domain, { at: Date.now(), why });
  return why;
}

/** Leads in saved searches (and the running search's own copy, so a status set now isn't lost). */
export const savedLeads: LeadAccess = {
  async get(searchId, leadId) {
    const running = live.get(searchId)?.leads?.find((l) => l.id === leadId);
    if (running) return running;
    return (await getStore().getSearch(searchId))?.leads.find((l) => l.id === leadId);
  },
  async patch(searchId, leadId, p) {
    const running = live.get(searchId)?.leads?.find((l) => l.id === leadId);
    const lead = running ?? (await getStore().getSearch(searchId))?.leads.find((l) => l.id === leadId);
    if (!lead) return;
    const followUp = mergeFollowUp(lead.followUp, p);
    if (running) running.followUp = followUp;
    await getStore().updateFollowUps(searchId, [{ id: leadId, followUp }]);
  },
};

export function emailDeps(): SendDeps {
  return { store: localQueueStore(), leads: savedLeads, mailboxes: mailboxesFromEnv().mailboxes, send: smtpSend, replied: imapReplied, domainProblem };
}

/** Run the queue every 30 seconds while the app is running (only when a mailbox is set up). */
export function startEmailWorker(): void {
  if (state.timer || !mailboxesFromEnv().mailboxes.length) return;
  state.timer = setInterval(async () => {
    if (state.busy) return;
    state.busy = true;
    try {
      const deps = emailDeps();
      await scanInboxes(deps).catch((e) => console.error("[email] inbox check:", e instanceof Error ? e.message : e));
      const r = await tick(deps);
      state.last = { at: new Date().toISOString(), did: r.did, detail: r.detail };
      if (r.did !== "idle") console.log(`[email] ${r.did}: ${r.detail ?? ""}`);
    } catch (e) {
      console.error("[email] queue error:", e instanceof Error ? e.message : e);
    } finally {
      state.busy = false;
    }
  }, 30_000);
  state.timer.unref?.();
}

/** Every 30 minutes per mailbox: bounces, complaints and unsubscribe replies from its inbox. */
async function scanInboxes(deps: SendDeps): Promise<void> {
  const d = await deps.store.read();
  for (const m of deps.mailboxes) {
    const st = d.mailboxes[m.email];
    if (!st?.lastAt || (st.scannedAt && Date.now() - Date.parse(st.scannedAt) < 30 * 60_000)) continue;
    const since = new Date(Math.max(Date.parse(st.scannedAt ?? st.lastAt) - 86_400_000, Date.now() - 14 * 86_400_000));
    const scan = await imapScan(m, since);
    if (!scan) continue;
    const optOuts = await mutate(deps.store, (x) => applyInbox(x, m.email, scan.events));
    for (const o of optOuts) await deps.leads.patch(o.searchId, o.leadId, { optOut: { via: o.why } });
    if (scan.events.length) console.log(`[email] ${m.email}: ${scan.events.length} bounce/unsubscribe event(s) applied`);
    // replies from leads: the conversation agent reads each one and drafts the answer
    for (const r of scan.replies) {
      const conv = await handleEmailReply(replyDeps(deps), { ...r, mailbox: m.email }).catch((e) => console.error("[agent]", e instanceof Error ? e.message : e));
      if (conv) console.log(`[agent] ${conv.leadName}: ${conv.agent?.intent}${conv.status === "handoff" ? " (your turn)" : ""}`);
    }
  }
}

/** What the conversation agent needs: the inbox, the queue, leads, mailboxes and client profiles. */
export function replyDeps(deps: SendDeps = emailDeps()) {
  return {
    inbox: localInboxStore(),
    queue: deps.store,
    leads: deps.leads,
    mailboxes: deps.mailboxes,
    send: deps.send,
    brainFor: async (id?: string) => (id ? ((await getClientStore().getClient(id)) ?? null) : null),
  };
}

export const workerStatus = () => ({ running: !!state.timer, last: state.last });

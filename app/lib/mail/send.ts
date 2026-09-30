import nodemailer, { type Transporter } from "nodemailer";
import { ImapFlow } from "imapflow";
import { getStore } from "../store";
import { mergeFollowUp } from "../followups";
import { live } from "../live";
import { mailboxesFromEnv, type Mailbox } from "./mailboxes";
import { localQueueStore, tick, type LeadAccess, type SendDeps } from "./queue";

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
  const info = await transportFor(m).sendMail({ ...mail, headers: { "List-Unsubscribe": mail.listUnsubscribe } });
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
  return { store: localQueueStore(), leads: savedLeads, mailboxes: mailboxesFromEnv().mailboxes, send: smtpSend, replied: imapReplied };
}

/** Run the queue every 30 seconds while the app is running (only when a mailbox is set up). */
export function startEmailWorker(): void {
  if (state.timer || !mailboxesFromEnv().mailboxes.length) return;
  state.timer = setInterval(async () => {
    if (state.busy) return;
    state.busy = true;
    try {
      const r = await tick(emailDeps());
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

export const workerStatus = () => ({ running: !!state.timer, last: state.last });

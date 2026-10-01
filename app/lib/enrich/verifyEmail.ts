import { fetchWithTimeout } from "../util";
import { Socket } from "node:net";
import { promises as dns } from "node:dns";
import { randomBytes } from "node:crypto";

/**
 * Mailbox-level email check through a verification service (optional, your key):
 *   EMAIL_VERIFY=zerobounce       EMAIL_VERIFY_KEY=…   (100 free checks a month)
 *   EMAIL_VERIFY=millionverifier  EMAIL_VERIFY_KEY=…   (cheapest for bulk)
 * The service talks to the mail server for us; doing that from your own computer usually fails
 * (home internet blocks it) and can get your connection blacklisted.
 */

import type { MailboxStatus } from "./mailboxLabel";
export { MAILBOX_LABEL, type MailboxStatus } from "./mailboxLabel";
export interface MailboxCheck {
  status: MailboxStatus;
  by: "zerobounce" | "millionverifier" | "smtp";
  /** The service's own words, e.g. "mailbox_not_found", "role", "disposable". */
  detail?: string;
}
export type EmailVerifier = (email: string) => Promise<MailboxCheck>;

/** The key is wrong or the credits ran out: stop checking for the rest of the search. */
export class VerifyStop extends Error {}



function zeroBounce(key: string, f: typeof fetchWithTimeout): EmailVerifier {
  return async (email) => {
    const q = new URLSearchParams({ api_key: key, email, ip_address: "" });
    const res = await f(`https://api.zerobounce.net/v2/validate?${q}`, {}, 20_000);
    const j = (await res.json().catch(() => ({}))) as { status?: string; sub_status?: string; error?: string; Message?: string };
    if (!res.ok || j.error || j.Message) {
      const why = j.error || j.Message || `HTTP ${res.status}`;
      if (res.status === 401 || res.status === 403 || /key|credit/i.test(why)) throw new VerifyStop(`ZeroBounce: ${why}`);
      throw new Error(`ZeroBounce: ${why}`);
    }
    const s = (j.status ?? "").toLowerCase();
    const status: MailboxStatus = s === "valid" ? "valid" : ["invalid", "spamtrap", "abuse", "do_not_mail"].includes(s) ? "invalid" : s === "catch-all" ? "catch_all" : "unknown";
    return { status, by: "zerobounce", detail: [s, j.sub_status].filter(Boolean).join(": ") || undefined };
  };
}

function millionVerifier(key: string, f: typeof fetchWithTimeout): EmailVerifier {
  return async (email) => {
    const q = new URLSearchParams({ api: key, email, timeout: "10" });
    const res = await f(`https://api.millionverifier.com/api/v3/?${q}`, {}, 25_000);
    const j = (await res.json().catch(() => ({}))) as { result?: string; subresult?: string; error?: string };
    if (!res.ok || j.error) {
      const why = j.error || `HTTP ${res.status}`;
      if (res.status === 401 || res.status === 403 || /key|credit|insufficient/i.test(why)) throw new VerifyStop(`MillionVerifier: ${why}`);
      throw new Error(`MillionVerifier: ${why}`);
    }
    const r = (j.result ?? "").toLowerCase();
    const status: MailboxStatus = r === "ok" ? "valid" : r === "invalid" || r === "disposable" ? "invalid" : r === "catch_all" ? "catch_all" : "unknown";
    return { status, by: "millionverifier", detail: [r, j.subresult].filter((x) => x && x !== r).join(": ") || r || undefined };
  };
}

/**
 * Free mailbox check (EMAIL_VERIFY=smtp, no key): ask the company's own mail server whether the
 * address exists, then hang up before sending anything (EHLO, MAIL FROM, RCPT TO, QUIT). A random
 * address is tried too: if that's "accepted" as well, the server accepts everything (catch-all) and
 * can't confirm. Needs outgoing port 25, which many home and office connections block; when it's
 * blocked, checks stop for the search and emails stay as they were. Gmail and Outlook-hosted
 * domains answer "yes" to everything, so they show as catch-all.
 */
export type SmtpTalk = (host: string, lines: string[]) => Promise<number[]>;

/** One SMTP conversation: send each line after the server's answer, return the answer codes. */
const talk: SmtpTalk = (host, lines) =>
  new Promise((resolve, reject) => {
    const sock = new Socket();
    const codes: number[] = [];
    let buf = "";
    let i = 0;
    const done = (e?: Error) => {
      sock.destroy();
      if (e) reject(e);
      else resolve(codes);
    };
    sock.setTimeout(10_000, () => done(Object.assign(new Error("Timed out on port 25"), { code: "ETIMEDOUT" })));
    sock.on("error", (e) => done(e));
    sock.on("data", (d) => {
      buf += d.toString("latin1");
      // a reply is complete when its last line is "123 text" (not "123-text")
      const m = buf.match(/(?:^|\r?\n)(\d{3}) [^\n]*\r?\n$/);
      if (!m) return;
      codes.push(Number(m[1]));
      buf = "";
      if (i < lines.length) sock.write(`${lines[i++]}\r\n`);
      else done();
    });
    sock.connect(25, host);
  });

export function smtpVerifier(from: string, opts: { talk?: SmtpTalk; mx?: (d: string) => Promise<Array<{ exchange: string; priority: number }>> } = {}): EmailVerifier {
  const t = opts.talk ?? talk;
  const mxOf = opts.mx ?? ((d: string) => dns.resolveMx(d));
  return async (email) => {
    const domain = email.split("@")[1]?.toLowerCase();
    const mx = (await mxOf(domain).catch(() => [])).sort((a, b) => a.priority - b.priority)[0]?.exchange;
    if (!mx) return { status: "invalid", by: "smtp", detail: "no mail server" };
    const probe = `${randomBytes(6).toString("hex")}@${domain}`;
    let codes: number[];
    try {
      codes = await t(mx, [`EHLO ${from.split("@")[1] ?? "localhost"}`, `MAIL FROM:<${from}>`, `RCPT TO:<${email}>`, `RCPT TO:<${probe}>`, "QUIT"]);
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (code === "ETIMEDOUT" || code === "ECONNREFUSED" || code === "EHOSTUNREACH" || code === "ENETUNREACH") throw new VerifyStop("SMTP check: port 25 is blocked on this connection (use EMAIL_VERIFY=zerobounce instead)");
      throw e;
    }
    // codes: [greeting, EHLO, MAIL FROM, RCPT real, RCPT probe, QUIT]
    const [, , mailFrom, real, fake] = codes;
    if (!mailFrom || mailFrom >= 400 || !real) return { status: "unknown", by: "smtp", detail: `server answered ${mailFrom ?? "nothing"}` };
    if (real >= 500 && real < 600) return { status: "invalid", by: "smtp", detail: `mailbox rejected (${real})` };
    if (real >= 400) return { status: "unknown", by: "smtp", detail: `try later (${real})` };
    if (fake && fake < 300) return { status: "catch_all", by: "smtp", detail: "accepts any address" };
    return { status: "valid", by: "smtp", detail: "mailbox exists" };
  };
}

export function verifierFromEnv(env: Record<string, string | undefined> = process.env, f = fetchWithTimeout): EmailVerifier | undefined {
  const key = (env.EMAIL_VERIFY_KEY || "").trim();
  const which = (env.EMAIL_VERIFY || "").trim().toLowerCase();
  if (which === "smtp") {
    // the address the check introduces itself as: your first sending mailbox
    const from = (env.MAILBOX_1 ? decodeURIComponent(env.MAILBOX_1.match(/^smtps?:\/\/([^:]+):/)?.[1] ?? "") : "") || env.EMAIL_VERIFY_FROM || "verify@example.com";
    return smtpVerifier(from);
  }
  if (!key) return undefined;
  if (which === "millionverifier") return millionVerifier(key, f);
  if (which === "zerobounce" || !which) return zeroBounce(key, f);
  return undefined;
}

export const verifierName = (env: Record<string, string | undefined> = process.env) =>
  (env.EMAIL_VERIFY || "").trim().toLowerCase() === "smtp" ? "SMTP check (free)" : (env.EMAIL_VERIFY_KEY || "").trim() ? ((env.EMAIL_VERIFY || "").toLowerCase() === "millionverifier" ? "MillionVerifier" : "ZeroBounce") : undefined;

/** How one search's checks went, for its log. */
export interface VerifyStats {
  checked: number;
  valid: number;
  invalid: number;
  catchAll: number;
  skipped: number;
  stopped?: string;
}

/**
 * At most `cap` checks in one search (credits cost money); after a key or credit problem, none.
 * A check that errors returns undefined, so the email is kept as it was.
 */
export function cappedVerifier(v: EmailVerifier, cap: number, stats: VerifyStats): (email: string) => Promise<MailboxCheck | undefined> {
  return async (email) => {
    if (stats.stopped || stats.checked >= cap) {
      stats.skipped++;
      return undefined;
    }
    stats.checked++;
    try {
      const r = await v(email);
      if (r.status === "valid") stats.valid++;
      else if (r.status === "invalid") stats.invalid++;
      else if (r.status === "catch_all") stats.catchAll++;
      return r;
    } catch (e) {
      if (e instanceof VerifyStop) stats.stopped = e.message;
      return undefined;
    }
  };
}

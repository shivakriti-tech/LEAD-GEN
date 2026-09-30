import { fetchWithTimeout } from "../util";

/**
 * Mailbox-level email check through a verification service (optional, your key):
 *   EMAIL_VERIFY=zerobounce       EMAIL_VERIFY_KEY=…   (100 free checks a month)
 *   EMAIL_VERIFY=millionverifier  EMAIL_VERIFY_KEY=…   (cheapest for bulk)
 * The service talks to the mail server for us; doing that from your own computer usually fails
 * (home internet blocks it) and can get your connection blacklisted.
 */

export type MailboxStatus = "valid" | "invalid" | "catch_all" | "unknown";
export interface MailboxCheck {
  status: MailboxStatus;
  by: "zerobounce" | "millionverifier";
  /** The service's own words, e.g. "mailbox_not_found", "role", "disposable". */
  detail?: string;
}
export type EmailVerifier = (email: string) => Promise<MailboxCheck>;

/** The key is wrong or the credits ran out: stop checking for the rest of the search. */
export class VerifyStop extends Error {}

export const MAILBOX_LABEL: Record<MailboxStatus, string> = {
  valid: "mailbox verified",
  invalid: "mailbox doesn't exist",
  catch_all: "accepts any address (can't confirm)",
  unknown: "couldn't confirm",
};

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

export function verifierFromEnv(env: Record<string, string | undefined> = process.env, f = fetchWithTimeout): EmailVerifier | undefined {
  const key = (env.EMAIL_VERIFY_KEY || "").trim();
  const which = (env.EMAIL_VERIFY || "").trim().toLowerCase();
  if (!key) return undefined;
  if (which === "millionverifier") return millionVerifier(key, f);
  if (which === "zerobounce" || !which) return zeroBounce(key, f);
  return undefined;
}

export const verifierName = (env: Record<string, string | undefined> = process.env) =>
  (env.EMAIL_VERIFY_KEY || "").trim() ? ((env.EMAIL_VERIFY || "").toLowerCase() === "millionverifier" ? "MillionVerifier" : "ZeroBounce") : undefined;

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

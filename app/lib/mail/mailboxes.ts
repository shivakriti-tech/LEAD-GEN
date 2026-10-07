/**
 * Your sending mailboxes, from .env.local (never saved anywhere else):
 *
 *   MAILBOX_1=smtps://divy%40getshree.in:app-password@smtp.zoho.in:465?name=Divy%20Shah&start=2026-10-01
 *   MAILBOX_2=smtp://divy%40shreelogistics.co:app-password@smtp.gmail.com:587?name=Divy%20Shah
 *
 * smtps:// = port 465 (SSL), smtp:// = STARTTLS (587). `name` is the From name, `start` the day you
 * started using it (warm-up), `imap` the inbox server for reply checks (guessed from the SMTP host),
 * `max` the most it ever sends a day. Use an address on a separate sending domain, not the client's
 * main domain: if cold email hurts a domain's reputation, it shouldn't be the one their customers use.
 */

export interface Mailbox {
  /** The address, e.g. divy@getshree.in */
  email: string;
  name?: string;
  domain: string;
  smtp: { host: string; port: number; secure: boolean; user: string; pass: string };
  imap?: { host: string; port: number };
  /** Day you started sending from it (YYYY-MM-DD), for the warm-up ramp. */
  start?: string;
  /** Hard ceiling per day once warmed up. */
  max: number;
  /** Which MAILBOX_n it came from. */
  key: string;
}

const IMAP_FOR: Array<[RegExp, string]> = [
  [/^smtp\.gmail\.com$/i, "imap.gmail.com"],
  [/^smtp\.googlemail\.com$/i, "imap.gmail.com"],
  [/^smtp\.zoho\.(com|in|eu)$/i, "imap.zoho.$1"],
  [/^smtppro\.zoho\.(com|in|eu)$/i, "imappro.zoho.$1"],
  [/^smtp\.office365\.com$/i, "outlook.office365.com"],
  [/^smtp-mail\.outlook\.com$/i, "outlook.office365.com"],
  [/^smtp\.hostinger\.com$/i, "imap.hostinger.com"],
  [/^smtpout\.secureserver\.net$/i, "imap.secureserver.net"],
];
export const imapHostFor = (smtpHost: string) => {
  for (const [re, imap] of IMAP_FOR) if (re.test(smtpHost)) return smtpHost.replace(re, imap);
  return smtpHost.replace(/^smtp(out)?\./i, "imap.");
};

export function parseMailbox(key: string, value: string): Mailbox | { key: string; error: string } {
  try {
    const u = new URL(value.trim());
    if (u.protocol !== "smtp:" && u.protocol !== "smtps:") return { key, error: "must start with smtp:// or smtps://" };
    const user = decodeURIComponent(u.username), pass = decodeURIComponent(u.password);
    if (!user.includes("@") || !pass) return { key, error: "needs the full email address and its (app) password: smtps://you%40domain.in:password@host:465" };
    const secure = u.protocol === "smtps:";
    const q = u.searchParams;
    const start = q.get("start") ?? undefined;
    const imap = q.get("imap");
    return {
      key,
      email: user.toLowerCase(),
      name: q.get("name") ?? undefined,
      domain: user.split("@")[1].toLowerCase(),
      smtp: { host: u.hostname, port: Number(u.port) || (secure ? 465 : 587), secure, user, pass },
      imap: imap === "off" ? undefined : { host: imap || imapHostFor(u.hostname), port: 993 },
      start: start && /^\d{4}-\d{2}-\d{2}$/.test(start) ? start : undefined,
      max: Math.min(200, Math.max(5, Number(q.get("max")) || 40)),
    };
  } catch {
    return { key, error: "isn't a valid address (smtps://you%40domain.in:password@smtp.host:465)" };
  }
}

/** MAILBOX_1 … MAILBOX_20 from the environment; bad ones come back with the reason. */
export function mailboxesFromEnv(env: Record<string, string | undefined> = process.env): { mailboxes: Mailbox[]; problems: Array<{ key: string; error: string }> } {
  const mailboxes: Mailbox[] = [], problems: Array<{ key: string; error: string }> = [];
  for (let i = 1; i <= 20; i++) {
    const v = env[`MAILBOX_${i}`];
    if (!v?.trim()) continue;
    const m = parseMailbox(`MAILBOX_${i}`, v);
    if ("error" in m) problems.push(m);
    else if (!mailboxes.some((x) => x.email === m.email)) mailboxes.push(m);
  }
  return { mailboxes, problems };
}

/**
 * Warm-up: a new mailbox starts at 5 emails a day and adds 3 a day, up to its maximum (40 by default).
 * Sending 200 cold emails on day one from a new domain is how it ends up in spam for good.
 * (A warm-up service that exchanges real replies helps too; this only paces your own sending.)
 */
export function dailyCap(m: Pick<Mailbox, "max">, startedOn: string, today: string): number {
  const days = Math.max(0, Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${startedOn}T00:00:00Z`)) / 86_400_000));
  return Math.min(m.max, 5 + 3 * days);
}

/** Business hours in India: Monday–Saturday, 10:00–18:30. Emails outside them wait. */
export function istParts(now: Date): { date: string; weekday: number; minutes: number } {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short", hour12: false }).formatToParts(now).map((x) => [x.type, x.value]));
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(p.weekday);
  return { date: `${p.year}-${p.month}-${p.day}`, weekday, minutes: (Number(p.hour) % 24) * 60 + Number(p.minute) };
}
export const SEND_WINDOW = { from: 10 * 60, to: 18 * 60 + 30 };
export function inSendWindow(now: Date): boolean {
  const t = istParts(now);
  return t.weekday >= 1 && t.weekday <= 6 && t.minutes >= SEND_WINDOW.from && t.minutes < SEND_WINDOW.to;
}

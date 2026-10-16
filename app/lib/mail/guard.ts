import type { EmailInfo } from "../enrich/email";

/**
 * Deliverability rules: what keeps a sending domain out of spam and off blocklists.
 * Pure functions, used when emails are queued and again right before each one goes.
 *
 *  - Only real, reachable people: no bounced, unsubscribed, disposable or "nobody reads this" addresses.
 *  - Plain, short, human emails: one link at most, no link shorteners, no spammy phrases or shouting.
 *  - Few emails to one company a day, and a mailbox pauses itself when bounces or blocks show up.
 */

/** Addresses that are never a person, or that report spam (abuse@, postmaster@…). */
const NO_PERSON = /^(abuse|postmaster|hostmaster|webmaster|noc|security|spam|no-?reply|do-?not-?reply|mailer-daemon|bounce[s]?|devnull|null|root|privacy|legal|unsubscribe|newsletter|marketing|jobs|careers|hr|recruit(ing|ment)?|billing|invoices?|accounts?payable)@/i;
const EMAIL = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i;

export type Suppression = { at: string; why: "bounced" | "unsubscribed" | "complained" | "manual" };

/** Why this address must not get a cold email, or undefined when it may. */
export function recipientProblem(email: string, info?: EmailInfo, suppressed?: Record<string, Suppression>): string | undefined {
  const e = email.trim().toLowerCase();
  if (!EMAIL.test(e)) return "Not a valid email address";
  const s = suppressed?.[e];
  if (s) return s.why === "bounced" ? "This address bounced before" : s.why === "complained" ? "Marked an earlier email as spam" : "Asked not to be emailed";
  if (NO_PERSON.test(e)) return "A system or department address nobody answers (sending to these hurts your domain)";
  if (info?.disposable) return "A throwaway address";
  if (info?.deliverable === false) return "Its domain can't receive email";
  if (info?.mailbox === "invalid") return "The mailbox doesn't exist (verification)";
  return undefined;
}

const SHORTENERS = /\b(bit\.ly|tinyurl\.com|t\.co|goo\.gl|ow\.ly|is\.gd|buff\.ly|rebrand\.ly|cutt\.ly|shorturl\.at|rb\.gy|tiny\.cc|lnkd\.in)\//i;
/** Phrases spam filters weigh heavily in cold email. */
const SPAMMY = /\b(100% (free|guaranteed)|act now|limited time|risk[- ]free|guaranteed (results|ranking|#?1)|no obligation|click here|buy now|order now|earn \$|make money|cash bonus|double your|increase (your )?sales by \d{2,}%|winner|congratulations|urgent|dear (sir|madam|friend)|this is not spam|special promotion|lowest price|best price|cheap|viagra|crypto|bitcoin|casino|loan)\b/i;
/** More phrases filters weigh (coldoutboundskills' spam-word-checker list): they lower inbox placement, so warn. */
const SPAMMY_SOFT = /\b(no cost|for free|free (trial|consultation|gift|access)|exclusive (deal|offer)|once in a lifetime|while (supplies|stocks) last|don'?t miss (out)?|last chance|expires? (today|soon)|instant(ly)? (access|results)|amazing|incredible deal|unbeatable|satisfaction guaranteed|money[- ]back|no catch|no strings attached|apply now|sign up (free|now)|get started (now|today)|call now|act fast|hurry|100% satisfied|million dollars|extra (cash|income)|work from home|be your own boss|miracle)\b/i;

/**
 * Things that make a message read as written by AI or a template (oneshot-gtm's draft lint, MIT):
 * stock openers and closers, AI words, em dashes. Replies to a typed message get fewer answers.
 */
const AI_TELLS: Array<[RegExp, string]> = [
  [/\bhope (this|you'?re|you are)\b[^.?!]{0,30}\b(finds you well|doing well|well)\b/i, "\"Hope this finds you well\""],
  [/\bjust wanted to\b/i, "\"Just wanted to\""],
  [/\b(I'?m |I am )?reaching out (because|to)\b/i, "\"Reaching out\""],
  [/\bquick question\b/i, "\"Quick question\""],
  [/\bI'?d love to (chat|connect|jump on a call|hear)\b/i, "\"I'd love to chat\""],
  [/\bcurious to (learn|hear)\b/i, "\"Curious to learn\""],
  [/\b(hope this helps|let me know if you'?d like|happy to expand)\b/i, "a servile closer"],
  [/^\s*(great question|certainly|of course|absolutely)[!,]/im, "a sycophantic opener"],
  [/\b(as of my last (training|update)|based on available information|as an ai)\b/i, "an AI disclaimer"],
  [/\b(delve|leverage|seamless(ly)?|robust|elevate|empower|unlock|tapestry|testament|game[- ]changer|cutting[- ]edge|synergy|revolutioni[sz]e|transformative|in today'?s (fast[- ]paced|digital) (world|landscape)|navigate the|at the intersection of)\b/i, "AI-sounding words"],
  [/\bit'?s not (just|merely) [^.]+, it'?s\b|\bnot only\b[^.]{1,80}\bbut also\b/i, "\"not just X, it's Y\""],
];
/** Which AI/template tells a text has (empty when it reads as typed by a person). */
export function aiTells(text: string): string[] {
  const out = AI_TELLS.filter(([re]) => re.test(text)).map(([, label]) => label);
  if (/—/.test(text)) out.push("em dashes (—)");
  return out;
}

/**
 * A public record may say why a business is relevant, never be used as leverage: a failed inspection,
 * a violation, a lapsed licence. Insulting, and the fastest way to get reported as spam (oneshot-gtm).
 */
export function citesRecordAsLeverage(text: string): boolean {
  return (
    /\b(failed|flunked)\s+(your\s+|the\s+|a\s+|an\s+)?(health\s+|fire\s+|safety\s+)?inspections?\b/i.test(text) ||
    /\b(inspection|hygiene)\s+(scores?|grades?|ratings?)\b/i.test(text) ||
    /\b(cit(e|es|ed|ation)|reported|flagged|found|noted)\b[\s\S]{0,60}\bviolations?\b/i.test(text) ||
    /\bviolations?\b[\s\S]{0,60}\b(cit(e|es|ed|ation)|reported|flagged|found|noted)\b/i.test(text) ||
    /\b(licen[sc]e|permit|registration|gst number)s?\s+(has\s+|have\s+|was\s+|is\s+)?(lapsed|expired|revoked|suspended|cancell?ed)\b/i.test(text) ||
    /\b(lapsed|expired|revoked|suspended|cancell?ed)\s+(licen[sc]e|permit|registration|gst number)s?\b/i.test(text)
  );
}

export interface ContentCheck {
  /** Problems that stop the email (fix the text first). */
  block: string[];
  /** Things that lower inbox placement; the email still goes. */
  warn: string[];
}

/** Is this email likely to be filtered as spam? Plain-text cold emails only. */
export function checkContent(subject: string, body: string): ContentCheck {
  const block: string[] = [], warn: string[] = [];
  const all = `${subject}\n${body}`;
  const links = body.match(/\bhttps?:\/\/\S+|\bwww\.\S+|\b[a-z0-9-]+\.(com|in|co|io|net|org|tech|ae|ca|au|nz)(\/\S*)?\b/gi) ?? [];
  const realLinks = links.filter((l) => !/@/.test(l));
  if (SHORTENERS.test(all)) block.push("Uses a link shortener (bit.ly and similar are a strong spam signal): use your own address");
  if (realLinks.length > 2) block.push(`${realLinks.length} links: keep it to one`);
  else if (realLinks.length === 2) warn.push("Two links: one is safer");
  const spam = all.match(SPAMMY);
  if (spam) block.push(`"${spam[0]}" reads as spam: reword it`);
  if (/<\s*(img|a|table|div)\b/i.test(body)) block.push("HTML in a cold email: send plain text");
  if (citesRecordAsLeverage(all)) block.push("Uses a failed inspection, violation or lapsed licence as a reason to reply: say why you can help instead");
  const soft = all.match(SPAMMY_SOFT);
  if (soft) warn.push(`"${soft[0]}" is a common spam-filter phrase`);
  const tells = aiTells(body);
  if (tells.length) warn.push(`Reads like AI or a template: ${tells.join(", ")}`);
  if (subject.length > 80) warn.push("Long subject: under 60 characters is better");
  const caps = subject.replace(/[^A-Za-z]/g, "");
  if (caps.length >= 8 && caps === caps.toUpperCase()) block.push("Subject in capitals");
  if ((all.match(/!/g) ?? []).length > 2) warn.push("Several exclamation marks");
  if (/\$\$|₹₹|free!/i.test(all)) block.push("Money symbols or FREE! in the text");
  const words = body.split(/\s+/).filter(Boolean).length;
  if (words > 220) warn.push(`${words} words: cold emails under 150 words get more replies and fewer spam flags`);
  return { block, warn };
}

/**
 * A grade for one batch of emails before it goes (coldoutboundskills' list-quality-scorecard): how
 * many addresses were checked at mailbox level, accept-anything servers, shared inboxes (info@…), and
 * several emails to one company. Bad batches burn a sending domain whatever the text says.
 */
export interface BatchQuality {
  grade: "A" | "B" | "C" | "D" | "F";
  score: number;
  /** The worst problems first, in plain words. */
  issues: string[];
}
export function batchQuality(rows: Array<{ email: string; info?: EmailInfo }>): BatchQuality | undefined {
  const n = rows.length;
  if (!n) return undefined;
  const count = (f: (r: (typeof rows)[number]) => boolean) => rows.filter(f).length;
  const unchecked = count((r) => !r.info?.mailbox || r.info.mailbox === "unknown");
  const catchAll = count((r) => r.info?.mailbox === "catch_all");
  const shared = count((r) => r.info?.kind === "generic" || r.info?.kind === "own_generic");
  const perCompany = new Map<string, number>();
  for (const r of rows) perCompany.set(companyKey(r.email), (perCompany.get(companyKey(r.email)) ?? 0) + 1);
  const crowded = [...perCompany.values()].filter((x) => x > PER_COMPANY_DAY).length;
  const share = (x: number) => x / n;
  const score = Math.max(0, Math.round(100 - share(unchecked) * 35 - share(catchAll) * 25 - share(shared) * 20 - Math.min(20, crowded * 10)));
  const grade = score >= 90 ? "A" : score >= 75 ? "B" : score >= 60 ? "C" : score >= 45 ? "D" : "F";
  const issues: Array<[number, string]> = [];
  if (unchecked) issues.push([share(unchecked) * 35, `${unchecked} of ${n} not checked at mailbox level (set EMAIL_VERIFY to catch bounces before they happen)`]);
  if (catchAll) issues.push([share(catchAll) * 25, `${catchAll} go to servers that accept any address, so a wrong one won't bounce back but won't be read`]);
  if (shared) issues.push([share(shared) * 20, `${shared} are shared inboxes (info@, contact@…): a person's own address gets more replies`]);
  if (crowded) issues.push([crowded * 10, `${crowded} compan${crowded === 1 ? "y gets" : "ies get"} more than ${PER_COMPANY_DAY} emails: they'll be spread over days`]);
  return { grade, score, issues: issues.sort((a, b) => b[0] - a[0]).map(([, t]) => t) };
}

/** "jane@acme.com" → "acme.com"; free mail providers count per address, not per domain. */
const FREE_MAIL = /^(gmail|googlemail|yahoo|ymail|hotmail|outlook|live|msn|icloud|me|aol|proton|protonmail|zoho|gmx|mail|yandex|rediffmail)\.[a-z.]+$/i;
export const companyKey = (email: string) => {
  const [user, dom = ""] = email.toLowerCase().split("@");
  return FREE_MAIL.test(dom) ? `${user}@${dom}` : dom;
};
/** At most this many emails to one company (recipient domain) a day, across all your mailboxes. */
export const PER_COMPANY_DAY = 2;

/** SMTP answers that mean "this address doesn't exist": never send to it again. */
export const isHardBounce = (msg: string) => /\b(55[0-3]|5\.1\.[0-9]|5\.2\.1)\b|user unknown|no such user|does not exist|mailbox (unavailable|not found)|recipient (address )?rejected|invalid recipient|address rejected/i.test(msg) && !isBlock(msg);
/** SMTP answers that mean the provider is blocking or rate-limiting you: stop sending from that mailbox for a while. */
export const isBlock = (msg: string) => /\b(5\.7\.\d|4\.7\.\d|421|451 4\.7|554)\b|spam|blocked|blacklist|blocklist|reputation|rate limit|too many (messages|recipients|connections)|daily (user )?sending (quota|limit)|policy (rejection|violation)|suspicious/i.test(msg);

/**
 * Pause a mailbox when its numbers say providers are getting unhappy: more than 3% bounces over
 * the last 7 days (with 20+ sent), any spam complaint, or 3+ bounces in a day.
 */
export function pauseFor(stats: { sent7: number; bounced7: number; bouncedToday: number; complaints7: number }): { hours: number; why: string } | undefined {
  if (stats.complaints7 > 0) return { hours: 72, why: "Someone marked an email as spam: paused 3 days. Check your list and text." };
  if (stats.bouncedToday >= 3) return { hours: 24, why: `${stats.bouncedToday} bounces today: paused until tomorrow. Verify emails before sending (EMAIL_VERIFY).` };
  if (stats.sent7 >= 20 && stats.bounced7 / stats.sent7 > 0.03) return { hours: 48, why: `Bounce rate ${Math.round((stats.bounced7 / stats.sent7) * 100)}% this week (keep it under 3%): paused 2 days. Verify emails before sending.` };
  return undefined;
}

/** Pull the failed address out of a bounce message (delivery status notification). */
export function bouncedAddress(text: string): string | undefined {
  const m = text.match(/(?:Final|Original)-Recipient:\s*(?:rfc822;\s*)?<?([^\s<>;]+@[^\s<>;]+)>?/i) ?? text.match(/(?:to|recipient|address)[^\n@]{0,40}?<?([a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})>?[^\n]{0,80}(?:does not exist|not found|unknown|rejected|failed|undeliverable|couldn't be delivered)/i);
  return m?.[1]?.toLowerCase().replace(/[.>]+$/, "");
}
/** Is an inbox message a bounce (from the mail system, about a failed delivery)? */
export const isBounceMail = (from: string, subject: string) => /mailer-daemon|postmaster|mail delivery (subsystem|system)/i.test(from) || /undeliver|delivery (status notification|has failed|failure)|returned mail|failure notice|couldn't be delivered|address not found/i.test(subject);
/** A reply asking to stop. */
export const isUnsubscribeReply = (subject: string, text: string) => /^\s*(unsubscribe|remove me|stop)\b/i.test(subject) || /^\s*(unsubscribe|remove me|stop|please remove|take me off|not interested,? (please )?(remove|stop))\b/i.test(text.trim());

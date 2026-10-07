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
  if (subject.length > 80) warn.push("Long subject: under 60 characters is better");
  const caps = subject.replace(/[^A-Za-z]/g, "");
  if (caps.length >= 8 && caps === caps.toUpperCase()) block.push("Subject in capitals");
  if ((all.match(/!/g) ?? []).length > 2) warn.push("Several exclamation marks");
  if (/\$\$|₹₹|free!/i.test(all)) block.push("Money symbols or FREE! in the text");
  const words = body.split(/\s+/).filter(Boolean).length;
  if (words > 220) warn.push(`${words} words: cold emails under 150 words get more replies and fewer spam flags`);
  return { block, warn };
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

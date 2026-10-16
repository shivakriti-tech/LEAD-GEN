/**
 * Which email is worth writing to? An owner's own address (drsharma@gmail.com, rahul@shreefurniture.in)
 * beats info@, and an address whose domain can't receive mail is useless.
 */

export type EmailKind = "own_named" | "personal" | "own_generic" | "generic" | "other";

export interface EmailInfo {
  email: string;
  kind: EmailKind;
  /** Domain accepts mail (has MX records). Undefined = not checked. */
  deliverable?: boolean;
  /** A throwaway address (mailinator, yopmail…): nobody reads it. */
  disposable?: boolean;
  /** Mailbox-level check by a verification service (EMAIL_VERIFY_KEY), if one was made. */
  mailbox?: "valid" | "invalid" | "catch_all" | "unknown";
  mailboxBy?: string;
  /** Built from the owner's name (first@domain…) and kept only because the mailbox check said it exists. */
  guessed?: boolean;
}

/** Throwaway-inbox services: an address there belongs to nobody you can sell to. */
const DISPOSABLE = new Set([
  "mailinator.com", "yopmail.com", "guerrillamail.com", "sharklasers.com", "10minutemail.com", "tempmail.com", "temp-mail.org",
  "trashmail.com", "getnada.com", "dispostable.com", "maildrop.cc", "throwawaymail.com", "fakeinbox.com", "mintemail.com",
  "mohmal.com", "emailondeck.com", "tempail.com", "moakt.com", "mailnesia.com", "spamgourmet.com",
]);
export const isDisposable = (email: string) => DISPOSABLE.has(email.split("@")[1]?.toLowerCase() ?? "");

/**
 * A real-looking address. Pages are full of things that match an email pattern but aren't one:
 * image names ("logo@2x.png"), template placeholders ("name@domain.com", "you@example.com").
 */
export function looksLikeEmail(email: string): boolean {
  const e = email.trim().toLowerCase();
  if (!/^[a-z0-9._%+'-]+@[a-z0-9.-]+\.[a-z]{2,24}$/.test(e) || e.includes("..")) return false;
  if (/\.(png|jpe?g|gif|svg|webp|ico|bmp|css|js)$/.test(e)) return false;
  const [local, domain] = e.split("@");
  if (/^(example|domain|yourdomain|email|test|sentry|wixpress|sentry-next)\.(com|in|org|io)$/.test(domain) || domain.endsWith(".example")) return false;
  if (/^(name|yourname|your\.?name|you|user|username|email|someone|abc|xyz|test)$/.test(local)) return false;
  return true;
}

/** Can this address be written to, as far as we know? */
export const usable = (i: EmailInfo) => i.deliverable !== false && i.mailbox !== "invalid" && !i.disposable;

const FREE_MAIL = /@(gmail|googlemail|yahoo|ymail|rediffmail|outlook|hotmail|live|icloud|me|aol|zoho|proton|protonmail)\.[a-z.]+$/i;
const GENERIC_LOCAL = /^(info|contact|contactus|enquiry|enquiries|inquiry|hello|hi|admin|support|sales|office|mail|care|booking|bookings|reservations?|help|team|hr|careers|jobs|marketing|accounts?|billing|feedback|reception|frontdesk|customercare|service|services|web|webmaster)[0-9]*@/i;

export function classifyEmail(email: string, siteDomain?: string): EmailKind {
  const e = email.toLowerCase();
  const generic = GENERIC_LOCAL.test(e);
  const own = !!siteDomain && (e.endsWith("@" + siteDomain) || e.endsWith("." + siteDomain));
  if (own) return generic ? "own_generic" : "own_named";
  if (FREE_MAIL.test(e)) return generic ? "generic" : "personal";
  return generic ? "generic" : "other";
}

/** "Dr. Mehul R. Shah" → ["mehul", "shah"]: plain letters, no titles or initials. */
function nameParts(full: string): string[] {
  return full
    .normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\b(dr|mr|mrs|ms|miss|shri|smt|er|ca|adv|prof|sir)\.?\s+/g, "")
    .split(/[\s.\-']+/)
    .map((p) => p.replace(/[^a-z]/g, ""))
    .filter((p) => p.length > 1);
}

/**
 * Likely addresses for a person at their company's domain, most likely first (yc-outreach measured
 * first@ right 80% of the time, and the right one among these four 93%; Scout uses the same patterns).
 * Never emailed unless a mailbox check confirms one.
 */
export function emailGuesses(fullName: string, domain: string): string[] {
  const p = nameParts(fullName);
  if (!p.length || !/^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(domain)) return [];
  const [first, last] = [p[0], p.length > 1 ? p[p.length - 1] : ""];
  const d = domain.toLowerCase().replace(/^www\./, "");
  return [...new Set([`${first}@${d}`, ...(last ? [`${first}.${last}@${d}`, `${first[0]}${last}@${d}`, `${first}${last}@${d}`] : [])])];
}

const RANK: Record<EmailKind, number> = { own_named: 5, personal: 4, own_generic: 3, other: 2, generic: 1 };

/** Best address to write to first: deliverable, then the most personal. */
export function rankEmails(infos: EmailInfo[]): EmailInfo[] {
  const sure = (i: EmailInfo) => (i.mailbox === "valid" ? 2 : i.mailbox === "catch_all" ? 1 : 0);
  return [...infos].sort((a, b) => Number(usable(b)) - Number(usable(a)) || RANK[b.kind] - RANK[a.kind] || sure(b) - sure(a));
}

export const EMAIL_KIND_LABEL: Record<EmailKind, string> = {
  own_named: "person, own domain",
  personal: "personal inbox",
  own_generic: "shared inbox, own domain",
  generic: "shared inbox",
  other: "other",
};

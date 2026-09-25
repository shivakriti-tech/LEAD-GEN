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
}

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

const RANK: Record<EmailKind, number> = { own_named: 5, personal: 4, own_generic: 3, other: 2, generic: 1 };

/** Best address to write to first: deliverable, then the most personal. */
export function rankEmails(infos: EmailInfo[]): EmailInfo[] {
  return [...infos].sort((a, b) => Number(b.deliverable !== false) - Number(a.deliverable !== false) || RANK[b.kind] - RANK[a.kind]);
}

export const EMAIL_KIND_LABEL: Record<EmailKind, string> = {
  own_named: "person, own domain",
  personal: "personal inbox",
  own_generic: "shared inbox, own domain",
  generic: "shared inbox",
  other: "other",
};

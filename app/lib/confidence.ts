import type { Lead } from "./types";
import { domainOf, isMobile } from "./util";

/**
 * How sure we are that a lead's contact details are right and current, separate from how good a
 * lead it is. A great lead with a dead number wastes a call; this says which ones to double-check.
 *
 * It rewards agreement between independent sources (the phone on the map listing is the one on the
 * business's own website; the email is on the website's own domain), checks that were actually made
 * (mailbox verified, website matched by name and phone) and freshness. Pure, for tests.
 */

export type Confidence = NonNullable<Lead["confidence"]>;

const LISTING: Lead["sources"] = ["google", "gmaps", "osm"];
const digits = (p: string) => p.replace(/\D/g, "").slice(-10);

export function contactConfidence(l: Lead, now = new Date()): Confidence {
  let score = 0;
  const reasons: string[] = [];
  const plus = (n: number, why: string) => {
    score += n;
    if (why) reasons.push(why);
  };
  const a = l.audit;

  // the phone: on the listing and on the website is best
  const phone = l.phone ?? l.phones[0];
  if (phone) {
    const onSite = (a?.phones ?? []).some((p) => digits(p) === digits(phone));
    const onListing = l.sources.some((s) => LISTING.includes(s));
    if (onSite && onListing) plus(35, "Phone matches the map listing and the website");
    else if (onListing && l.sources.some((s) => s === "google" || s === "gmaps")) plus(25, "Phone from the Google listing");
    else if (onSite) plus(20, "Phone from the business's own website");
    else plus(10, "Phone from one source only");
    if (isMobile(phone)) plus(5, "");
  } else reasons.push("No phone number");

  // the email: verified mailbox > own domain with a mail server > anything else
  const best = l.email ? l.emailInfo?.find((e) => e.email === l.email) : undefined;
  if (l.email) {
    const site = domainOf(a?.finalUrl ?? l.website);
    const ownDomain = !!site && l.email.toLowerCase().endsWith(`@${site}`);
    if (best?.mailbox === "valid") plus(30, "Email mailbox verified");
    else if (best?.mailbox === "invalid" || best?.deliverable === false) plus(-20, "Email can't receive mail");
    else if (best?.mailbox === "catch_all") plus(10, "Email domain accepts any address (can't confirm the mailbox)");
    else if (best?.deliverable) plus(15, ownDomain ? "Email on the business's own domain, which receives mail" : "Email domain receives mail");
    else plus(5, "Email not checked");
    if (best?.disposable) plus(-30, "Throwaway email address");
  }

  // the website: found on a listing, or matched by name and phone
  if (a?.status === "ok") {
    if (l.websiteCheck?.via === "source" || l.websiteCheck?.evidence) plus(10, l.websiteCheck?.evidence ? `Website confirmed: ${l.websiteCheck.evidence}` : "Website from the listing, and it loads");
    else plus(5, "Website loads");
  }

  // still in business, and checked recently
  if (l.businessStatus === "CLOSED_TEMPORARILY") plus(-30, "Google says temporarily closed");
  else if (l.businessStatus === "OPERATIONAL") plus(5, "Google says open");
  if (l.sources.length >= 2) plus(10, `Found in ${l.sources.length} sources`);
  const age = l.checkedAt ? (now.getTime() - Date.parse(l.checkedAt)) / 86_400_000 : 0;
  if (age > 30) plus(-15, `Checked ${Math.round(age)} days ago`);

  score = Math.max(0, Math.min(100, score));
  return { level: score >= 65 ? "high" : score >= 35 ? "medium" : "low", score, reasons };
}

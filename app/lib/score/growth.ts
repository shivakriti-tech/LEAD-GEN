import type { Lead, Signal } from "../types";

/**
 * "Why now" signals: the business is new, hiring, expanding, or has a low rating. Each comes with
 * the evidence (the words on its website, the year, the domain date) so a client can see why.
 */

export type Offer = "website" | "logistics" | "agency";

const POINTS: Record<Offer, Record<string, number>> = {
  // a new or expanding business needs a (better) website now; a low rating is a pitch angle
  website: { new_business: 15, expanding: 10, hiring: 5, low_rating: 5 },
  // new = no fixed logistics partner yet; expanding = more freight soon
  logistics: { new_business: 10, expanding: 15, hiring: 5 },
  // growing companies outgrow spreadsheets; hiring = more manual work to automate
  agency: { new_business: 10, expanding: 15, hiring: 10, low_rating: 5 },
};

const MONTH = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-IN", { month: "short", year: "numeric", timeZone: "UTC" });

export function growthSignals(lead: Lead, offer: Offer, now = new Date()): Signal[] {
  const a = lead.audit;
  const g = a?.growth ?? {};
  const out: Signal[] = [];
  const add = (key: string, label: string) => POINTS[offer][key] !== undefined && out.push({ key, label, points: POINTS[offer][key] });
  const year = now.getFullYear();
  const founded = a?.foundedYear ?? lead.company?.foundedYear;
  const domainDays = a?.domainSince ? (now.getTime() - Date.parse(`${a.domainSince}T00:00:00Z`)) / 86_400_000 : undefined;

  if (g.opened) add("new_business", `New business: "${g.opened}" on its website`);
  else if (founded && founded >= year - 1 && founded <= year) add("new_business", `New business: started in ${founded}`);
  // a new domain for a business that's been around for years is just a new website, not a new business
  // (nor is one whose site says "© 2019": the site itself is older than the domain it moved to)
  else if (domainDays != null && domainDays >= 0 && domainDays <= 365 && !(founded && founded < year - 2) && !(a?.copyrightYear && a.copyrightYear < year - 1)) add("new_business", `New business: website domain registered ${MONTH(a!.domainSince!)}`);
  if (g.expanding) add("expanding", `Expanding: "${g.expanding}" on its website`);
  if (g.hiring) add("hiring", `Hiring: "${g.hiring}" on its website`);
  if (lead.rating != null && lead.rating < 3.8 && (lead.reviews ?? 0) >= 15) add("low_rating", `Low Google rating: ${lead.rating.toFixed(1)}★ from ${lead.reviews} reviews`);
  return out;
}

/** One or two sentences for the "why now" line, or "" when there's no growth signal. */
export function growthSentence(lead: Lead, s: Signal[], offer: Offer): string {
  const has = (k: string) => s.find((x) => x.key === k);
  const quote = (k: string) => has(k)!.label.match(/"([^"]+)"/)?.[1];
  const out: string[] = [];
  if (offer === "website") {
    if (has("expanding")) out.push(`They're expanding ("${quote("expanding")}"), a good moment to look better online.`);
    if (has("new_business")) out.push("It's a new business: the best time to get a proper website.");
    if (has("hiring") && out.length < 2) out.push("They're hiring, so the business is growing.");
    if (has("low_rating") && out.length < 2) out.push(`Their Google rating is ${lead.rating!.toFixed(1)}★: a good website with real reviews and photos helps win trust back.`);
  } else if (offer === "agency") {
    if (has("expanding")) out.push(`It's expanding ("${quote("expanding")}"): the moment systems and the website need to scale.`);
    if (has("new_business")) out.push("It's a new business, still choosing its tools.");
    if (has("hiring") && out.length < 2) out.push("It's hiring: more people doing work that software could take on.");
    if (has("low_rating") && out.length < 2) out.push(`Its Google rating is ${lead.rating!.toFixed(1)}★: slow replies and order tracking are common causes.`);
  } else {
    if (has("expanding")) out.push(`It's expanding ("${quote("expanding")}"), so shipments will grow.`);
    if (has("new_business")) out.push("It's a new business, so it likely has no fixed logistics partner yet.");
    if (has("hiring") && out.length < 2) out.push("It's hiring, a sign of growing volumes.");
  }
  return out.slice(0, 2).join(" ");
}

/** The first growth signal as a short tag for the lead card. */
export function growthChip(s: Signal[]): { label: string; kind: "good" | "warn" } | undefined {
  const k = new Set(s.map((x) => x.key));
  if (k.has("expanding")) return { label: "Expanding", kind: "good" };
  if (k.has("new_business")) return { label: "New business", kind: "good" };
  if (k.has("hiring")) return { label: "Hiring", kind: "good" };
  if (k.has("low_rating")) return { label: "Low rating", kind: "warn" };
  return undefined;
}

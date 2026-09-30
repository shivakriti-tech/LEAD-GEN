import type { AgencyService, Lead, Signal, Tier } from "../types";
import { CATEGORIES } from "../categories";
import { SERVICE_LABEL } from "./logistics";
import { growthSentence, growthSignals } from "./growth";

/**
 * Score for your own agency (international): how likely this business needs what you build now.
 * Two kinds of lead:
 *  - store: brands that sell products. No store of their own, only marketplaces, an outgrown
 *    builder, Magento 1, or a Shopify store still on the free theme → a store build or upgrade.
 *  - company: mid-size logistics, resources, manufacturing and trade companies. An old website,
 *    no customer portal or tracking, quotes by email, office roles doing manual data work, several
 *    sites → a website, a CRM / ERP and automation.
 */

export const AGENCY_LABEL: Record<AgencyService, string> = {
  website: "a new website",
  ecommerce: "an online store (Shopify or custom)",
  crm_erp: "a CRM / ERP",
  ai_automation: "AI automation",
};
export const AGENCY_CHIP: Record<AgencyService, string> = {
  website: "Website",
  ecommerce: "Ecommerce store",
  crm_erp: "CRM / ERP",
  ai_automation: "AI automation",
};
export const ALL_AGENCY: AgencyService[] = ["website", "ecommerce", "crm_erp", "ai_automation"];

/** Web and software firms: competitors, not customers. */
const AGENCY_CO = /\b(web ?design|web development|digital agency|digital marketing|seo (agency|company|services)|software (company|development|solutions)|IT (solutions|services)|app development|shopify (expert|partner)|ecommerce agency)\b/i;
/** Old store platforms and site builders a growing brand outgrows. */
const OUTGROWN = new Set(["Wix", "Squarespace", "Ecwid", "OpenCart", "PrestaShop"]);
/** ERPs that small firms outgrow, or that need custom work to connect to a website. */
const LEGACY_ERP = /Tally|Sage|Epicor|Oracle|SAP|Dynamics/;
const FREIGHT = /freight|logistic|trucking|haulage|warehous|3PL|courier|transport/i;

export type AgencyTrack = "store" | "company";

/** Which kind of lead this is: the business type picked in the search, else what its site shows. */
export function trackOf(l: Pick<Lead, "category" | "audit">): AgencyTrack {
  const c = CATEGORIES.find((x) => x.label === l.category && x.track);
  return c?.track ?? (l.audit?.tech?.store || l.audit?.trade?.sellsOnline ? "store" : "company");
}

export function scoreAgency(lead: Lead, services: AgencyService[] = ALL_AGENCY, now = new Date()): { signals: Signal[]; score: number; tier: Tier; whyNow: string; pitchFor: Extract<NonNullable<Lead["pitchFor"]>, { kind: "agency" }> } {
  const offers = new Set(services.length ? services : ALL_AGENCY);
  const track = trackOf(lead);
  const a = lead.audit;
  const tech = a?.tech ?? {};
  const st = a?.status ?? "none";
  const s: Signal[] = [];
  const needs = new Set<AgencyService>();
  // a reason counts in full when you sell what it calls for, a little otherwise
  const add = (key: string, label: string, points: number, ...forWhat: AgencyService[]) => {
    const sold = !forWhat.length || forWhat.some((x) => offers.has(x));
    s.push({ key, label, points: sold ? points : Math.round(points / 4) });
    for (const x of forWhat) if (offers.has(x)) needs.add(x);
  };
  const year = now.getFullYear();
  const keys = () => new Set(s.map((x) => x.key));

  if (AGENCY_CO.test(`${lead.name} ${lead.about ?? ""}`)) add("competitor", "A web or software company itself (a competitor, not a customer)", -70);

  // --- the website ---
  if (!lead.pending) {
    if (st === "none") add("no_website", "No website", 30, "website", ...(track === "store" ? (["ecommerce"] as const) : []));
    else if (st === "social_only") add("social_only", "Only a social media page, no website", 25, "website", ...(track === "store" ? (["ecommerce"] as const) : []));
    else if (st === "down") add("site_down", "Website doesn't load", 20, "website");
  }
  if (st === "ok") {
    if (a?.copyrightYear && a.copyrightYear <= year - 3) add("stale", `Website not updated since ${a.copyrightYear}`, 15, "website");
    if (a?.mobileViewport === false) add("not_mobile", "Website isn't mobile-friendly", 10, "website");
    if (a?.https === false) add("no_https", "Website has no HTTPS (browsers say 'Not secure')", 5, "website");
    if (a?.pageSpeed && a.pageSpeed.score < 50) add("slow", `Slow on mobile (${a.pageSpeed.score}/100)`, 5, "website");
    if (a?.freeSubdomain) add("free_builder", `On a free ${a.builder ?? "builder"} address`, 15, "website");
  }

  if (track === "store") {
    const own = tech.store || !!lead.orderLinks?.some((o) => a?.finalUrl?.includes(o.source));
    if (tech.marketplaces?.length && !own) add("marketplace_only", `Sells on ${tech.marketplaces.slice(0, 3).join(", ")} but has no store of its own`, 25, "ecommerce");
    else if (st === "ok" && !own && !tech.platform) add("no_store", "Website but no online shop", 15, "ecommerce");
    if (tech.platform === "Magento 1") add("magento1", "Store on Magento 1: no security updates since 2020", 30, "ecommerce");
    else if (tech.platform && OUTGROWN.has(tech.platform)) add("outgrown", `Store on ${tech.platform}: hard to grow on`, 20, "ecommerce");
    else if (tech.platform === "WooCommerce" || tech.platform === "Magento 2") add("heavy_platform", `Store on ${tech.platform}: upkeep-heavy, a candidate for Shopify or a custom build`, 10, "ecommerce");
    if (tech.defaultTheme) add("default_theme", `Shopify store still on the free ${tech.defaultTheme} theme`, 20, "ecommerce");
    const paidTools = (tech.tools ?? []).filter((t) => /Klaviyo|Recharge|Reviews app|Gorgias|Yotpo/.test(t));
    if (paidTools.length) add("invests", `Pays for store tools (${paidTools.join(", ")}): has a budget`, 10);
    else if (own) add("no_flows", "No email or chat automation on the store", 5, "ai_automation");
    if (tech.marketplaces?.length && own) add("multichannel", `Also sells on ${tech.marketplaces.slice(0, 2).join(", ")}: orders and stock in several places`, 5, "crm_erp");
  } else {
    const freight = FREIGHT.test(lead.category) || FREIGHT.test(lead.name);
    if (st === "ok" && !tech.portal && !tech.tracking) add("no_portal", freight ? "No shipment tracking or customer login on the site" : "No customer or dealer login on the site", freight ? 20 : 10, "crm_erp", "website");
    if (tech.quoteForm && !tech.portal) add("quote_by_email", "Quotes by form or email: can be automated", 10, "ai_automation");
    if (tech.erp?.length) {
      const legacy = tech.erp.filter((e) => LEGACY_ERP.test(e));
      add("erp", `Uses ${tech.erp.slice(0, 2).join(", ")}${legacy.length ? ": needs custom work to connect" : ""}`, legacy.length ? 10 : 5, "crm_erp", "ai_automation");
    }
    if (tech.manualRoles?.length) add("manual_roles", `Hiring for manual office work (${tech.manualRoles.slice(0, 2).join(", ")})`, 20, "ai_automation", "crm_erp");
    if ((tech.locations ?? 0) >= 3) add("locations", `${tech.locations} locations: data spread across sites`, 10, "crm_erp");
    const crm = (tech.tools ?? []).filter((t) => /HubSpot|Salesforce|Zoho|Pipedrive|Freshworks|Zendesk/.test(t));
    if (crm.length) add("has_crm", `Uses ${crm.join(", ")}: ready for automation on top`, 5, "ai_automation");
    const emp = lead.company?.employees;
    if (emp && emp >= 20 && emp <= 500) add("size", `About ${emp} employees`, 10);
    else if (emp && emp > 1000) add("enterprise", `About ${emp} employees: big IT team, long buying cycle`, -15);
    const since = a?.foundedYear ?? lead.company?.foundedYear;
    if (since && year - since >= 5) add("established", `Running since ${since}`, 5);
  }

  if (!keys().has("competitor")) for (const g of growthSignals(lead, "agency", now)) s.push(g);
  if (keys().has("hiring") && offers.has("ai_automation")) needs.add("ai_automation");
  if (keys().has("expanding") || keys().has("new_business")) for (const x of ["website", "crm_erp"] as const) if (offers.has(x) && (track === "company" || x === "website")) needs.add(x);
  if ((lead.reviews ?? 0) >= 50) add("busy", `${lead.reviews} Google reviews`, 5);
  if (lead.chain) add("chain", "Big brand or chain: head office buys, often with an agency already", -10);
  if (lead.phone || lead.phones.length || a?.whatsapp) add("has_phone", "Has a phone number", 5);
  if (lead.email || lead.emails.length || a?.emails.length) add("has_email", "Has an email", 5);
  const owner = lead.owner?.name ?? a?.ownerName;
  if (owner) add("owner_known", `Owner: ${owner}`, 5);
  if (!needs.size && !keys().has("competitor")) {
    const d: AgencyService = track === "store" ? "ecommerce" : "crm_erp";
    needs.add(offers.has(d) ? d : [...offers][0]);
  }

  const score = Math.max(0, Math.min(100, s.reduce((t, x) => t + x.points, 0)));
  const tier: Tier = score >= 60 ? "hot" : score >= 30 ? "warm" : "cold";
  const list = ALL_AGENCY.filter((x) => needs.has(x));
  const growth = keys().has("competitor") ? "" : growthSentence(lead, s, "agency");
  return { signals: s, score, tier, whyNow: [whyNow(lead, s, list, track), growth].filter(Boolean).join(" "), pitchFor: { kind: "agency", needs: list, track } };
}

const join = (xs: string[]) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

function whyNow(lead: Lead, s: Signal[], needs: AgencyService[], track: AgencyTrack): string {
  const has = (k: string) => s.find((x) => x.key === k);
  if (has("competitor")) return "Looks like a web or software company itself: a competitor, not a customer.";
  const where = lead.city ? ` in ${lead.city}` : "";
  const reasons = ["marketplace_only", "magento1", "default_theme", "outgrown", "no_store", "no_website", "social_only", "site_down", "no_portal", "manual_roles", "quote_by_email", "erp", "locations", "stale", "heavy_platform"]
    .map(has)
    .filter((x): x is Signal => !!x)
    .slice(0, 2)
    .map((x) => x.label.replace(/:.*$/, "").replace(/^./, (c) => c.toLowerCase()));
  const lead0 = `${lead.category}${where}${track === "company" && (lead.audit?.tech?.locations ?? 0) >= 3 ? ` with ${lead.audit!.tech!.locations} locations` : ""}`;
  const why = reasons.length ? `: ${join(reasons)}` : "";
  return `${lead0}${why}.${needs.length ? ` Likely needs ${join(needs.map((n) => AGENCY_LABEL[n]))}.` : ""}`;
}

/** The reasons that make an agency lead worth a message on their own (the "clear reason" filter). */
const REASONS = new Set(["no_website", "social_only", "site_down", "marketplace_only", "magento1", "default_theme", "outgrown", "no_store", "no_portal", "manual_roles", "quote_by_email", "stale"]);
export const hasAgencyReason = (l: Pick<Lead, "signals">) => l.signals.some((x) => REASONS.has(x.key));

/** What a lead likely needs, in words, for either kind of search (reports, CSV). */
export function needLabels(p: Lead["pitchFor"]): string[] {
  if (!p) return [];
  return p.kind === "agency" ? p.needs.map((n) => AGENCY_LABEL[n]) : p.needs.map((n) => SERVICE_LABEL[n]);
}

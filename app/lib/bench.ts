import { mergePlaces } from "./dedupe";
import type { SearchHit } from "./enrich/discover";
import { checkWebsites, findMissingWebsites, type Deps } from "./pipeline";
import { scoreWebsiteDev } from "./score/websiteDev";
import { domainOf, isMobile, isSocialHost, mapLimit } from "./util";
import type { Lead } from "./types";

/**
 * Lead-quality benchmark: a fixed set of real businesses, some with hand-checked answers,
 * run through the same website search and website check as a real search, then scored.
 * See bench/README.md.
 */

/** One business in the benchmark (from OpenStreetMap). */
export interface BenchCase {
  id: string; // OSM id, e.g. "node/123"
  name: string;
  category: string;
  city: string;
  address?: string;
  phone?: string;
  email?: string;
  lat?: number;
  lng?: number;
  /** Website OpenStreetMap lists. Hidden during the run: can we find it ourselves? */
  osmWebsite?: string;
}

/** Your hand-checked answers (bench/vadodara.labels.csv). Blank = not checked. */
export interface BenchLabel {
  website?: string; // a domain, or "none"
  email?: string;
  mobile?: string;
  owner?: string;
  pitch?: "yes" | "no";
}

export interface BenchOutcome {
  id: string;
  lead: Lead;
  ms: number; // time spent on this business
}

const pct = (n: number, d: number) => (d ? Math.round((n / d) * 1000) / 10 : null);
const bare = (d?: string) => d?.toLowerCase().replace(/^www\./, "");
const sameSite = (a?: string, b?: string) => !!a && !!b && (a === b || a.endsWith("." + b) || b.endsWith("." + a));
const digits = (p?: string) => (p ?? "").replace(/\D/g, "").slice(-10);

/** The right answer for "what is this business's website": a domain, "none", or undefined (unknown). */
export function truthWebsite(c: BenchCase, label?: BenchLabel): string | undefined {
  const l = label?.website?.trim().toLowerCase();
  if (l) return l === "none" ? "none" : bare(domainOf(l));
  const d = bare(domainOf(c.osmWebsite));
  return d && !isSocialHost(d) ? d : undefined;
}

export interface WebsiteRow {
  id: string;
  name: string;
  truth: string;
  found?: string;
  verdict: "correct" | "wrong" | "missed" | "correct_none";
  evidence?: string;
}

export function evaluate(cases: BenchCase[], outcomes: BenchOutcome[], labels: Record<string, BenchLabel> = {}) {
  const byId = new Map(outcomes.map((o) => [o.id, o]));
  const rows: WebsiteRow[] = [];
  let mobile = 0, email = 0, personalEmail = 0, owner = 0, n = 0;
  const lab = { email: [0, 0], mobile: [0, 0], owner: [0, 0], pitch: [0, 0] };
  const times: number[] = [];

  for (const c of cases) {
    const o = byId.get(c.id);
    if (!o) continue;
    n++;
    times.push(o.ms);
    const l = o.lead;
    const label = labels[c.id];

    // website
    const truth = truthWebsite(c, label);
    const foundUrl = l.websiteCheck?.via === "domain_guess" || l.websiteCheck?.via === "web_search" || l.websiteCheck?.via === "instagram_bio" ? l.website : undefined;
    const found = bare(domainOf(foundUrl));
    const foundReal = found && !isSocialHost(found) ? found : undefined;
    if (truth) {
      const verdict: WebsiteRow["verdict"] =
        truth === "none" ? (foundReal ? "wrong" : "correct_none") : !foundReal ? "missed" : sameSite(foundReal, truth) ? "correct" : "wrong";
      rows.push({ id: c.id, name: c.name, truth, found: foundReal, verdict, evidence: l.websiteCheck?.evidence });
    }

    // contacts
    const hasMobile = l.phones.some(isMobile) || !!l.audit?.whatsapp;
    if (hasMobile) mobile++;
    if (l.email) email++;
    if (l.email && ["own_named", "personal"].includes(l.emailInfo?.[0]?.kind ?? "")) personalEmail++;
    if (l.owner) owner++;

    // hand-checked answers
    if (label?.email) { lab.email[1]++; if (l.emails.some((e) => e.toLowerCase() === label.email!.toLowerCase())) lab.email[0]++; }
    if (label?.mobile) { lab.mobile[1]++; if ([...l.phones, l.audit?.whatsapp].some((p) => p && digits(p) === digits(label.mobile))) lab.mobile[0]++; }
    if (label?.owner) { lab.owner[1]++; if (l.owner && l.owner.name.toLowerCase().includes(label.owner.toLowerCase().split(/\s+/).pop()!)) lab.owner[0]++; }
    if (label?.pitch) { lab.pitch[1]++; if ((label.pitch === "yes") === (l.tier !== "cold")) lab.pitch[0]++; }
  }

  const count = (v: WebsiteRow["verdict"]) => rows.filter((r) => r.verdict === v).length;
  const correct = count("correct"), wrong = count("wrong"), missed = count("missed"), correctNone = count("correct_none");
  const withSite = correct + missed + rows.filter((r) => r.verdict === "wrong" && r.truth !== "none").length;
  times.sort((a, b) => a - b);

  return {
    businesses: n,
    website: {
      checked: rows.length,
      correct,
      wrong,
      missed,
      correctNone,
      /** Of the websites we accepted, how many were really theirs. Wrong sites are worse than none. */
      precision: pct(correct, correct + wrong),
      /** Of the businesses that do have a website, how many we found. */
      recall: pct(correct, withSite),
    },
    contacts: {
      mobileOrWhatsapp: pct(mobile, n),
      email: pct(email, n),
      personalEmail: pct(personalEmail, n),
      owner: pct(owner, n),
    },
    handChecked: {
      emailFound: pct(lab.email[0], lab.email[1]),
      mobileFound: pct(lab.mobile[0], lab.mobile[1]),
      ownerFound: pct(lab.owner[0], lab.owner[1]),
      tierAgrees: pct(lab.pitch[0], lab.pitch[1]),
      labelled: Math.max(...Object.values(lab).map((x) => x[1])),
    },
    speed: {
      avgSec: n ? Math.round(times.reduce((a, b) => a + b, 0) / n / 100) / 10 : null,
      p90Sec: n ? Math.round(times[Math.min(n - 1, Math.floor(n * 0.9))] / 100) / 10 : null,
    },
    rows,
  };
}

export type BenchReport = ReturnType<typeof evaluate>;

/** Flatten the headline numbers for printing and comparing runs. */
export function headline(r: BenchReport): Record<string, number | null> {
  return {
    "website precision %": r.website.precision,
    "website recall %": r.website.recall,
    "wrong websites": r.website.wrong,
    "mobile/WhatsApp %": r.contacts.mobileOrWhatsapp,
    "email %": r.contacts.email,
    "personal email %": r.contacts.personalEmail,
    "owner name %": r.contacts.owner,
    "hand-checked email found %": r.handChecked.emailFound,
    "hand-checked mobile found %": r.handChecked.mobileFound,
    "hand-checked owner found %": r.handChecked.ownerFound,
    "tier agrees with you %": r.handChecked.tierAgrees,
    "sec per business (avg)": r.speed.avgSec,
    "sec per business (p90)": r.speed.p90Sec,
  };
}

/** Lower is better for these; everything else higher is better. */
export const LOWER_IS_BETTER = new Set(["wrong websites", "sec per business (avg)", "sec per business (p90)"]);

/** Labels CSV: one row per business, blanks for you to fill in. */
export const LABEL_COLUMNS = ["id", "name", "category", "phone", "address", "osm_website", "website", "email", "mobile", "owner", "pitch", "notes"] as const;

export function labelsFromRows(rows: Record<string, string>[]): Record<string, BenchLabel> {
  const out: Record<string, BenchLabel> = {};
  for (const r of rows) {
    if (!r.id) continue;
    const pitch = /^y/i.test(r.pitch ?? "") ? "yes" : /^n/i.test(r.pitch ?? "") ? "no" : undefined;
    const l: BenchLabel = { website: r.website || undefined, email: r.email || undefined, mobile: r.mobile || undefined, owner: r.owner || undefined, pitch };
    if (Object.values(l).some(Boolean)) out[r.id] = l;
  }
  return out;
}

/**
 * Run each business through the same steps as a real search: look for its website (the one
 * OpenStreetMap lists is hidden), check the site, collect and rank contacts, score.
 * One business at a time per worker, so the time per business is exact.
 */
export async function runCases(
  cases: BenchCase[],
  deps: Pick<Deps, "discover" | "audit" | "mx">,
  opts: { search?: (q: string) => Promise<SearchHit[]>; concurrency?: number; onDone?: (done: number, total: number) => void } = {},
): Promise<BenchOutcome[]> {
  let done = 0;
  const quiet = () => {};
  return mapLimit(cases, opts.concurrency ?? 4, async (c) => {
    const [lead] = mergePlaces([{ source: "osm", sourceId: c.id, name: c.name, category: c.category, city: c.city, address: c.address, phone: c.phone, email: c.email, lat: c.lat, lng: c.lng }]);
    const t = Date.now();
    await findMissingWebsites([lead], { verify: true, search: opts.search }, deps, quiet);
    await checkWebsites([lead], deps, quiet);
    Object.assign(lead, scoreWebsiteDev(lead));
    const ms = Date.now() - t;
    opts.onDone?.(++done, cases.length);
    return { id: c.id, lead, ms };
  });
}

import * as cheerio from "cheerio";
import { lookup } from "node:dns/promises";
import type { Lead } from "../types";
import { fetchPublic } from "../safeFetch";
import { domainOf, fetchWithTimeout, isSocialHost } from "../util";

/**
 * Map data is often missing the website. Before we call a business "no website",
 * we look for one ourselves and only accept a site whose page proves it belongs to
 * this business (its name plus its phone number or its area/city).
 */

/** Words that say what a business is, not who it is. Can't be used on their own to identify a site. */
const GENERIC = new Set(
  (
    "the and of for pvt private ltd limited llp co company india indian " +
    "clinic clinics dental dentist dentistry doctor doctors dr hospital care centre center health healthcare multispeciality speciality " +
    "skin hair derma dermatology physio physiotherapy rehab " +
    "salon salons spa beauty parlour parlor unisex studio makeover " +
    "gym fitness yoga zumba " +
    "cafe cafes coffee tea bakery bakers restaurant restaurants hotel hotels kitchen dhaba food foods foodcourt biryani pizza " +
    "classes class coaching academy institute tuition tutorials school education " +
    "realty realtors real estate properties property estates homes builders developers " +
    "interior interiors designer designers design decor " +
    "associates consultants consultancy services solutions enterprises traders store stores shop shops mart " +
    "and co"
  ).split(/\s+/),
);

export function significantTokens(name: string): string[] {
  return name
    .toLowerCase()
    .replace(/&/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 3 && !GENERIC.has(t));
}

/** Directory/listing sites that are never the business's own website. */
const DIRECTORY_HOSTS = [
  "justdial.com", "sulekha.com", "practo.com", "lybrate.com", "zomato.com", "swiggy.com", "magicpin.in", "dineout.co.in",
  "eazydiner.com", "tripadvisor.in", "tripadvisor.com", "indiamart.com", "tradeindia.com", "yellowpages.in", "asklaila.com",
  "housing.com", "99acres.com", "magicbricks.com", "nobroker.in", "urbancompany.com", "google.com", "goo.gl", "youtube.com",
  "wikipedia.org", "wikimapia.org", "mapquest.com", "foursquare.com", "yelp.com", "grotal.com", "quickerala.com", "burrp.com",
  "credihealth.com", "docprime.com", "clinicspots.com", "bookmyshow.com", "booking.com", "makemytrip.com", "goibibo.com",
  "agoda.com", "oyorooms.com", "cult.fit", "fitternity.com", "zaubacorp.com", "tofler.in", "indiafilings.com", "glassdoor.co.in",
  "naukri.com", "ambitionbox.com", "shiksha.com", "collegedunia.com", "linkedin.com", "twitter.com", "x.com", "pinterest.com",
  "duckduckgo.com", "bing.com", "apple.com", "waze.com", "restaurantguru.com", "restaurant-guru.in", "restaurant-guru.com", "promallu.com", "cybo.com", "stanzaliving.com", "nestaway.com", "zolostays.com", "yourstory.com", "ubuy.co.in", "infoisinfo.co.in", "nearbuy.com",
];
export const isDirectory = (domain?: string) =>
  !!domain && DIRECTORY_HOSTS.some((h) => domain === h || domain.endsWith("." + h));

export interface Verdict {
  ok: boolean;
  evidence: string;
  /** "phone" = the lead's own phone number is on the page (strong); "place" = only the area/city (weak). */
  proof?: "phone" | "place";
}

const TLD_PARTS = new Set(["www", "com", "in", "co", "org", "net", "info", "biz", "online", "site", "store", "shop", "clinic", "cafe", "io", "me", "app", "ac", "edu", "gov", "res", "firm", "gen", "ind"]);

/** The part of a domain that names the site: "www.theeyeclinicvadodara.com" → "theeyeclinicvadodara". */
export function domainLabel(domain: string): string {
  return domain.toLowerCase().split(".").filter((p) => !TLD_PARTS.has(p)).join("");
}

/**
 * Is this web address named after the business? A business's own site nearly always is
 * (teapost.in, theeyeclinicvadodara.com). Listing sites, hostels "near X", review pages aren't.
 */
export function domainMatchesName(domain: string, name: string): boolean {
  const label = domainLabel(domain).replace(/[^a-z0-9]/g, "");
  if (label.length < 3) return false;
  const words = name.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean);
  const full = words.join("");
  const noThe = words.filter((w) => w !== "the").join("");
  const core = significantTokens(name).join("");
  const initials = words.filter((w) => w !== "the" && w !== "and").map((w) => w[0]).join("");
  if (full.length >= 4 && label.includes(full)) return true;
  if (noThe.length >= 4 && label.includes(noThe)) return true;
  if (core.length >= 4 && label.includes(core)) return true;
  // "Sharma Dental Care" → sdc…: only when the label is essentially just the initials plus a place/word
  if (initials.length >= 3 && label.startsWith(initials) && label.length <= initials.length + 12) return true;
  return false;
}

/** A page about this business on someone else's site, e.g. /Tea-Post-Bhayli-Vadodara or /aum-clinic-q57lj/. */
export function isListingPath(url: string, name: string): boolean {
  let path = "";
  try {
    path = decodeURIComponent(new URL(url).pathname).toLowerCase();
  } catch {
    return false;
  }
  const squashedPath = path.replace(/[^a-z0-9]/g, "");
  const full = name.toLowerCase().replace(/[^a-z0-9]/g, "");
  return full.length >= 4 && squashedPath.includes(full);
}

const isRootPath = (url: string) => {
  try {
    return /^\/?(index\.(html?|php))?$/i.test(new URL(url).pathname);
  } catch {
    return false;
  }
};

/** Does this page belong to this lead? Needs the name AND (phone OR area/city). */
export function verifyPageForLead(html: string, lead: Pick<Lead, "name" | "phones" | "phone" | "city" | "address">, area?: string): Verdict {
  const $ = cheerio.load(html);
  const title = ($("title").first().text() + " " + $('meta[property="og:site_name"]').attr("content") + " " + $("h1").first().text()).toLowerCase();
  const body = $("body").text().replace(/\s+/g, " ").toLowerCase().slice(0, 300_000);
  const all = title + " " + body;
  const squashed = all.replace(/[^a-z0-9]/g, "");

  const tokens = significantTokens(lead.name);
  if (!tokens.length) return { ok: false, evidence: "name is too generic to verify" };
  const fullName = lead.name.toLowerCase().replace(/[^a-z0-9]/g, "");
  // Short leftovers like "post" (from "Tea Post") are too weak alone; then insist on the full name.
  const tokensStrong = tokens.join("").length >= 5;
  const nameInTitle = title.replace(/[^a-z0-9]/g, "").includes(fullName) || (tokensStrong && tokens.every((t) => title.includes(t)));
  const nameOnPage = nameInTitle || squashed.includes(fullName) || (tokensStrong && tokens.every((t) => all.includes(t)));
  if (!nameOnPage) return { ok: false, evidence: "business name not on the page" };

  const digits = all.replace(/\D/g, "");
  const phones = [...new Set([lead.phone, ...lead.phones].filter(Boolean) as string[])];
  const phoneHit = phones.find((p) => digits.includes(p.replace(/\D/g, "").slice(-10)));
  if (phoneHit) return { ok: true, evidence: "business name and phone number are on the page", proof: "phone" };

  const places = [area, lead.city, ...(lead.address?.split(",").map((x) => x.trim()) ?? [])]
    .filter((x): x is string => !!x && x.length >= 4 && !/^\d+$/.test(x))
    .map((x) => x.toLowerCase());
  const placeHit = places.find((p) => all.includes(p));
  if (placeHit && nameInTitle) return { ok: true, evidence: `business name (in the page title) and "${placeHit}" are on the page`, proof: "place" };
  return { ok: false, evidence: placeHit ? "name only in the text, not the title" : "name found but no matching phone or location" };
}

/** Likely domains for a business name, most likely first. */
export function candidateDomains(name: string, city?: string): string[] {
  const words = name
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\b(pvt|private|ltd|limited|llp)\b\.?/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  if (!words.length) return [];
  const full = words.join("");
  const noThe = words.filter((w) => w !== "the").join("");
  const core = significantTokens(name).join("");
  const stems = [...new Set([full, noThe, words.join("-"), core && core !== noThe ? core : "", city ? noThe + city.toLowerCase().replace(/[^a-z]/g, "") : ""])].filter(
    (s) => s.length >= 4 && s.length <= 40,
  );
  const out: string[] = [];
  for (const s of stems.slice(0, 3)) for (const tld of ["com", "in", "co.in"]) out.push(`${s}.${tld}`);
  if (stems[3]) out.push(`${stems[3]}.com`, `${stems[3]}.in`);
  return [...new Set(out)].slice(0, 10);
}

async function fetchHtml(url: string, ms = 7000): Promise<{ html: string; finalUrl: string } | null> {
  try {
    const r = await fetchPublic(url, { headers: { Accept: "text/html" } }, ms);
    if (!r.ok || !(r.headers.get("content-type") || "").includes("html")) return null;
    return { html: (await r.text()).slice(0, 1_000_000), finalUrl: r.url || url };
  } catch {
    return null;
  }
}

export interface SearchHit {
  url: string;
  title: string;
  /** Short text under the result, when the search provider gives one. */
  snippet?: string;
}

/** DuckDuckGo's HTML page. Free and keyless; best-effort, keep it slow. */
export async function duckDuckGoSearch(query: string): Promise<SearchHit[]> {
  const r = await fetchWithTimeout(`https://html.duckduckgo.com/html/?${new URLSearchParams({ q: query, kl: "in-en" })}`, { headers: { Accept: "text/html" } }, 12_000);
  if (!r.ok) throw new Error(`DuckDuckGo ${r.status}`);
  const $ = cheerio.load(await r.text());
  const hits: SearchHit[] = [];
  $("a.result__a").each((_, a) => {
    let href = $(a).attr("href") || "";
    try {
      const u = new URL(href, "https://duckduckgo.com");
      href = u.searchParams.get("uddg") || u.toString();
    } catch {}
    if (/^https?:/.test(href)) hits.push({ url: href, title: $(a).text().trim(), snippet: $(a).closest(".result").find(".result__snippet").text().trim() || undefined });
  });
  if (!hits.length && /anomaly|captcha|unusual traffic/i.test($.text())) throw new Error("DuckDuckGo asked for a captcha. Web search paused for this run.");
  return hits.slice(0, 10);
}

/** Brave Search API (optional key; about 1,000 free queries a month). */
export async function braveSearch(query: string, apiKey: string): Promise<SearchHit[]> {
  const r = await fetchWithTimeout(`https://api.search.brave.com/res/v1/web/search?${new URLSearchParams({ q: query, country: "in", count: "10" })}`, {
    headers: { Accept: "application/json", "X-Subscription-Token": apiKey },
  }, 12_000);
  if (!r.ok) throw new Error(`Brave Search ${r.status}`);
  const j = (await r.json()) as { web?: { results?: Array<{ url: string; title: string }> } };
  return (j.web?.results ?? []).map((x: any) => ({ url: x.url, title: x.title, snippet: x.description }));
}

export interface DiscoverResult {
  website?: string;
  via?: "domain_guess" | "web_search";
  evidence?: string;
  social?: string; // an Instagram/Facebook page found by search, if no real site
  tried: string[];
}

/**
 * Does this domain exist at all? Most guessed addresses don't, and DNS says so in milliseconds,
 * where loading the page would wait for a timeout. Remembered for the life of the server.
 */
const dnsSeen = new Map<string, Promise<boolean>>();
export function dnsResolves(domain: string): Promise<boolean> {
  let p = dnsSeen.get(domain);
  if (!p) {
    p = Promise.race([
      lookup(domain).then(() => true, (e: NodeJS.ErrnoException) => !(e.code === "ENOTFOUND" || e.code === "ENODATA")),
      new Promise<boolean>((r) => setTimeout(() => r(true), 3000)), // slow DNS: let the page load decide
    ]);
    dnsSeen.set(domain, p);
  }
  return p;
}

export interface DiscoverDeps {
  fetchHtml?: typeof fetchHtml;
  /** Does this domain exist? Default: a DNS lookup, only when fetchHtml isn't replaced (tests). */
  resolves?: (domain: string) => Promise<boolean>;
  search?: (q: string) => Promise<SearchHit[]>; // undefined = web search off
}

export const CHAIN_WORDS = /\b(franchise|franchisee|store locator|our outlets|find (a|an) (store|outlet)|all outlets|outlets across|branches across|\d{2,}\+? (outlets|stores|branches))\b/i;

/**
 * Is this URL (e.g. the website in an Instagram bio) really this business's own site?
 * Same ownership rules as discovery: address matches the name, or homepage with their phone.
 */
export async function verifyCandidate(url: string, lead: Lead, area: string | undefined, get: typeof fetchHtml = fetchHtml): Promise<{ ok: boolean; finalUrl?: string; evidence: string }> {
  const d = domainOf(url);
  if (!d || isSocialHost(d) || isDirectory(d)) return { ok: false, evidence: "not a business website" };
  const page = await get(url);
  if (!page) return { ok: false, evidence: "didn't load" };
  const v = verifyPageForLead(page.html, lead, area);
  const fd = domainOf(page.finalUrl) ?? d;
  if (v.ok && (domainMatchesName(fd, lead.name) || domainMatchesName(d, lead.name))) return { ok: true, finalUrl: page.finalUrl, evidence: `${v.evidence}, and the web address matches the name` };
  if (v.ok && v.proof === "phone") return { ok: true, finalUrl: page.finalUrl, evidence: v.evidence };
  // A link the business itself put in its own bio is strong evidence even if the name check is weak,
  // but only when the page at least carries the name.
  if (/business name/.test(v.evidence) && !/not on the page/.test(v.evidence)) return { ok: true, finalUrl: page.finalUrl, evidence: "linked from the business's own profile and the page carries its name" };
  return { ok: false, evidence: v.evidence };
}

function withRejects(tried: string[], rejected: string[]): string[] {
  if (rejected.length && !tried.some((t) => t.startsWith("rejected"))) tried.push(`rejected ${rejected.slice(0, 4).join(", ")}`);
  return tried;
}

/** Look for a lead's real website. Never throws. */
export async function discoverWebsite(lead: Lead, area: string | undefined, deps: DiscoverDeps = {}): Promise<DiscoverResult & { chainHint?: string }> {
  const get = deps.fetchHtml ?? fetchHtml;
  const resolves = deps.resolves ?? (deps.fetchHtml ? undefined : dnsResolves);
  const tried: string[] = [];
  const check = async (url: string): Promise<{ v: Verdict; finalUrl: string; html: string } | null> => {
    const page = await get(url);
    if (!page) return null;
    return { v: verifyPageForLead(page.html, lead, area), finalUrl: page.finalUrl, html: page.html };
  };
  const chainHint = (html: string) => (CHAIN_WORDS.test(html.slice(0, 400_000)) ? "its website mentions outlets or franchising" : undefined);

  // 1. likely domains
  const guesses = candidateDomains(lead.name, lead.city);
  if (guesses.length) {
    tried.push(`${guesses.length} likely web addresses (${guesses.slice(0, 3).join(", ")}…)`);
    // all at once: most guesses fail fast (no such domain); keep the most likely one that verifies
    const results = await Promise.all(
      guesses.map(async (d) => {
        if (resolves && !(await resolves(d))) return null; // no such domain: skip the page load
        return (await check(`https://${d}`)) ?? (await check(`http://${d}`));
      }),
    );
    const r = results.find((x) => x?.v.ok);
    if (r) return { website: r.finalUrl, via: "domain_guess", evidence: r.v.evidence, tried, chainHint: chainHint(r.html) };
  }

  // 2. web search
  if (deps.search) {
    const q = [lead.name, area, lead.city].filter(Boolean).join(" ");
    tried.push(`web search for "${q}"`);
    let hits: SearchHit[] = [];
    try {
      hits = await deps.search(q);
    } catch (e) {
      tried.push(`web search failed: ${e instanceof Error ? e.message : e}`);
    }
    const tokens = significantTokens(lead.name);
    let social: string | undefined;
    let checked = 0;
    const rejected: string[] = [];
    for (const h of hits) {
      const d = domainOf(h.url);
      if (!d) continue;
      if (isDirectory(d)) {
        rejected.push(`${d} (listing site)`);
        continue;
      }
      if (isSocialHost(d)) {
        // An Instagram/Facebook page whose title carries the name: good enough to say "uses social as website".
        if (!social && tokens.length && tokens.every((t) => h.title.toLowerCase().includes(t))) social = h.url;
        continue;
      }
      const ownName = domainMatchesName(d, lead.name);
      // A page about the business on someone else's site (review site, "PG near X", directory): never its website.
      if (!ownName && isListingPath(h.url, lead.name)) {
        rejected.push(`${d} (a page about it on another site)`);
        continue;
      }
      if (checked++ >= 4) break;
      const r = await check(h.url);
      if (!r) continue;
      const finalDomain = domainOf(r.finalUrl) ?? d;
      const own = ownName || domainMatchesName(finalDomain, lead.name);
      if (r.v.ok && own) {
        return { website: r.finalUrl, via: "web_search", evidence: `${r.v.evidence}, and the web address matches the name`, tried: withRejects(tried, rejected), chainHint: chainHint(r.html) };
      }
      // Different-looking address: only if it's the site's homepage AND shows the business's own phone number.
      if (r.v.ok && r.v.proof === "phone" && isRootPath(r.finalUrl) && !isDirectory(finalDomain)) {
        return { website: r.finalUrl, via: "web_search", evidence: `${r.v.evidence} (homepage of ${finalDomain})`, tried: withRejects(tried, rejected), chainHint: chainHint(r.html) };
      }
      rejected.push(`${finalDomain} (${r.v.ok ? "mentions the business but isn't its own site" : r.v.evidence})`);
    }
    withRejects(tried, rejected);
    if (social) return { social, tried };
  }
  return { tried };
}

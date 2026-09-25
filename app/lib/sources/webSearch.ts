import * as cheerio from "cheerio";
import type { RawPlace } from "../types";
import { CHAIN_WORDS, isDirectory, significantTokens, type SearchHit } from "../enrich/discover";
import { fetchPublic } from "../safeFetch";
import { domainOf, isSocialHost, normalizePhone } from "../util";

/**
 * Search engines as a lead source (through SearXNG / Tavily / … — whatever web search is set up).
 * Finds local businesses that have their OWN website, which matters for the website pitch:
 * those are the ones with slow, old or broken sites.
 *
 * Every result is checked before it becomes a lead:
 *  - not a directory, marketplace, social page or national online store,
 *  - its homepage actually mentions the city or area,
 *  - it isn't a chain that talks about outlets/franchising.
 */

/** Big online stores and national brands that show up for "<type> in <city>" but are never local leads. */
const NATIONAL = [
  "pepperfry.com", "urbanladder.com", "flipkart.com", "amazon.in", "amazon.com", "ikea.com", "damroindia.com", "royaloakindia.com",
  "woodenstreet.com", "homecentre.in", "furniselan.com", "godrejinterio.com", "nilkamal.com", "durian.in", "hometown.in",
  "myntra.com", "ajio.com", "nykaa.com", "meesho.com", "snapdeal.com", "jiomart.com", "bigbasket.com", "blinkit.com", "zeptonow.com",
  "lenskart.com", "tatacliq.com", "croma.com", "reliancedigital.in", "decathlon.in",
  "apollo247.com", "practo.com", "1mg.com", "pharmeasy.in", "netmeds.com", "cult.fit", "curefit.com",
  "oyorooms.com", "treebo.com", "fabhotels.com", "makemytrip.com", "goibibo.com", "booking.com", "agoda.com", "airbnb.co.in", "airbnb.com",
  "urbancompany.com", "housing.com", "99acres.com", "magicbricks.com", "nobroker.in", "squareyards.com", "commonfloor.com",
  "byjus.com", "unacademy.com", "vedantu.com", "physicswallah.live", "allen.ac.in", "aakash.ac.in",
  "livspace.com", "designcafe.com", "homelane.com", "bonito.in", "nilkamalhomes.com", "interio.com", "itchotels.in", "marriott.com", "hilton.com", "tajhotels.com",
  "quora.com", "reddit.com", "medium.com", "wikipedia.org", "timesofindia.indiatimes.com", "indiatimes.com", "hindustantimes.com",
  "ndtv.com", "news18.com", "thehindu.com", "indianexpress.com", "deccanherald.com", "dnaindia.com", "gov.in", "nic.in",
];
export const isNational = (d?: string) => !!d && NATIONAL.some((h) => d === h || d.endsWith("." + h));

/** Queries to run per business type. Two is enough; more just burns search quota. */
export function webQueries(term: string, place: string): string[] {
  return [`${term} in ${place}`, `${term} ${place} contact number address`];
}

const normalise = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Does this text mention the place? "Bhayli, Vadodara" → looks for "bhayli" or "vadodara" (and Baroda for Vadodara). */
export function mentionsPlace(text: string, city: string, area?: string): boolean {
  const t = ` ${normalise(text)} `;
  const names = [area, city, ...(ALIASES[normalise(city)] ?? [])].filter(Boolean).map((x) => normalise(x!));
  return names.some((n) => n.length >= 3 && t.includes(` ${n} `));
}
const ALIASES: Record<string, string[]> = {
  vadodara: ["baroda"], mumbai: ["bombay"], bengaluru: ["bangalore"], bangalore: ["bengaluru"], chennai: ["madras"], kolkata: ["calcutta"],
  pune: ["poona"], gurugram: ["gurgaon"], gurgaon: ["gurugram"], kochi: ["cochin"], thiruvananthapuram: ["trivandrum"], mysuru: ["mysore"],
};

/** Pull a business name from a page title: "Shree Furniture | Best Sofa Shop in Vadodara" → "Shree Furniture". */
export function nameFromPageTitle(title: string, domain: string): string {
  const parts = title.split(/\s[|–—:·•-]\s|\s\|\s?/).map((x) => x.trim()).filter(Boolean);
  // Prefer the part that looks like a name (overlaps the domain), else the shortest non-generic part.
  const label = domain.replace(/^www\./, "").split(".")[0].replace(/[^a-z0-9]/g, "");
  const scored = parts
    .filter((p) => p.length >= 3 && p.length <= 70 && !/^(home|welcome|homepage|contact us|about us)$/i.test(p))
    .map((p) => {
      const sq = p.toLowerCase().replace(/[^a-z0-9]/g, "");
      const overlap = significantTokens(p).filter((t) => label.includes(t)).length + (label.includes(sq) || sq.includes(label) ? 2 : 0);
      return { p, overlap, generic: /\b(best|top|buy|online|near me|in [a-z]+$|shop in|price)\b/i.test(p) };
    })
    .sort((a, b) => b.overlap - a.overlap || Number(a.generic) - Number(b.generic) || a.p.length - b.p.length);
  const pick = scored[0]?.p;
  if (pick) return pick.replace(/^welcome to\s+/i, "").slice(0, 80);
  return label.replace(/(\d+)/g, " $1").trim() || domain;
}

export interface WebLeadDeps {
  search: (q: string) => Promise<SearchHit[]>;
  fetchHtml?: (url: string) => Promise<{ html: string; finalUrl: string } | null>;
}

async function defaultFetch(url: string) {
  try {
    const r = await fetchPublic(url, { headers: { Accept: "text/html" } }, 8000);
    if (!r.ok || !(r.headers.get("content-type") || "").includes("html")) return null;
    return { html: (await r.text()).slice(0, 800_000), finalUrl: r.url || url };
  } catch {
    return null;
  }
}

export interface WebLeadResult {
  places: RawPlace[];
  queries: number;
  rejected: Array<{ domain: string; why: string }>;
}

export async function webLeadSearch(
  opts: { term: string; place: string; city: string; area?: string; category: string; max: number },
  deps: WebLeadDeps,
): Promise<WebLeadResult> {
  const get = deps.fetchHtml ?? defaultFetch;
  const rejected: WebLeadResult["rejected"] = [];
  const seen = new Set<string>();
  const candidates: Array<{ domain: string; url: string; hit: SearchHit }> = [];
  let queries = 0;

  for (const q of webQueries(opts.term, opts.place)) {
    let hits: SearchHit[] = [];
    try {
      hits = await deps.search(q);
      queries++;
    } catch (e) {
      if (!candidates.length) throw e; // nothing at all → let the pipeline report it
      break;
    }
    for (const h of hits) {
      const d = domainOf(h.url);
      if (!d || seen.has(d)) continue;
      seen.add(d);
      if (isDirectory(d) || d.endsWith("justdial.com") || d.endsWith("sulekha.com")) { rejected.push({ domain: d, why: "listing site" }); continue; }
      if (isSocialHost(d)) continue; // Instagram/Facebook have their own source
      if (isNational(d)) { rejected.push({ domain: d, why: "national store or news site" }); continue; }
      candidates.push({ domain: d, url: h.url, hit: h });
    }
  }

  // Check each site's homepage: must be local and not a chain.
  const places: RawPlace[] = [];
  for (const c of candidates) {
    if (places.length >= opts.max) break;
    const home = `https://${c.domain}/`;
    const page = (await get(home)) ?? (await get(`http://${c.domain}/`)) ?? (await get(c.url));
    if (!page) { rejected.push({ domain: c.domain, why: "site didn't load" }); continue; }
    const $ = cheerio.load(page.html);
    const text = $("body").text().replace(/\s+/g, " ").slice(0, 300_000);
    const title = ($('meta[property="og:site_name"]').attr("content") || $("title").first().text() || c.hit.title).trim();
    if (!mentionsPlace(`${title} ${text} ${c.hit.snippet ?? ""}`, opts.city, opts.area)) {
      rejected.push({ domain: c.domain, why: `doesn't mention ${opts.city}` });
      continue;
    }
    if (CHAIN_WORDS.test(text)) { rejected.push({ domain: c.domain, why: "chain or franchise" }); continue; }
    const phone = [...$('a[href^="tel:"]').map((_, a) => $(a).attr("href")!.replace(/^tel:/i, "")).get(), ...(text.match(/(?:\+91[\s-]?|0)?[6-9]\d{4}[\s-]?\d{5}/g) ?? [])]
      .map((p) => normalizePhone(p))
      .find(Boolean);
    places.push({
      source: "web",
      sourceId: c.domain,
      name: nameFromPageTitle(title, c.domain),
      category: opts.category,
      city: opts.city,
      website: page.finalUrl || home,
      phone,
    });
  }
  return { places, queries, rejected };
}

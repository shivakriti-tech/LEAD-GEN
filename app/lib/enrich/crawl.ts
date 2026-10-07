import * as cheerio from "cheerio";
import type { TradeHints, WebsiteAudit, GrowthHints, TechHints, SiteFacts } from "../types";
import { mergeTech, techHints } from "./tech";
import { mergeFacts, siteFacts } from "./facts";
import { fetchPublic } from "../safeFetch";
import { domainOf, isMobile, isSocialHost, normalizePhone, phonesInText } from "../util";
import { currentCountry } from "../marketContext";

const FREE_BUILDERS: Array<[RegExp, string]> = [
  [/\.wixsite\.com$/, "Wix free site"],
  [/\.blogspot\.[a-z.]+$/, "Blogspot"],
  [/\.business\.site$/, "Google Business Site"],
  [/\.wordpress\.com$/, "WordPress.com free site"],
  [/\.weebly\.com$/, "Weebly free site"],
  [/\.godaddysites\.com$/, "GoDaddy builder"],
  [/\.webnode\.[a-z.]+$/, "Webnode free site"],
  [/\.site123\.me$/, "Site123 free site"],
  [/\.mystrikingly\.com$/, "Strikingly free site"],
  [/\.carrd\.co$/, "Carrd"],
  [/\.web\.app$|\.firebaseapp\.com$/, "Firebase subdomain"],
  [/\.netlify\.app$|\.vercel\.app$|\.github\.io$/, "Free hosting subdomain"],
];

const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;
const BAD_EMAIL = /\.(png|jpe?g|gif|webp|svg|css|js)$|@(example|sentry|wixpress|domain|placeholder|test|localhost|email)\.|^(u003e|x22|noreply|no-reply|donotreply|do-not-reply|mailer-daemon|postmaster|admin@wix|wordpress@|support@wordpress)/i;
/** Indian mobiles: +91/0 then 6-9 then 9 digits. */
const IN_MOBILE_RE = /(?:\+91[\s-]?|0)?[6-9]\d{4}[\s-]?\d{5}/g;
/** Indian landlines: STD code (0XX to 0XXXX) + local number. E.g. 020-25551234, 0124-4567890. */
const IN_LANDLINE_RE = /0[2-8]\d{1,3}[\s-]?\d{6,8}/g;

/** Parse a year from a date-like string. */
function parseYearFromString(s: string): number | undefined {
  const m = s.match(/(\d{4})/);
  if (!m) return undefined;
  const y = Number(m[1]);
  const now = new Date().getFullYear();
  return y >= 1950 && y <= now ? y : undefined;
}

export function emptyAudit(status: WebsiteAudit["status"], extra: Partial<WebsiteAudit> = {}): WebsiteAudit {
  return { status, emails: [], phones: [], socials: {}, ...extra };
}

/** schema.org founder/owner: "Dr. Mehta", {"name": "Dr. Mehta"} or a list of them. */
function personName(v: unknown): string | undefined {
  const x = Array.isArray(v) ? v[0] : v;
  const n = typeof x === "string" ? x : x && typeof x === "object" && typeof (x as { name?: unknown }).name === "string" ? (x as { name: string }).name : undefined;
  const t = n?.replace(/\s+/g, " ").trim();
  return t && t.length >= 3 && t.length <= 60 ? t : undefined;
}

const COUNTRIES = ["USA", "United States", "UK", "United Kingdom", "UAE", "Dubai", "Saudi", "Qatar", "Oman", "Kuwait", "Bahrain", "Europe", "Germany", "France", "Italy", "Spain", "Netherlands", "Africa", "Kenya", "Nigeria", "Egypt", "Australia", "Canada", "Singapore", "Malaysia", "Bangladesh", "Nepal", "Sri Lanka", "China", "Japan", "Korea", "Brazil", "Mexico", "Russia", "Turkey", "Vietnam", "Indonesia", "Thailand"];
const B2B: Array<[RegExp, string]> = [[/indiamart\.com$/, "IndiaMart"], [/tradeindia\.com$/, "TradeIndia"], [/exportersindia\.com$/, "ExportersIndia"], [/alibaba\.com$/, "Alibaba"], [/justdial\.com$/, "Justdial"]];
const SHOPS = /(^|\.)(amazon\.in|amazon\.com|flipkart\.com|meesho\.com|myntra\.com|ajio\.com|etsy\.com|nykaa\.com)$/;

/** What a page says about moving goods. Pure, exported for tests. */
export function tradeHints(text: string, hosts: string[], html = ""): TradeHints {
  const t = text.slice(0, 400_000);
  const countries = COUNTRIES.filter((c) => new RegExp(`\\b${c}\\b`).test(t));
  const b2b = [...new Set(hosts.flatMap((h) => B2B.filter(([re]) => re.test(h)).map(([, n]) => n)))];
  const out: TradeHints = {
    exports: /\b(export(s|er|ers|ing|ed)?|worldwide|overseas (buyers|clients|markets)|international (buyers|clients|markets))\b/i.test(t),
    imports: /\b(import(s|er|ers|ing|ed)?)\b(?! (your|our) (contacts|data|file))/i.test(t),
    iec: /\b(IEC\s*(no|code|number)?|import[- ]export code)\b/i.test(t),
    countries: countries.length ? [...new Set(countries.map((c) => (c === "United States" ? "USA" : c === "United Kingdom" ? "UK" : c)))] : undefined,
    panIndia: /\b(pan[- ]india|all over india|across india|all india|nationwide|throughout india|across the country)\b/i.test(t),
    sellsOnline: /\b(add to cart|buy now|shop now|checkout|free shipping|cash on delivery|cod available)\b/i.test(t) || hosts.some((h) => SHOPS.test(h)) || /cdn\.shopify\.com|woocommerce/i.test(html),
    b2b: b2b.length ? b2b : undefined,
    manufactures: /\b(manufactur(e|er|ers|ing)|factory|production (unit|capacity|plant)|plant capacity|our plant)\b/i.test(t),
    dealers: /\b(dealer(s|ship)?|distributor(s|ship)?) (network|across|in \d+|enquiry)|become (a|our) (dealer|distributor)/i.test(t),
  };
  return Object.fromEntries(Object.entries(out).filter(([, v]) => v !== false && v !== undefined)) as TradeHints;
}

/**
 * Growth clues on a page, with the words that showed them. A plain "Careers" link doesn't count
 * (almost every company has one); open roles, "we're hiring" or a walk-in interview do.
 */
export function growthHints(text: string): GrowthHints {
  const t = text.slice(0, 400_000);
  const find = (re: RegExp) => t.match(re)?.[0].replace(/\s+/g, " ").trim();
  const out: GrowthHints = {
    hiring: find(/\b(we('re| are) hiring|now hiring|hiring now|current (job )?openings|job openings|open positions|vacanc(y|ies)|walk[- ]in interview|urgent(ly)? (required|hiring)|apply now for)\b/i),
    opened: find(/\b(newly opened|grand opening|now open(ed)?(?! (in|at) )|just opened|recently opened|opening soon|opened (in|on) (january|february|march|april|may|june|july|august|september|october|november|december) 20\d\d|inaugurat(ed|ion) (of|on))\b/i),
    expanding: find(/\b(new (branch|outlet|showroom|store|clinic|centre|center|office|facility|plant|unit|warehouse|factory)( (opened|opening|at|in))?|second (branch|outlet|unit|plant|showroom|store|clinic)|now (open|serving) (in|at) [A-Z][a-z]+|expanding (to|into|our)|coming soon (to|in|at) [A-Z][a-z]+|opened (our|a) (new|second|third))\b/i),
  };
  return Object.fromEntries(Object.entries(out).filter(([, v]) => v)) as GrowthHints;
}

/** Pure HTML parser: everything we can learn from one page. Exported for tests. */
export function parsePage(html: string, pageUrl: string) {
  const $ = cheerio.load(html);
  const text = $("body").text().replace(/\s+/g, " ");
  const emails = new Set<string>();
  const phones = new Set<string>();
  const socials: Record<string, string> = {};
  let whatsapp: string | undefined;
  let extractedFoundingYear: number | undefined;
  let ownerName: string | undefined;

  // --- Emails ---
  // 1. mailto: links
  $('a[href^="mailto:"]').each((_, a) => {
    const e = ($(a).attr("href") || "").replace(/^mailto:/i, "").split("?")[0].trim().toLowerCase();
    if (e && !BAD_EMAIL.test(e)) emails.add(e);
  });
  // 2. Emails in body text
  for (const m of text.match(EMAIL_RE) ?? []) if (!BAD_EMAIL.test(m)) emails.add(m.toLowerCase());
  // 3. Emails from JSON-LD structured data
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const ld = JSON.parse($(el).html() || "");
      const top = Array.isArray(ld) ? ld : [ld];
      const items = top.flatMap((x) => (Array.isArray(x?.["@graph"]) ? [x, ...x["@graph"]] : [x]));
      for (const item of items) {
        if (!item || typeof item !== "object") continue;
        ownerName ??= personName(item.founder) ?? personName(item.owner);
        if (item.email && !BAD_EMAIL.test(String(item.email))) emails.add(String(item.email).toLowerCase());
        if (item.telephone) { const p = normalizePhone(String(item.telephone), currentCountry()); if (p) phones.add(p); }
        if (item.foundingDate) extractedFoundingYear = extractedFoundingYear ?? parseYearFromString(String(item.foundingDate));
      }
    } catch {}
  });
  // 4. Emails from meta tags
  const ogEmail = $('meta[property="og:email"]').attr("content") || $('meta[name="email"]').attr("content") || "";
  if (ogEmail && !BAD_EMAIL.test(ogEmail)) emails.add(ogEmail.trim().toLowerCase());
  // 5. Emails from schema.org itemProp
  $('[itemprop="email"]').each((_, el) => {
    const e = ($(el).attr("content") || $(el).text() || "").trim().toLowerCase();
    if (e && /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(e) && !BAD_EMAIL.test(e)) emails.add(e);
  });

  // --- Phones ---
  // 1. tel: links
  $('a[href^="tel:"]').each((_, a) => {
    const p = normalizePhone(($(a).attr("href") || "").replace(/^tel:/i, ""), currentCountry());
    if (p) phones.add(p);
  });
  // 2. schema.org itemProp telephone
  $('[itemprop="telephone"]').each((_, el) => {
    const p = normalizePhone($(el).attr("content") || $(el).text() || "", currentCountry());
    if (p) phones.add(p);
  });
  // 3. Numbers written in the text: other countries' formats through libphonenumber
  if (currentCountry() !== "IN") for (const p of phonesInText(text, currentCountry())) phones.add(p);
  // Indian mobile numbers in text
  for (const m of currentCountry() === "IN" ? text.match(IN_MOBILE_RE) ?? [] : []) {
    const p = normalizePhone(m);
    if (p) phones.add(p);
  }
  // 4. Landline numbers in text
  for (const m of currentCountry() === "IN" ? text.match(IN_LANDLINE_RE) ?? [] : []) {
    const p = normalizePhone(m);
    if (p) phones.add(p);
  }

  // --- WhatsApp ---
  // 1. wa.me and api.whatsapp.com links
  $("a[href]").each((_, a) => {
    const href = $(a).attr("href") || "";
    let u: URL;
    try {
      u = new URL(href, pageUrl);
    } catch {
      return;
    }
    const h = u.hostname.replace(/^www\./, "");
    if (!whatsapp && (h === "wa.me" || h === "api.whatsapp.com")) {
      const num = h === "wa.me" ? u.pathname.slice(1).split("?")[0] : u.searchParams.get("phone") || "";
      whatsapp = normalizePhone(num, currentCountry()) ?? undefined;
    }
    // whatsapp:// protocol links
    if (!whatsapp && /^whatsapp:/i.test(href)) {
      const phoneParam = href.match(/phone=(\d+)/)?.[1] || href.match(/send\?phone=(\d+)/)?.[1];
      if (phoneParam) whatsapp = normalizePhone(phoneParam, currentCountry()) ?? undefined;
    }
    for (const [k, host] of [["instagram", "instagram.com"], ["facebook", "facebook.com"], ["linkedin", "linkedin.com"], ["youtube", "youtube.com"], ["x", "x.com"], ["twitter", "twitter.com"]] as const) {
      if (!socials[k] && (h === host || h.endsWith("." + host)) && u.pathname.length > 1) socials[k] = u.toString();
    }
  });
  // 2. WhatsApp chat widget scripts (WATI, Interakt, AiSensy, Gallabox, generic WhatsApp Business)
  if (!whatsapp) {
    const allHtml = html.slice(0, 600_000);
    const waWidgetPatterns = [
      /(?:wati|interakt|aisensy|gallabox|whatsapp)[^}]{0,300}?["']?(\+?91[\d\s-]{10,14}|[6-9]\d{9})["']?/gi,
      /data-(?:wa-number|phone|whatsapp)=["']\s*(\+?91[\d\s-]{10,14}|[6-9]\d{9})/gi,
      /WhatsApp[^<]{0,100}?(?:href=["'][^"']*?(\+?91[\d\s-]{10,14}|[6-9]\d{9}))/gi,
    ];
    for (const re of waWidgetPatterns) {
      for (const m of allHtml.matchAll(re)) {
        const candidate = normalizePhone(m[1], currentCountry());
        if (candidate && isMobile(candidate)) { whatsapp = candidate; break; }
      }
      if (whatsapp) break;
    }
  }

  // --- Page metadata ---
  const mobileViewport = $('meta[name="viewport"]').length > 0;
  const generator = ($('meta[name="generator"]').attr("content") || "").trim();
  const yearMatches = [...html.matchAll(/(?:©|&copy;|copyright)\s*(?:\d{4}\s*[-–]\s*)?(\d{4})/gi)].map((m) => Number(m[1]));
  const nowYear = new Date().getFullYear();
  const copyrightYear = yearMatches.filter((y) => y >= 1995 && y <= nowYear + 1).sort((a, b) => b - a)[0];

  // --- Founding year from text patterns ---
  if (!extractedFoundingYear) {
    const foundingPatterns = [...text.matchAll(/(?:established|founded|since|est\.?|started)\s*(?:in\s+)?(\d{4})/gi)];
    for (const m of foundingPatterns) {
      const y = Number(m[1]);
      if (y >= 1950 && y <= nowYear) { extractedFoundingYear = y; break; }
    }
  }

  // --- Contact/about page links, and the careers page (job ads show manual work to automate) ---
  const contactLinks: string[] = [];
  let careersLink: string | undefined;
  $("a[href]").each((_, a) => {
    const href = $(a).attr("href") || "";
    const label = ($(a).text() || "").toLowerCase();
    if (!careersLink && /career|jobs|join[- ]?(us|our)|openings|vacanc/.test(href.toLowerCase() + " " + label)) {
      try {
        const u = new URL(href, pageUrl);
        if (u.hostname === new URL(pageUrl).hostname) careersLink = u.toString();
      } catch {}
    }
    if (/contact|about|reach|location/.test(href.toLowerCase() + " " + label)) {
      try {
        const u = new URL(href, pageUrl);
        if (u.hostname === new URL(pageUrl).hostname && !contactLinks.includes(u.toString())) contactLinks.push(u.toString());
      } catch {}
    }
  });

  // --- Builder detection ---
  let builder: string | undefined;
  if (/wix\.com/i.test(generator) || /static\.wixstatic\.com/.test(html)) builder = "Wix";
  else if (/wordpress/i.test(generator) || /wp-content\//.test(html)) builder = "WordPress";
  else if (/shopify/i.test(html) && /cdn\.shopify\.com/.test(html)) builder = "Shopify";
  else if (/squarespace/i.test(generator)) builder = "Squarespace";
  else if (generator) builder = generator.split(" ")[0];

  // --- Agency/designer credit detection ---
  let designedBy: string | undefined;
  // 1. Footer "Designed by" / "Developed by" / "Built by" credits
  const actualFooter = $("footer").html() || $("#footer").html() || $(".footer").html() || $('[role="contentinfo"]').html() || "";
  const creditPatterns = /(?:designed|developed|built|crafted|created|powered)\s+by\s+([^<.]{2,60})/gi;
  for (const m of actualFooter.matchAll(creditPatterns)) {
    const credit = m[1].replace(/<[^>]*>/g, "").trim();
    if (credit.length >= 3 && credit.length <= 60 && !/wix|wordpress|shopify|squarespace|godaddy|google/i.test(credit)) {
      designedBy = credit;
      break;
    }
  }
  // 2. HTML comments for agency signatures
  if (!designedBy) {
    const commentCredits = html.match(/<!--\s*(?:designed|developed|built|created)\s+by\s+([^-]{2,60})\s*-->/i);
    if (commentCredits) designedBy = commentCredits[1].trim();
  }
  // 3. Meta tags
  if (!designedBy) {
    const authorMeta = $('meta[name="author"]').attr("content") || $('meta[name="designer"]').attr("content") || "";
    if (authorMeta && !/wix|wordpress|shopify|squarespace/i.test(authorMeta)) {
      designedBy = authorMeta;
    }
  }

  // --- Sort phones: mobiles first (better for WhatsApp outreach) ---
  const sortedPhones = [...phones].sort((a, b) => Number(isMobile(b)) - Number(isMobile(a)));

  const hosts: string[] = [];
  $("a[href]").each((_, a) => {
    try {
      hosts.push(new URL($(a).attr("href") || "", pageUrl).hostname.replace(/^www\./, ""));
    } catch {}
  });
  const trade = tradeHints(text, [...new Set(hosts)], html.slice(0, 300_000));
  const growth = growthHints(text);
  const tech = techHints(html, text, [...new Set(hosts)]);
  const facts = siteFacts(text, [...new Set(hosts)]);

  return { emails: [...emails], phones: sortedPhones, socials, whatsapp, mobileViewport, copyrightYear, builder, contactLinks: contactLinks.slice(0, 2), careersLink, foundedYear: extractedFoundingYear, designedBy, ownerName, trade, growth, tech, facts };
}

/** Load a business website and audit it. Never throws. */
export async function auditWebsite(website?: string): Promise<WebsiteAudit> {
  if (!website) return emptyAudit("none");
  const url = website.startsWith("http") ? website : `http://${website}`;
  const domain = domainOf(url);
  if (isSocialHost(domain)) {
    const socials: Record<string, string> = {};
    const key = domain!.split(".").slice(-2, -1)[0];
    socials[key] = url;
    return emptyAudit("social_only", { checkedUrl: url, socials });
  }

  let res: Response;
  try {
    res = await fetchPublic(url, { headers: { Accept: "text/html" } }, 12_000);
  } catch (e) {
    return emptyAudit("down", { checkedUrl: url, error: e instanceof Error ? (e.name === "AbortError" ? "Timed out after 12s" : e.message) : "Failed" });
  }
  const finalUrl = res.url || url;
  if (res.status >= 400) {
    return emptyAudit("down", { checkedUrl: url, finalUrl, httpStatus: res.status, error: `HTTP ${res.status}` });
  }
  const ct = res.headers.get("content-type") || "";
  if (!ct.includes("html")) return emptyAudit("ok", { checkedUrl: url, finalUrl, httpStatus: res.status, https: finalUrl.startsWith("https:") });

  const html = (await res.text()).slice(0, 1_500_000);
  const first = parsePage(html, finalUrl);
  const emails = new Set(first.emails);
  const phones = new Set(first.phones);
  const socials = { ...first.socials };
  let whatsapp = first.whatsapp;
  let foundedYear = first.foundedYear;
  let designedBy = first.designedBy;
  let ownerName = first.ownerName;
  const trade: TradeHints = { ...first.trade };
  const growth: GrowthHints = { ...first.growth };
  const tech: TechHints = { ...first.tech };
  const facts: SiteFacts = { ...first.facts };

  // look at up to 2 contact/about pages for more contacts; outside India also the careers page
  const more = [...first.contactLinks, ...(currentCountry() !== "IN" && first.careersLink && !first.contactLinks.includes(first.careersLink) ? [first.careersLink] : [])];
  for (const link of more) {
    try {
      const r = await fetchPublic(link, { headers: { Accept: "text/html" } }, 8_000);
      if (!r.ok || !(r.headers.get("content-type") || "").includes("html")) continue;
      const p = parsePage((await r.text()).slice(0, 800_000), link);
      p.emails.forEach((e) => emails.add(e));
      p.phones.forEach((x) => phones.add(x));
      Object.entries(p.socials).forEach(([k, v]) => (socials[k] ??= v));
      whatsapp ??= p.whatsapp;
      foundedYear ??= p.foundedYear;
      designedBy ??= p.designedBy;
      ownerName ??= p.ownerName;
      mergeTrade(trade, p.trade);
      for (const [k, v] of Object.entries(p.growth) as Array<[keyof GrowthHints, string]>) growth[k] ??= v;
      mergeTech(tech, p.tech);
      mergeFacts(facts, p.facts);
    } catch {}
  }

  const finalDomain = domainOf(finalUrl) || "";
  const free = FREE_BUILDERS.find(([re]) => re.test(finalDomain));
  // looks like a parked / placeholder page?
  const parked = /domain (is )?for sale|buy this domain|parked free|coming soon|under construction|account suspended/i.test(html.slice(0, 50_000)) && html.length < 60_000;

  // Prefer emails on the business's own domain, then gmail/outlook, then the rest
  const sortedEmails = [...emails].sort((a, b) => {
    const aOwn = a.endsWith("@" + finalDomain) ? 2 : 0;
    const bOwn = b.endsWith("@" + finalDomain) ? 2 : 0;
    if (aOwn !== bOwn) return bOwn - aOwn;
    // Prefer personal emails (gmail, outlook, yahoo) over info@ / contact@
    const aGeneric = /^(info|contact|enquiry|inquiry|hello|admin|support|sales|office)@/i.test(a) ? 0 : 1;
    const bGeneric = /^(info|contact|enquiry|inquiry|hello|admin|support|sales|office)@/i.test(b) ? 0 : 1;
    return bGeneric - aGeneric;
  });
  // Sort phones: mobiles first
  const sortedPhones = [...phones].sort((a, b) => Number(isMobile(b)) - Number(isMobile(a)));

  return {
    checkedUrl: url,
    finalUrl,
    status: parked ? "down" : "ok",
    httpStatus: res.status,
    https: finalUrl.startsWith("https:"),
    mobileViewport: first.mobileViewport,
    copyrightYear: first.copyrightYear,
    builder: free ? free[1] : first.builder,
    freeSubdomain: !!free,
    emails: sortedEmails.slice(0, 5),
    phones: sortedPhones.slice(0, 5),
    whatsapp,
    socials,
    error: parked ? "Parked or placeholder page" : undefined,
    foundedYear,
    designedBy,
    ownerName,
    trade: Object.keys(trade).length ? trade : undefined,
    growth: Object.keys(growth).length ? growth : undefined,
    tech: Object.keys(tech).length ? tech : undefined,
    facts: Object.keys(facts).length ? facts : undefined,
  };
}

function mergeTrade(into: TradeHints, more: TradeHints) {
  for (const [k, v] of Object.entries(more) as Array<[keyof TradeHints, TradeHints[keyof TradeHints]]>) {
    if (Array.isArray(v)) (into as Record<string, unknown>)[k] = [...new Set([...((into[k] as string[] | undefined) ?? []), ...v])];
    else if (v) (into as Record<string, unknown>)[k] = true;
  }
}

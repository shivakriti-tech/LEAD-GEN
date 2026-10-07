import * as cheerio from "cheerio";
import { z } from "zod";
import { fetchPublic } from "./safeFetch";
import { parsePage } from "./enrich/crawl";
import { CATEGORIES, categoriesFor } from "./categories";
import { isNiche, NICHE_KEYS } from "./niches";
import { CITY_CENTRES } from "./sources/cityCentres";
import { ALL_SERVICES } from "./score/logistics";
import { parseBrain, type BrainInput } from "./brain";
import type { LogisticsService, NicheKey, Offer } from "./types";

/**
 * Onboarding: read a client's website and draft their Business Brain for you to review.
 * With ANTHROPIC_API_KEY, Claude reads the pages (and only states what they say); without it, a
 * rule-based reader drafts from titles, headings and ₹ amounts. Either way nothing is saved until
 * you've checked it.
 */

export interface SitePage {
  url: string;
  title: string;
  headings: string[];
  text: string;
}
export interface ClientSite {
  url: string;
  pages: SitePage[];
  siteName?: string;
  description?: string;
  emails: string[];
  phones: string[];
}

const PAGE_HINT = /servic|solution|pricing|price|package|plan|product|offer|what-we-do|rates|tariff|about|contact|work|portfolio|industr|capabilit/i;
const MAX_PAGES = 9; // the home page and up to 8 more
const PAGE_CHARS = 15_000;

function readPage(html: string, url: string): SitePage & { links: string[]; siteName?: string; description?: string } {
  const $ = cheerio.load(html);
  const siteName = $('meta[property="og:site_name"]').attr("content")?.trim();
  const description = ($('meta[name="description"]').attr("content") || $('meta[property="og:description"]').attr("content") || "").trim() || undefined;
  const title = $("title").first().text().replace(/\s+/g, " ").trim();
  const headings = $("h1, h2, h3").map((_, h) => $(h).text().replace(/\s+/g, " ").trim()).get().filter((h) => h && h.length <= 120);
  const host = new URL(url).hostname;
  const links: string[] = [];
  $("a[href]").each((_, a) => {
    try {
      const u = new URL($(a).attr("href") || "", url);
      u.hash = "";
      const label = $(a).text().trim();
      if (u.hostname === host && /^https?:$/.test(u.protocol) && PAGE_HINT.test(`${u.pathname} ${label}`) && !/\.(pdf|jpe?g|png|zip)$/i.test(u.pathname)) links.push(u.toString());
    } catch {}
  });
  $("script, style, noscript, svg").remove();
  const text = $("body").text().replace(/\s+/g, " ").trim().slice(0, PAGE_CHARS);
  return { url, title, headings: [...new Set(headings)].slice(0, 60), text, links: [...new Set(links)], siteName, description };
}

/** The client's home page plus the pages most likely to describe services, prices and the company. */
export async function readClientSite(website: string, f: typeof fetchPublic = fetchPublic): Promise<ClientSite> {
  const start = /^https?:\/\//i.test(website) ? website : `https://${website}`;
  const get = async (u: string) => {
    const r = await f(u, { headers: { Accept: "text/html" } }, 12_000);
    if (!r.ok || !(r.headers.get("content-type") || "").includes("html")) throw new Error(`${u}: HTTP ${r.status}`);
    return { html: (await r.text()).slice(0, 1_500_000), url: r.url || u };
  };
  const home = await get(start).catch(async (e) => (start.startsWith("https://") ? get(start.replace("https://", "http://")) : Promise.reject(e)));
  const first = readPage(home.html, home.url);
  const contacts = parsePage(home.html, home.url);
  const pages: SitePage[] = [{ url: first.url, title: first.title, headings: first.headings, text: first.text }];
  const emails = new Set(contacts.emails), phones = new Set(contacts.phones);
  // pricing and service pages first
  const rank = (u: string) => (/pric|package|plan|tariff|rates/i.test(u) ? 0 : /servic|solution|product|offer|what-we-do/i.test(u) ? 1 : 2);
  const next = first.links.filter((u) => u.replace(/\/$/, "") !== first.url.replace(/\/$/, "")).sort((a, b) => rank(a) - rank(b)).slice(0, MAX_PAGES - 1);
  for (const u of next) {
    try {
      const p = await get(u);
      const page = readPage(p.html, p.url);
      pages.push({ url: page.url, title: page.title, headings: page.headings, text: page.text });
      const c = parsePage(p.html, p.url);
      c.emails.forEach((e) => emails.add(e));
      c.phones.forEach((x) => phones.add(x));
    } catch {}
  }
  return { url: first.url, pages, siteName: first.siteName, description: first.description, emails: [...emails], phones: [...phones] };
}

/* ---------- rule-based draft (no AI key) ---------- */

const GENERIC_HEADING = /^(home|about( us)?|contact( us)?|our (team|clients|story|mission|vision)|testimonials?|reviews|faq|blog|news|gallery|careers?|why (choose )?us|get in touch|follow us|quick links|useful links|menu|welcome.*|copyright.*|privacy.*|terms.*|we are.*|let'?s talk.*|subscribe.*|newsletter)$/i;
const LOGISTICS_WORDS = /\b(logistics|freight|forwarding|customs|clearance|cargo|shipping|icegate|dgft|warehous|transport|courier|CHA)\b/gi;
const WEB_WORDS = /\b(website|web design|web development|seo|digital marketing|e-?commerce|app development|landing page|wordpress|shopify)\b/gi;
/** Words that show the client sells one of the niches (lib/niches.ts). */
const NICHE_WORDS: Record<NicheKey, RegExp> = {
  marketing: /\b(digital marketing|social media (marketing|management)|google ads|meta ads|facebook ads|performance marketing|local seo|google (business profile|my business)|lead generation|branding)\b/gi,
  solar: /\b(solar|rooftop|photovoltaic|on-?grid|off-?grid|net metering|kwp|inverter|renewable)\b/gi,
  accounting: /\b(chartered accountant|gst (filing|return|registration)|income tax|tds|bookkeeping|accounting|audit|roc (filing|compliance)|company registration|payroll)\b/gi,
  staffing: /\b(recruitment|staffing|manpower|placement|hiring solutions|talent acquisition|contract staff|executive search)\b/gi,
  insurance: /\b(insurance|marine cargo|fire policy|group health|liability cover|insurer|claims settlement|policy renewal)\b/gi,
};

/** What the client sells, from the words on its site: logistics, a niche, or websites. */
export function offerFromWords(all: string): Exclude<Offer, "agency"> {
  const count = (re: RegExp) => all.match(re)?.length ?? 0;
  const logisticsHits = count(LOGISTICS_WORDS), webHits = count(WEB_WORDS);
  const [niche, nicheHits] = (Object.entries(NICHE_WORDS) as Array<[NicheKey, RegExp]>).map(([k, re]) => [k, count(re)] as const).sort((a, b) => b[1] - a[1])[0];
  if (nicheHits >= 3 && nicheHits > logisticsHits && nicheHits > webHits) return niche;
  return logisticsHits > webHits ? "logistics" : "website_development";
}

const LOGISTICS_MATCH: Array<[RegExp, LogisticsService]> = [
  [/custom/i, "customs"], [/document/i, "documentation"], [/dgft|iec|licen[cs]e/i, "dgft"], [/icegate|shipping bill|bill of entry/i, "icegate"],
  [/sea|ocean|fcl|lcl|container/i, "sea"], [/road|truck|transport|ftl|ptl/i, "freight"], [/import/i, "imports"], [/export|forward/i, "forwarding"],
  [/courier|parcel|express/i, "courier"], [/warehous|storage/i, "warehousing"],
];
export const logisticsKeyFor = (name: string): LogisticsService | undefined => LOGISTICS_MATCH.find(([re]) => re.test(name))?.[1];

/** ₹ amounts with the words just before them: [{ price: "₹9,999", before: "basic website package" }]. */
export function pricesIn(text: string): Array<{ price: string; before: string }> {
  const out: Array<{ price: string; before: string }> = [];
  for (const m of text.matchAll(/((?:starting|starts|from|only|@)\s*)?(₹|rs\.?|inr)\s?\d[\d,]*(?:\.\d+)?\s*(?:\/-)?\s*(?:k\b|lakh|lac)?(?:\s*(?:\/|per)\s*(?:month|mo|year|yr|kg|cbm|container|shipment|page|hour))?/gi)) {
    const i = m.index ?? 0;
    out.push({ price: m[0].replace(/\s+/g, " ").trim(), before: text.slice(Math.max(0, i - 80), i).replace(/\s+/g, " ").trim() });
  }
  return out.slice(0, 40);
}

export function draftFromRules(site: ClientSite, hint: { name?: string } = {}): BrainInput {
  const all = site.pages.map((p) => p.text).join(" ");
  const offer = offerFromWords(all);
  const domain = new URL(site.url).hostname.replace(/^www\./, "");
  const name = hint.name?.trim() || site.siteName || site.pages[0]?.title.split(/\s[|\-–—:]\s/)[0]?.trim() || domain;
  // services: short headings on service/pricing pages (or the home page)
  const servicePages = site.pages.filter((p, i) => i === 0 || /servic|solution|pric|package|product|offer/i.test(p.url));
  const seen = new Set<string>();
  const names = servicePages
    .flatMap((p) => p.headings)
    .filter((h) => {
      const w = h.split(/\s+/).length, k = h.toLowerCase();
      if (w < 1 || w > 7 || GENERIC_HEADING.test(h) || /[?!]$/.test(h) || seen.has(k) || k === name.toLowerCase()) return false;
      seen.add(k);
      return offer === "logistics" ? !!logisticsKeyFor(h) || /service/i.test(h) : isNiche(offer) ? new RegExp(NICHE_WORDS[offer].source, "i").test(h) || /service|plan|package/i.test(h) : /web|site|seo|design|develop|app|market|ecommerce|e-commerce|package|plan|hosting|brand|social/i.test(h);
    })
    .slice(0, 15);
  const prices = pricesIn(servicePages.map((p) => p.text).join(" "));
  const services = names.map((n) => {
    const p = prices.find((x) => x.before.toLowerCase().includes(n.toLowerCase().split(/\s+/).slice(0, 2).join(" ")));
    return { name: n, price: p?.price, logistics: offer === "logistics" ? logisticsKeyFor(n) : undefined };
  });
  const where = `${site.pages.map((p) => p.title).join(" ")} ${site.description ?? ""} ${all}`;
  const city = CITY_CENTRES.flatMap((c) => c.names).find((n) => new RegExp(`\\b${n}\\b`, "i").test(where));
  const proof = [...new Set((all.match(/[^.!?]{0,80}\b(\d{2,}\+?\s*(years|clients|projects|websites|shipments|containers|customers)|ISO \d{4,5}|certified|licensed customs broker|AEO)\b[^.!?]{0,60}/gi) ?? []).map((x) => x.trim()))].slice(0, 5);
  return {
    name: name.slice(0, 120),
    website: site.url,
    city: city ? city.replace(/\b\w/g, (c) => c.toUpperCase()) : undefined,
    phone: site.phones[0],
    email: site.emails[0],
    offer,
    summary: site.description?.slice(0, 400),
    services,
    audience: { categories: [], areas: [] },
    usps: [],
    proof,
    rules: {
      dos: ["Keep the first message short and mention one thing you noticed about their business"],
      donts: ["Don't promise results you can't control", "No more than two follow-ups"],
      bannedPhrases: ["guaranteed", "100%", "cheapest"],
    },
    pitch: { mentionPrice: false, priceHook: undefined, usp: undefined },
    sender: {},
    analysis: {
      at: new Date().toISOString(),
      by: "rules",
      pages: site.pages.map((p) => p.url),
      notes: [
        "Drafted without AI (no AI key set, or the AI did not answer): check the services list, add prices, who they sell to and why customers pick them.",
        ...(prices.length && !services.some((s) => s.price) ? [`Prices seen on the site: ${prices.slice(0, 6).map((p) => p.price).join(", ")}. Add them to the right services.`] : []),
      ],
    },
  };
}

/* ---------- Claude draft ---------- */

const offerCats = (offer: Exclude<Offer, "agency">) => (isNiche(offer) ? categoriesFor(offer) : CATEGORIES.filter((c) => (offer === "logistics" ? c.sells === "logistics" : !c.sells)));
const catKeys = CATEGORIES.filter((c) => c.sells !== "agency").map((c) => c.key) as [string, ...string[]];

export const DraftSchema = z.object({
  name: z.string().describe("The business name as the site shows it"),
  offer: z.enum(["website_development", "logistics", ...NICHE_KEYS] as [Exclude<Offer, "agency">, ...Array<Exclude<Offer, "agency">>]).describe("website_development if they sell websites to local businesses; logistics if they move goods or handle customs; marketing if they sell SEO, social media or ads; solar if they install solar; accounting if they are a CA / tax / GST firm; staffing if they recruit or supply staff; insurance if they sell business insurance"),
  summary: z.string().describe("One plain sentence: what they do and for whom"),
  city: z.string().nullable(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  services: z.array(
    z.object({
      name: z.string().describe("In the client's own words, short"),
      description: z.string().nullable(),
      price: z.string().nullable().describe("Exactly as written on the site (e.g. '₹9,999', 'from ₹15,000 / month'); null if the site gives no price"),
      logistics: z.enum(["none", ...ALL_SERVICES] as [string, ...string[]]).describe("For logistics clients: the closest app service key, else none"),
    }),
  ),
  audience_categories: z.array(z.enum(catKeys)).describe("Business types from the list that are good customers for them"),
  audience_notes: z.string().nullable(),
  usps: z.array(z.string()).describe("Reasons customers pick them, from the site"),
  proof: z.array(z.string()).describe("Numbers, clients, years, certifications, from the site"),
  dos: z.array(z.string()).describe("Suggested rules for messages sent on their behalf"),
  donts: z.array(z.string()),
  banned_phrases: z.array(z.string()).describe("Short words or phrases their messages must never use"),
  price_hook: z.string().nullable().describe("A short price line if the site states a starting price, else null"),
  usp_line: z.string().nullable().describe("One short reason to pick them, for messages"),
  notes: z.array(z.string()).describe("What the site didn't say that the profile needs (e.g. 'no prices listed')"),
});
export type Draft = z.infer<typeof DraftSchema>;

const SYSTEM = `You set up a lead-generation profile ("Business Brain") for an Indian business from its own website pages.
Use only what the pages say. Never invent prices, numbers, clients or certifications: leave price null when a service has no price on the site, and list what's missing in notes.
Write services in the business's own words. Keep every item short (one line). Suggest message rules that fit the business: practical do's and don'ts for polite WhatsApp/email outreach in India, and banned phrases for claims they can't promise.
Audience categories must come from this list (key: label):
${CATEGORIES.filter((c) => c.sells !== "agency").map((c) => `${c.key}: ${c.label}${c.sells === "logistics" ? " (for logistics clients)" : c.sells === "niche" ? " (large sites and offices)" : ""}`).join("\n")}`;

/** An AI that reads the pages and returns a draft checked against DraftSchema. */
export interface Drafter {
  by: "gpt" | "gemini" | "claude";
  draft: (system: string, pagesText: string) => Promise<Draft>;
}
type DraftFn = Drafter["draft"];
const off = (v?: string) => /^(off|0|false|no)$/i.test(v || "");

const AI_NAME = { gpt: "GPT", gemini: "Gemini", claude: "Claude" } as const;
const has = (v?: string) => !!v?.trim();
const aiModes = (env: Record<string, string | undefined>): Array<Drafter["by"]> => {
  const mode = (env.BRAIN_AI || "").trim().toLowerCase();
  if (off(mode)) return [];
  const configured: Array<Drafter["by"]> = [];
  if (has(env.OPENAI_API_KEY)) configured.push("gpt");
  if (has(env.GEMINI_API_KEY)) configured.push("gemini");
  if (has(env.ANTHROPIC_API_KEY)) configured.push("claude");
  const only = mode === "openai" ? "gpt" : mode;
  return only === "gpt" || only === "gemini" || only === "claude" ? configured.filter((b) => b === only) : configured;
};

/** An answer that parses but says nothing (no name, or no services and no summary) counts as a bad answer. */
const draftLooksBad = (d: Draft) => !d.name.trim() || (d.services.length === 0 && !d.summary.trim());

/** Try each AI in order; the next one takes over when one fails, times out, or answers badly. `by` is whichever answered. */
export function chainDrafters(list: Drafter[]): Drafter | undefined {
  if (list.length <= 1) return list[0];
  let by = list[0].by;
  return {
    get by() {
      return by;
    },
    async draft(system, pagesText) {
      const errors: string[] = [];
      for (const d of list) {
        try {
          const r = await d.draft(system, pagesText);
          if (draftLooksBad(r)) throw new Error("the answer was empty");
          by = d.by;
          return r;
        } catch (e) {
          errors.push(`${AI_NAME[d.by]}: ${e instanceof Error ? e.message : e}`);
        }
      }
      throw new Error(errors.join("; "));
    },
  };
}

/**
 * Which AI reads client websites. Every AI with a key is tried in this order: GPT (OPENAI_API_KEY),
 * then Gemini (GEMINI_API_KEY), then Claude (ANTHROPIC_API_KEY); the next takes over when one fails
 * or gives a bad answer. BRAIN_AI=gpt | gemini | claude uses just that one; BRAIN_AI=off turns it off.
 */
export async function pickDrafter(env: Record<string, string | undefined> = process.env, f: typeof fetch = fetch): Promise<Drafter | undefined> {
  const list: Drafter[] = [];
  for (const b of aiModes(env)) {
    const d = b === "gpt" ? openaiDrafter(env, f) : b === "gemini" ? geminiDrafter(env, f) : await claudeDrafter(env);
    if (d) list.push(d);
  }
  return chainDrafters(list);
}

/** "GPT → Gemini → Claude" (the AIs that have keys, in the order they're tried) or undefined, for the Setup panel (no keys). */
export function aiName(env: Record<string, string | undefined> = process.env): string | undefined {
  const names = aiModes(env).map((b) => AI_NAME[b]);
  return names.length ? names.join(" → ") : undefined;
}

/* ----- GPT: any OpenAI-compatible chat endpoint (OpenAI itself, or a gateway) ----- */

export const OPENAI_DEFAULT_BASE = "https://api.openai.com/v1";
export const OPENAI_DEFAULT_MODEL = "gpt-4o";

/** One chat call to the OpenAI-compatible endpoint. Returns the answer text; throws a plain message on failure. */
export async function openaiChat(env: Record<string, string | undefined>, f: typeof fetch, system: string, user: string, o: { maxTokens: number; temperature: number; timeoutMs?: number }): Promise<string> {
  const base = (env.OPENAI_BASE_URL?.trim() || OPENAI_DEFAULT_BASE).replace(/\/+$/, "");
  const model = env.OPENAI_MODEL?.trim() || OPENAI_DEFAULT_MODEL;
  const timeout = Number(env.OPENAI_TIMEOUT_MS) || o.timeoutMs || 90_000;
  const res = await f(`${base}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.OPENAI_API_KEY?.trim()}` },
    body: JSON.stringify({ model, temperature: o.temperature, max_tokens: o.maxTokens, messages: [{ role: "system", content: system }, { role: "user", content: user }] }),
    signal: AbortSignal.timeout(timeout),
  }).catch((e) => {
    throw new Error(e instanceof Error && e.name === "TimeoutError" ? `no answer within ${Math.round(timeout / 1000)}s` : `could not connect (${e instanceof Error ? e.message : e})`);
  });
  const j = (await res.json().catch(() => ({}))) as { choices?: Array<{ finish_reason?: string; message?: { content?: string | null } }>; error?: { message?: string } };
  if (!res.ok) throw new Error(res.status === 429 ? "rate limit reached" : `${j.error?.message ?? "HTTP " + res.status}`.slice(0, 200));
  const c = j.choices?.[0];
  if (!c) throw new Error("no answer");
  if (c.finish_reason === "length") throw new Error("the site was too long to read in one go");
  const text = c.message?.content?.trim();
  if (!text) throw new Error("empty answer");
  return text;
}

export function openaiDrafter(env: Record<string, string | undefined> = process.env, f: typeof fetch = fetch): Drafter | undefined {
  if (!has(env.OPENAI_API_KEY)) return undefined;
  const schema = JSON.stringify(z.toJSONSchema(DraftSchema));
  const draft: DraftFn = async (system, pagesText) => {
    let problem = "";
    for (let attempt = 0; attempt < 2; attempt++) {
      const text = await openaiChat(
        env,
        f,
        `${system}\n\nAnswer with one JSON object matching this JSON Schema (every key present; null or [] when the site doesn't say) and nothing else:\n${schema}`,
        pagesText + (problem ? `\n\nYour last answer didn't match the schema (${problem}). Answer again with the full JSON object.` : ""),
        { maxTokens: 8000, temperature: 0.2 },
      );
      let parsed: unknown;
      try {
        parsed = jsonIn(text);
      } catch {
        parsed = undefined;
      }
      const r = DraftSchema.safeParse(normalizeDraft(parsed));
      if (r.success) return r.data;
      problem = parsed === undefined ? "not valid JSON" : r.error.issues.slice(0, 3).map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    }
    throw new Error(`the answer didn't match the profile format (${problem})`);
  };
  return { by: "gpt", draft };
}

/* ----- Gemini (Google AI Studio key; free tier) through its REST API ----- */

const GEMINI = "https://generativelanguage.googleapis.com/v1beta";
export const GEMINI_DEFAULT_MODEL = "gemini-2.5-flash";

/** The answer as JSON: tolerates a ```json fence around it. */
function jsonIn(text: string): unknown {
  const t = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    return JSON.parse(t);
  } catch {
    const a = t.indexOf("{"), b = t.lastIndexOf("}");
    return a >= 0 && b > a ? JSON.parse(t.slice(a, b + 1)) : undefined;
  }
}

/** Fill what a model left out (missing lists, unknown category keys) before the strict check. */
export function normalizeDraft(x: unknown): unknown {
  if (!x || typeof x !== "object") return x;
  const d = { ...(x as Record<string, unknown>) };
  for (const k of ["services", "audience_categories", "usps", "proof", "dos", "donts", "banned_phrases", "notes"]) if (!Array.isArray(d[k])) d[k] = [];
  for (const k of ["city", "phone", "email", "audience_notes", "price_hook", "usp_line"]) if (d[k] === undefined || d[k] === "") d[k] = null;
  const cats = new Set<string>(catKeys);
  d.audience_categories = (d.audience_categories as unknown[]).filter((k): k is string => typeof k === "string" && cats.has(k));
  const svc = new Set<string>(["none", ...ALL_SERVICES]);
  d.services = (d.services as unknown[])
    .filter((s): s is Record<string, unknown> => !!s && typeof s === "object" && typeof (s as { name?: unknown }).name === "string")
    .map((s) => ({ name: s.name, description: typeof s.description === "string" ? s.description : null, price: typeof s.price === "string" && s.price ? s.price : null, logistics: typeof s.logistics === "string" && svc.has(s.logistics) ? s.logistics : "none" }));
  for (const k of ["usps", "proof", "dos", "donts", "banned_phrases", "notes"]) d[k] = (d[k] as unknown[]).filter((v) => typeof v === "string");
  return d;
}

export function geminiDrafter(env: Record<string, string | undefined> = process.env, f: typeof fetch = fetch): Drafter | undefined {
  const key = env.GEMINI_API_KEY?.trim();
  if (!key) return undefined;
  let model = env.GEMINI_MODEL?.trim() || GEMINI_DEFAULT_MODEL;
  const headers = { "Content-Type": "application/json", "x-goog-api-key": key };
  const schema = JSON.stringify(z.toJSONSchema(DraftSchema));
  /** Model names change: when ours is gone, pick the newest stable Flash model this key can use. */
  const newestFlash = async (): Promise<string | undefined> => {
    const r = await f(`${GEMINI}/models?pageSize=200`, { headers });
    if (!r.ok) return undefined;
    const j = (await r.json()) as { models?: Array<{ name: string; supportedGenerationMethods?: string[] }> };
    const ver = (n: string) => Number(n.match(/gemini-(\d+(?:\.\d+)?)/)?.[1] ?? 0);
    return (j.models ?? [])
      .filter((m) => m.supportedGenerationMethods?.includes("generateContent") && /gemini-[\d.]+-flash$/.test(m.name.replace(/^models\//, "")))
      .map((m) => m.name.replace(/^models\//, ""))
      .sort((a, b) => ver(b) - ver(a))[0];
  };
  const call = (m: string, body: unknown) => f(`${GEMINI}/models/${encodeURIComponent(m)}:generateContent`, { method: "POST", headers, body: JSON.stringify(body), signal: AbortSignal.timeout(180_000) });
  const draft: DraftFn = async (system, pagesText) => {
    let problem = "";
    for (let attempt = 0; attempt < 2; attempt++) {
      const body = {
        systemInstruction: { parts: [{ text: `${system}\n\nAnswer with one JSON object matching this JSON Schema (every key present; null or [] when the site doesn't say):\n${schema}` }] },
        contents: [{ role: "user", parts: [{ text: pagesText + (problem ? `\n\nYour last answer didn't match the schema (${problem}). Answer again with the full JSON object.` : "") }] }],
        generationConfig: { responseMimeType: "application/json", temperature: 0.2, maxOutputTokens: 16384 },
      };
      let res = await call(model, body);
      if (res.status === 404) {
        const next = await newestFlash().catch(() => undefined);
        if (next && next !== model) {
          model = next;
          res = await call(model, body);
        }
      }
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
        throw new Error(res.status === 429 ? "Gemini's free limit is used up for now (try again in a minute)" : `Gemini: ${j.error?.message ?? `HTTP ${res.status}`}`);
      }
      const j = (await res.json()) as { candidates?: Array<{ finishReason?: string; content?: { parts?: Array<{ text?: string }> } }>; promptFeedback?: { blockReason?: string } };
      const c = j.candidates?.[0];
      if (!c) throw new Error(`Gemini gave no answer${j.promptFeedback?.blockReason ? ` (blocked: ${j.promptFeedback.blockReason})` : ""}`);
      if (c.finishReason === "MAX_TOKENS") throw new Error("The site was too long to read in one go");
      if (c.finishReason && !["STOP", "FINISH_REASON_UNSPECIFIED"].includes(c.finishReason)) throw new Error(`Gemini stopped (${c.finishReason})`);
      let parsed: unknown;
      try {
        parsed = jsonIn((c.content?.parts ?? []).map((p) => p.text ?? "").join(""));
      } catch {
        parsed = undefined;
      }
      const r = DraftSchema.safeParse(normalizeDraft(parsed));
      if (r.success) return r.data;
      problem = parsed === undefined ? "not valid JSON" : r.error.issues.slice(0, 3).map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    }
    throw new Error(`Gemini's answer didn't match the profile format (${problem})`);
  };
  return { by: "gemini", draft };
}

/* ----- Claude through the official SDK: structured output checked against DraftSchema ----- */

export async function claudeDrafter(env: Record<string, string | undefined> = process.env): Promise<Drafter | undefined> {
  if (!env.ANTHROPIC_API_KEY?.trim()) return undefined;
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const { betaZodOutputFormat } = await import("@anthropic-ai/sdk/helpers/beta/zod");
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, timeout: 180_000, maxRetries: 2 });
  const draft: DraftFn = async (system, pagesText) => {
    const res = await client.beta.messages.parse({
      model: "claude-opus-5-5",
      max_tokens: 16000,
      // a declined request is re-run on Anthropic's recommended fallback model instead of failing
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "medium", format: betaZodOutputFormat(DraftSchema) },
      system,
      messages: [{ role: "user", content: pagesText }],
    });
    if (res.stop_reason === "refusal") throw new Error("Claude declined to read this site");
    if (res.stop_reason === "max_tokens") throw new Error("The site was too long to read in one go");
    if (!res.parsed_output) throw new Error("Claude's answer didn't match the profile format");
    return res.parsed_output;
  };
  return { by: "claude", draft };
}

/** Does this price text appear on the pages (same digits)? Guards against a made-up price. */
const digitsOf = (s: string) => s.replace(/[^\d]/g, "");
export function priceOnSite(price: string, siteText: string): boolean {
  const d = digitsOf(price);
  return d.length >= 2 && siteText.replace(/[,.\s]/g, "").includes(d);
}

export function draftToBrain(d: Draft, site: ClientSite, hint: { name?: string } = {}, by: Drafter["by"] = "claude"): BrainInput {
  const text = site.pages.map((p) => p.text).join(" ");
  const dropped: string[] = [];
  const services = d.services.slice(0, 40).map((s) => {
    let price = s.price?.trim() || undefined;
    if (price && !priceOnSite(price, text)) {
      dropped.push(`${s.name} (${price})`);
      price = undefined;
    }
    return { name: s.name, description: s.description ?? undefined, price, logistics: s.logistics !== "none" ? (s.logistics as LogisticsService) : undefined };
  });
  const allowed = new Set(offerCats(d.offer).map((c) => c.key));
  return {
    name: (hint.name?.trim() || d.name).slice(0, 120),
    website: site.url,
    city: d.city ?? undefined,
    phone: d.phone ?? site.phones[0],
    email: d.email ?? site.emails[0],
    offer: d.offer,
    summary: d.summary,
    services,
    audience: { categories: d.audience_categories.filter((k) => allowed.has(k)), areas: [], notes: d.audience_notes ?? undefined },
    usps: d.usps.slice(0, 12),
    proof: d.proof.slice(0, 12),
    rules: { dos: d.dos.slice(0, 20), donts: d.donts.slice(0, 20), bannedPhrases: d.banned_phrases.slice(0, 30) },
    pitch: { priceHook: d.price_hook && priceOnSite(d.price_hook, text) ? d.price_hook : undefined, mentionPrice: false, usp: d.usp_line ?? undefined },
    sender: {},
    analysis: {
      at: new Date().toISOString(),
      by,
      pages: site.pages.map((p) => p.url),
      notes: [...d.notes, ...(dropped.length ? [`Prices not found on the site were left out: ${dropped.join(", ")}.`] : [])].slice(0, 20),
    },
  };
}

export const pagesForPrompt = (site: ClientSite) =>
  site.pages.map((p) => `<page url="${p.url}">\n<title>${p.title}</title>\n<headings>${p.headings.join(" | ")}</headings>\n${p.text}\n</page>`).join("\n\n");

/** Read the site and draft a brain with the AI when one is set up (falls back to the basic reader if it fails). */
export async function analyzeClientSite(
  opts: { website: string; name?: string },
  deps: { fetch?: typeof fetchPublic; drafter?: Drafter | DraftFn | null } = {},
): Promise<{ draft: BrainInput; by: Drafter["by"] | "rules"; warning?: string }> {
  const site = await readClientSite(opts.website, deps.fetch);
  const d0 = deps.drafter === undefined ? await pickDrafter() : deps.drafter ?? undefined;
  const drafter: Drafter | undefined = typeof d0 === "function" ? { by: "claude", draft: d0 } : d0;
  let warning: string | undefined;
  if (drafter) {
    try {
      const d = await drafter.draft(SYSTEM, pagesForPrompt(site));
      const draft = draftToBrain(d, site, opts, drafter.by);
      // make sure the draft passes the same checks a save does
      const ok = parseBrain(draft);
      if (ok.ok) return { draft, by: drafter.by };
      warning = `AI draft had a problem (${ok.error}); used the basic reader instead.`;
    } catch (e) {
      warning = `AI reading failed (${e instanceof Error ? e.message : e}); used the basic reader instead.`;
    }
  }
  return { draft: draftFromRules(site, opts), by: "rules", warning };
}

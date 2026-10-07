import { findPhoneNumbersInText, parsePhoneNumberFromString, type CountryCode } from "libphonenumber-js/min";
import { mobileIn } from "./markets";
/** A real contact email from .env.local, or undefined if it's missing or still the placeholder. */
export function crawlerContact(): string | undefined {
  const c = (process.env.CRAWLER_CONTACT || "").trim();
  return c && /@/.test(c) && !/@example\.(com|org|net)$/i.test(c) ? c : undefined;
}
export const USER_AGENT = `LeadAutopilot/0.1 (lead research tool; contact: ${crawlerContact() ?? "not set"})`;

/** fetch with a hard timeout. Never throws on HTTP errors, only on network/timeout. */
export async function fetchWithTimeout(url: string, init: RequestInit = {}, ms = 10_000): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, {
      ...init,
      signal: ctrl.signal,
      headers: { "User-Agent": USER_AGENT, ...(init.headers || {}) },
    });
  } finally {
    clearTimeout(t);
  }
}

/** Run `fn` over items with at most `limit` in flight. Keeps input order. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

/**
 * Normalise a phone number to +<country code><number>. Indian numbers follow India's rules
 * (mobile 10 digits, landline with STD code, 1800 toll-free); other countries' through
 * libphonenumber, read as a number of `country` when it has no +code.
 * Returns undefined if it doesn't look valid.
 */
export function normalizePhone(input?: string, country = "IN"): string | undefined {
  if (!input) return undefined;
  const cc = country.toUpperCase();
  let d = input.replace(/[^\d+]/g, "");
  if (cc !== "IN" && !d.startsWith("+91") && !d.startsWith("0091")) {
    const p = parsePhoneNumberFromString(input, cc as CountryCode);
    return p?.isValid() ? p.number : undefined;
  }
  if (d.startsWith("+")) {
    if (!d.startsWith("+91")) {
      const p = parsePhoneNumberFromString(d);
      return p?.isValid() ? p.number : undefined;
    }
    d = d.slice(3);
  } else if (d.startsWith("0091")) d = d.slice(4);
  else if (d.startsWith("91") && d.length === 12) d = d.slice(2);
  // toll-free and shared-cost numbers: 1800 / 1860 xxx xxxx
  if (/^1(800|860)\d{6,7}$/.test(d)) return "+91" + d;
  // Strip leading 0 (STD prefix): 020-2555-1234 → 202555 1234
  if (d.startsWith("0")) d = d.slice(1);
  // mobiles: 10 digits starting 6-9
  if (d.length === 10 && /^[6-9]/.test(d)) return "+91" + d;
  // landlines: STD code (2-4 digits) + local number = 10-11 digits total
  // Common STD codes: 2-digit (11,20,22,33,40,44,79,80), 3-digit (120,124,141,...), 4-digit
  if (d.length >= 10 && d.length <= 11 && /^[2-8]/.test(d)) return "+91" + d;
  return undefined;
}

/** Phone numbers written in a page's text, for a country (other countries' numbers need their +code). */
export function phonesInText(text: string, country = "IN"): string[] {
  return [...new Set(findPhoneNumbersInText(text.slice(0, 200_000), country.toUpperCase() as CountryCode).map((x) => x.number.number as string))];
}

/** True if the number is a mobile (reachable on WhatsApp): India, the Gulf, Australia, NZ. */
export const isMobile = (p?: string) => !!p && (/^\+91[6-9]\d{9}$/.test(p) || mobileIn(p));

/** True if the number is an Indian landline (STD code + local number). */
export const isLandline = (p?: string) => !!p && /^\+91[2-8]\d{9,10}$/.test(p) && !isMobile(p);

/** Toll-free (1800) or shared-cost (1860) number: usually a call centre, not the owner. */
export const isTollFree = (p?: string) => !!p && (/^\+911(800|860)\d{6,7}$/.test(p) || /^\+1(800|833|844|855|866|877|888)\d{7}$/.test(p) || /^\+611[38]00\d{6}$/.test(p) || /^\+971800\d{3,7}$/.test(p));

export type PhoneKind = "mobile" | "landline" | "tollfree" | "phone";
/** What kind of number this is: a mobile (WhatsApp, reaches a person), an office landline, toll-free, or just a phone (US/Canada numbers don't say). */
export function phoneKind(p?: string): PhoneKind | undefined {
  if (!p) return undefined;
  if (isMobile(p)) return "mobile";
  if (isTollFree(p)) return "tollfree";
  if (isLandline(p)) return "landline";
  return p.startsWith("+") ? "phone" : undefined;
}
export const PHONE_KIND_LABEL: Record<PhoneKind, string> = { mobile: "Mobile", landline: "Landline", tollfree: "Toll-free", phone: "Phone" };

export function domainOf(url?: string): string | undefined {
  if (!url) return undefined;
  try {
    const u = new URL(url.startsWith("http") ? url : `http://${url}`);
    return u.hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return undefined;
  }
}

const SOCIAL_HOSTS = [
  "instagram.com", "facebook.com", "fb.com", "m.facebook.com", "linktr.ee", "justdial.com",
  "wa.me", "api.whatsapp.com", "youtube.com", "twitter.com", "x.com", "linkedin.com",
  "sulekha.com", "practo.com", "zomato.com", "swiggy.com", "indiamart.com", "g.page", "maps.google.com",
];
export const isSocialHost = (domain?: string) =>
  !!domain && SOCIAL_HOSTS.some((h) => domain === h || domain.endsWith("." + h));

/** Distance in metres between two lat/lng points. */
export function metres(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6_371_000;
  const toRad = (x: number) => (x * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

export function simplifyName(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\b(pvt|private|ltd|limited|llp|the|dr|clinic|centre|center)\b\.?/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export const uid = () =>
  (globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`);

/** Only http(s) links from outside data become clickable (no javascript:, data:, file:). */
export function safeHref(u?: string): string | undefined {
  if (!u) return undefined;
  try {
    const x = new URL(u);
    return x.protocol === "http:" || x.protocol === "https:" ? x.toString() : undefined;
  } catch {
    return undefined;
  }
}

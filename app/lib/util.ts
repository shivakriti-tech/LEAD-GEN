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
 * Normalise Indian phone numbers to +91XXXXXXXXXX (mobile, 10 digits after +91)
 * or +91XXXXXXXXXXX (landline with STD code, 10–11 digits after +91).
 * Returns undefined if it doesn't look valid.
 */
export function normalizePhone(input?: string): string | undefined {
  if (!input) return undefined;
  let d = input.replace(/[^\d+]/g, "");
  if (d.startsWith("+")) {
    if (!d.startsWith("+91")) return d.length >= 9 ? d : undefined; // keep foreign numbers as-is
    d = d.slice(3);
  } else if (d.startsWith("0091")) d = d.slice(4);
  else if (d.startsWith("91") && d.length === 12) d = d.slice(2);
  // Strip leading 0 (STD prefix): 020-2555-1234 → 202555 1234
  if (d.startsWith("0")) d = d.slice(1);
  // mobiles: 10 digits starting 6-9
  if (d.length === 10 && /^[6-9]/.test(d)) return "+91" + d;
  // landlines: STD code (2-4 digits) + local number = 10-11 digits total
  // Common STD codes: 2-digit (11,20,22,33,40,44,79,80), 3-digit (120,124,141,...), 4-digit
  if (d.length >= 10 && d.length <= 11 && /^[2-8]/.test(d)) return "+91" + d;
  return undefined;
}

/** True if the number is an Indian mobile (reachable on WhatsApp). */
export const isMobile = (p?: string) => !!p && /^\+91[6-9]\d{9}$/.test(p);

/** True if the number is an Indian landline (STD code + local number). */
export const isLandline = (p?: string) => !!p && /^\+91[2-8]\d{9,10}$/.test(p) && !isMobile(p);

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

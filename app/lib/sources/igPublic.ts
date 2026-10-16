import { testingToolsAllowed } from "../security";
import { fetchWithTimeout } from "../util";
import type { InstagramProfile } from "./meta";

/**
 * Instagram profiles read from the public profile page, the way Scout does it
 * (github.com/kiryano/Scout, app/scrapers/instagram.py, MIT licence), ported to TypeScript.
 *
 * TESTING ONLY, until the official token (META_ACCESS_TOKEN + IG_BUSINESS_ACCOUNT_ID) is set up.
 * Reading Instagram's pages directly is against Instagram's terms, and Instagram sends most
 * servers (and busy home connections) to its login page instead. A live build uses it only with
 * ALLOW_TESTING_TOOLS=yes, and the official API takes over as soon as its token is set.
 *
 *   IG_SCRAPER=on   turn it on (local only)
 */

/** Only when asked for AND not a live build (unless ALLOW_TESTING_TOOLS=yes). */
export function igScraperOn(env: Record<string, string | undefined> = process.env): boolean {
  return /^(on|true|1|yes)$/i.test(env.IG_SCRAPER?.trim() ?? "") && testingToolsAllowed(env);
}

/** Instagram stopped answering (login page or rate limit): the rest of the search skips it. */
export class InstagramBlocked extends Error {}

const MOBILE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

const NOT_FOUND = ["Page Not Found", "Sorry, this page isn", "The link you followed may be broken", "Profile isn\\'t available", "profile may have been removed", '"HttpErrorPage"'];

/** "1.2K" → 1200, "3,456" → 3456. */
export function parseCount(v: string): number {
  const m = v.trim().replace(/,/g, "").match(/^([\d.]+)\s*([KMB])?$/i);
  if (!m) return 0;
  const unit = ({ K: 1e3, M: 1e6, B: 1e9 } as Record<string, number>)[(m[2] ?? "").toUpperCase()] ?? 1;
  return Math.round(parseFloat(m[1]) * unit);
}

/** A JSON string's inside ("Café 🍰") → "Café 🍰". */
function unescape(s: string): string {
  try {
    return JSON.parse(`"${s}"`) as string;
  } catch {
    return s.replace(/\\\//g, "/");
  }
}

const first = (html: string, patterns: RegExp[]) => {
  for (const p of patterns) {
    const m = html.match(p);
    if (m) return m;
  }
  return null;
};

/**
 * The profile in an Instagram profile page, or null when it isn't a readable public profile
 * (not found, private, or no follower count on the page).
 */
export function parseInstagramPage(html: string, handle: string): InstagramProfile | null {
  if (NOT_FOUND.some((x) => html.slice(0, 10_000).includes(x))) return null;
  if (/"is_private":true/.test(html)) return null;
  const esc = handle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const name = first(html, [/"full_name":"((?:[^"\\]|\\.)*)"/, new RegExp(`<title>([^(<]+)\\s*\\(@${esc}\\)`, "i")]);
  const bio = first(html, [/"biography":"((?:[^"\\]|\\.)*)"/]);
  const site = first(html, [/"external_url":"((?:[^"\\]|\\.)+)"/]);
  let followers = Number(first(html, [/"follower_count":(\d+)/, /"edge_followed_by":\{"count":(\d+)\}/])?.[1] ?? 0);
  let posts = Number(first(html, [/"media_count":(\d+)/, /"edge_owner_to_timeline_media":\{"count":(\d+)/])?.[1] ?? 0) || undefined;
  // the page's description: "1,234 Followers, 56 Following, 78 Posts - …"
  const meta = html.match(/([\d.,]+[KMB]?)\s*Followers?\s*[,·]\s*([\d.,]+[KMB]?)\s*Following\s*[,·]\s*([\d.,]+[KMB]?)\s*Posts?/i);
  if (meta) {
    if (!followers) followers = parseCount(meta[1]);
    posts ??= parseCount(meta[3]) || undefined;
  }
  if (!followers) return null;
  // newest post, when the page carries post times
  const times = [...html.matchAll(/"taken_at(?:_timestamp)?":(\d{9,10})\b/g)].map((m) => Number(m[1]));
  const last = times.length ? Math.max(...times) : undefined;
  return {
    handle,
    name: name ? unescape(name[1]).trim() || undefined : undefined,
    bio: bio ? unescape(bio[1]) || undefined : undefined,
    website: site ? unescape(site[1]) : undefined,
    followers,
    posts,
    lastPostAt: last ? new Date(last * 1000).toISOString() : undefined,
  };
}

/** Read one public profile. Throws InstagramBlocked when Instagram asks for a login or rate limits. */
export async function instagramPublicProfile(handle: string, f: typeof fetchWithTimeout = fetchWithTimeout): Promise<InstagramProfile | null> {
  const res = await f(`https://www.instagram.com/${encodeURIComponent(handle)}/`, { redirect: "manual", headers: { "User-Agent": MOBILE_UA, Accept: "text/html,application/xhtml+xml", "Accept-Language": "en-US,en;q=0.9" } }, 15_000);
  if (res.status === 404) return null;
  if (res.status === 429) throw new InstagramBlocked("Instagram rate limited this connection (429). Wait a while, or use the official token");
  if (res.status >= 300 && res.status < 400) {
    if (/\/accounts\/login|challenge/i.test(res.headers.get("location") ?? "")) throw new InstagramBlocked("Instagram asks this connection to log in. Try again later, or use the official token (see README, Instagram setup)");
    return null;
  }
  if (!res.ok) return null;
  const html = await res.text();
  if (/\/accounts\/login/.test(res.url) || (/"login"|>Log in</i.test(html.slice(0, 5000)) && /password/i.test(html.slice(0, 5000)) && !/"follower_count"|Followers/.test(html))) throw new InstagramBlocked("Instagram asks this connection to log in. Try again later, or use the official token (see README, Instagram setup)");
  return parseInstagramPage(html, handle);
}

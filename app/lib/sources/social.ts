import type { RawPlace } from "../types";
import type { SearchHit } from "../enrich/discover";

/**
 * Instagram and Facebook as lead sources, found through web search
 * (e.g. `site:instagram.com "dental clinic" Bhayli Vadodara`).
 * We only read the search result (profile address + title). We never log in to
 * or scrape Instagram/Facebook pages; profile details come from Meta's official API.
 */

export type SocialPlatform = "instagram" | "facebook";

const IG_RESERVED = new Set(["p", "reel", "reels", "explore", "stories", "accounts", "tv", "about", "developer", "legal", "direct", "web", "tags", "locations"]);
const FB_RESERVED = new Set([
  "groups", "events", "watch", "marketplace", "photo", "photos", "photo.php", "story.php", "permalink.php", "posts", "videos", "hashtag",
  "login", "login.php", "sharer", "sharer.php", "share", "help", "policies", "privacy", "gaming", "reel", "people", "public", "search", "profile.php", "pages",
]);

/** "https://www.instagram.com/brewbloom.cafe/?hl=en" → "brewbloom.cafe". Undefined for posts, reels, etc. */
export function instagramHandle(url?: string): string | undefined {
  if (!url) return undefined;
  try {
    const u = new URL(url.startsWith("http") ? url : `https://${url}`);
    if (!/(^|\.)instagram\.com$/.test(u.hostname)) return undefined;
    const first = u.pathname.split("/").filter(Boolean)[0]?.toLowerCase();
    if (!first || IG_RESERVED.has(first) || !/^[a-z0-9._]{1,30}$/.test(first)) return undefined;
    return first;
  } catch {
    return undefined;
  }
}

/** "https://m.facebook.com/SharmaDentalVadodara/about" → "sharmadentalvadodara". */
export function facebookPage(url?: string): string | undefined {
  if (!url) return undefined;
  try {
    const u = new URL(url.startsWith("http") ? url : `https://${url}`);
    if (!/(^|\.)(facebook\.com|fb\.com)$/.test(u.hostname)) return undefined;
    const parts = u.pathname.split("/").filter(Boolean);
    const first = parts[0]?.toLowerCase();
    if (!first || FB_RESERVED.has(first)) return undefined;
    if (first === "p" && parts[1]) return parts[1].toLowerCase(); // new-style /p/Name-123/
    if (!/^[a-z0-9.\-]{3,80}$/.test(first)) return undefined;
    return first;
  } catch {
    return undefined;
  }
}

export const socialKey = (url?: string) => {
  const ig = instagramHandle(url);
  if (ig) return `ig:${ig}`;
  const fb = facebookPage(url);
  return fb ? `fb:${fb}` : undefined;
};

/** Pull a business name out of a search-result title. */
export function nameFromTitle(platform: SocialPlatform, title: string, handle: string): string {
  let t = title.replace(/\s+/g, " ").trim();
  if (platform === "instagram") {
    // "Brew & Bloom Café (@brewbloom.cafe) • Instagram photos and videos"
    t = t.replace(/\s*\(@[^)]*\).*$/, "").replace(/\s*[•|·-]\s*Instagram.*$/i, "");
  } else {
    // "Sharma Dental Care | Vadodara | Facebook", "Sharma Dental Care - Home | Facebook"
    t = t.replace(/\s*[|·-]\s*Facebook.*$/i, "").replace(/\s*[-|]\s*(Home|About|Photos|Reviews|Posts)\s*$/i, "").split(" | ")[0];
  }
  t = t.trim();
  if (!t || /^(log ?in|instagram|facebook)$/i.test(t)) t = handle.replace(/[._]+/g, " ");
  return t.slice(0, 120);
}

/** Search query for business profiles of one type in one place. */
export function socialQuery(platform: SocialPlatform, businessTerm: string, place: string): string {
  return `site:${platform === "instagram" ? "instagram.com" : "facebook.com"} ${businessTerm} ${place}`;
}

export async function socialSearch(opts: {
  platform: SocialPlatform;
  businessTerm: string; // "dental clinic"
  place: string; // "Bhayli, Vadodara"
  category: string; // our label
  city: string;
  max: number;
  search: (q: string) => Promise<SearchHit[]>;
}): Promise<RawPlace[]> {
  const hits = await opts.search(socialQuery(opts.platform, opts.businessTerm, opts.place));
  const out: RawPlace[] = [];
  const seen = new Set<string>();
  for (const h of hits) {
    const handle = opts.platform === "instagram" ? instagramHandle(h.url) : facebookPage(h.url);
    if (!handle || seen.has(handle)) continue;
    seen.add(handle);
    const url = opts.platform === "instagram" ? `https://www.instagram.com/${handle}/` : `https://www.facebook.com/${handle}`;
    out.push({
      source: opts.platform,
      sourceId: handle,
      name: nameFromTitle(opts.platform, h.title, handle),
      category: opts.category,
      city: opts.city,
      website: url,
    });
    if (out.length >= opts.max) break;
  }
  return out;
}

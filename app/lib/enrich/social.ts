import { fetchWithTimeout } from "../util";

/**
 * Lightweight social media presence detection.
 * Fetches public Instagram/Facebook profile pages and extracts follower/like counts
 * from meta tags and page content. No API key needed.
 */

export interface SocialPresence {
  instagram?: { followers?: number; posts?: number };
  facebook?: { likes?: number };
}

/** Parse Instagram follower count from the public profile page's meta description. */
async function instagramPresence(url: string): Promise<{ followers?: number; posts?: number } | undefined> {
  try {
    const res = await fetchWithTimeout(url, {
      headers: { Accept: "text/html", "Accept-Language": "en" },
      redirect: "follow",
    }, 8_000);
    if (!res.ok) return undefined;
    const html = await res.text();
    // Instagram meta descriptions typically contain: "123K Followers, 45 Following, 67 Posts"
    const desc = html.match(/<meta\s+(?:name|property)="(?:og:)?description"\s+content="([^"]+)"/i)?.[1] || "";
    const followersMatch = desc.match(/([\d,.]+[KkMm]?)\s*Followers/i);
    const postsMatch = desc.match(/([\d,.]+[KkMm]?)\s*Posts/i);
    return {
      followers: followersMatch ? parseCount(followersMatch[1]) : undefined,
      posts: postsMatch ? parseCount(postsMatch[1]) : undefined,
    };
  } catch {
    return undefined;
  }
}

/** Parse Facebook page like count from the public page's meta tags or content. */
async function facebookPresence(url: string): Promise<{ likes?: number } | undefined> {
  try {
    const res = await fetchWithTimeout(url, {
      headers: { Accept: "text/html", "Accept-Language": "en" },
      redirect: "follow",
    }, 8_000);
    if (!res.ok) return undefined;
    const html = await res.text();
    // Facebook pages often have like counts in meta descriptions or page content
    const desc = html.match(/<meta\s+(?:name|property)="(?:og:)?description"\s+content="([^"]+)"/i)?.[1] || "";
    const likesMatch = desc.match(/([\d,.]+[KkMm]?)\s*(?:likes?|people like)/i)
      || html.match(/([\d,.]+[KkMm]?)\s*(?:people like this|likes?\b)/i);
    return {
      likes: likesMatch ? parseCount(likesMatch[1]) : undefined,
    };
  } catch {
    return undefined;
  }
}

/** Parse counts like "12.5K", "1.2M", "1,234" into numbers. */
function parseCount(s: string): number | undefined {
  if (!s) return undefined;
  const cleaned = s.replace(/,/g, "").trim();
  const m = cleaned.match(/^([\d.]+)\s*([KkMm]?)$/);
  if (!m) return undefined;
  const n = parseFloat(m[1]);
  if (isNaN(n)) return undefined;
  const suffix = m[2].toLowerCase();
  if (suffix === "k") return Math.round(n * 1_000);
  if (suffix === "m") return Math.round(n * 1_000_000);
  return Math.round(n);
}

/** Enrich a lead with social media presence data. Never throws. */
export async function enrichSocialPresence(socials: Record<string, string>): Promise<SocialPresence> {
  const result: SocialPresence = {};

  const promises: Promise<void>[] = [];

  if (socials.instagram) {
    promises.push(
      instagramPresence(socials.instagram).then((data) => {
        if (data && (data.followers != null || data.posts != null)) {
          result.instagram = data;
        }
      }),
    );
  }

  if (socials.facebook) {
    promises.push(
      facebookPresence(socials.facebook).then((data) => {
        if (data && data.likes != null) {
          result.facebook = data;
        }
      }),
    );
  }

  await Promise.all(promises);
  return result;
}

// Export parseCount for tests
export { parseCount };

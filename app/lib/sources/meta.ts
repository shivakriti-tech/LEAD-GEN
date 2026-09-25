import { fetchWithTimeout } from "../util";

/**
 * Meta's official Graph API.
 *
 * Instagram Business Discovery: read any Instagram *business/creator* account's public
 * profile (bio, website, followers, posts) by username. Needs a token from Facebook Login
 * with instagram_basic, pages_show_list, pages_read_engagement, and your own Instagram
 * business account id. Personal accounts can't be read (the API says so).
 *
 * Facebook Pages search: needs the "Page Public Metadata Access" feature, which Meta only
 * grants after App Review + business verification. Turned off until FB_PAGE_SEARCH=on.
 */

const GRAPH = "https://graph.facebook.com/v25.0";

export interface InstagramProfile {
  handle: string;
  name?: string;
  bio?: string;
  website?: string;
  followers?: number;
  posts?: number;
  lastPostAt?: string;
}

export class MetaError extends Error {
  constructor(message: string, public code?: number, public kind: "auth" | "not_business" | "limit" | "other" = "other") {
    super(message);
  }
}

function explain(err: { message?: string; code?: number; error_subcode?: number } | undefined, status: number): MetaError {
  const m = err?.message || `HTTP ${status}`;
  const code = err?.code;
  if (code === 190 || /access token/i.test(m)) return new MetaError(`Meta token rejected or expired: ${m}. Make a new long-lived token (see README).`, code, "auth");
  if (code === 4 || code === 17 || code === 32 || code === 613 || /rate limit|too many calls/i.test(m)) return new MetaError(`Meta rate limit reached: ${m}`, code, "limit");
  if (code === 10 || code === 200 || /permission/i.test(m)) return new MetaError(`Meta permission missing: ${m}`, code, "auth");
  if (code === 110 || /cannot be found|does not exist|invalid user id/i.test(m)) return new MetaError("not a business account, or no such username", code, "not_business");
  return new MetaError(`Meta: ${m}`, code);
}

export async function instagramBusinessDiscovery(opts: { token: string; igUserId: string; handle: string }): Promise<InstagramProfile | null> {
  const fields = `business_discovery.username(${opts.handle}){username,name,biography,website,followers_count,media_count,media.limit(1){timestamp}}`;
  const url = `${GRAPH}/${encodeURIComponent(opts.igUserId)}?${new URLSearchParams({ fields, access_token: opts.token })}`;
  const res = await fetchWithTimeout(url, {}, 15_000);
  const json = (await res.json().catch(() => ({}))) as any;
  if (!res.ok || json.error) {
    const e = explain(json.error, res.status);
    if (e.kind === "not_business") return null;
    throw e;
  }
  const b = json.business_discovery;
  if (!b) return null;
  return {
    handle: b.username ?? opts.handle,
    name: b.name || undefined,
    bio: b.biography || undefined,
    website: b.website || undefined,
    followers: typeof b.followers_count === "number" ? b.followers_count : undefined,
    posts: typeof b.media_count === "number" ? b.media_count : undefined,
    lastPostAt: b.media?.data?.[0]?.timestamp || undefined,
  };
}

export interface FacebookPage {
  id: string;
  name: string;
  link?: string;
  website?: string;
  phone?: string;
  fans?: number;
  city?: string;
  lat?: number;
  lng?: number;
  street?: string;
}

/** Only works after Meta approves Page Public Metadata Access for your app. */
export async function facebookPageSearch(opts: { token: string; query: string; max: number }): Promise<FacebookPage[]> {
  const q = new URLSearchParams({
    q: opts.query,
    fields: "id,name,link,location,website,phone,fan_count",
    limit: String(Math.min(opts.max, 50)),
    access_token: opts.token,
  });
  const res = await fetchWithTimeout(`${GRAPH}/pages/search?${q}`, {}, 15_000);
  const json = (await res.json().catch(() => ({}))) as any;
  if (!res.ok || json.error) throw explain(json.error, res.status);
  return (json.data ?? []).map((p: any) => ({
    id: p.id,
    name: p.name,
    link: p.link,
    website: p.website || undefined,
    phone: p.phone || undefined,
    fans: p.fan_count,
    city: p.location?.city,
    lat: p.location?.latitude,
    lng: p.location?.longitude,
    street: p.location?.street,
  }));
}

/** First real (non-Instagram/Facebook/Linktree) link in a website field or bio. */
export function firstRealLink(...texts: Array<string | undefined>): string | undefined {
  for (const t of texts) {
    if (!t) continue;
    for (const m of t.matchAll(/\b((?:https?:\/\/)?(?:www\.)?[a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)*\.(?:com|in|co\.in|net|org|store|shop|online|site|info|biz|co)(?:\/[^\s]*)?)/gi)) {
      const u = m[1];
      if (/instagram\.com|facebook\.com|fb\.com|linktr\.ee|wa\.me|whatsapp\.com|youtube\.com|bit\.ly|gmail\.com|yahoo\.|outlook\./i.test(u)) continue;
      return u.startsWith("http") ? u : `https://${u}`;
    }
  }
  return undefined;
}

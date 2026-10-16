import { fetchPublic } from "../safeFetch";
import { isSocialHost } from "../util";

/**
 * Link-in-bio pages (Linktree, bio.link, Beacons…): many businesses link one from Instagram instead
 * of a website. The page lists their real website, WhatsApp and email. Read the way Scout does it
 * (github.com/kiryano/Scout, app/scrapers/linktree.py, MIT licence): Linktree's page data first,
 * then every link on the page. These pages are public; nothing is logged in to.
 */

const HOSTS = /^(?:www\.)?(linktr\.ee|bio\.link|beacons\.ai|linkr\.bio|lnk\.bio|taplink\.cc|campsite\.bio|solo\.to|stan\.store|linkin\.bio|milkshake\.app|hoo\.be)$/i;
/** Links that are never the business's own website. */
const NOT_A_SITE = /(instagram|facebook|fb|tiktok|youtube|youtu|twitter|x|threads|pinterest|snapchat|spotify|soundcloud|linkedin|t|telegram|discord|reddit|twitch|github|wa|whatsapp|play\.google|apps\.apple|maps\.google|goo|g|bit|tinyurl|amzn|amazon|flipkart|meesho|zomato|swiggy|justdial|indiamart)\.(com|me|be|gl|ly|net|in|page|co|gg|tv|app)\b/i;

export const isLinkInBio = (url?: string) => {
  try {
    return !!url && HOSTS.test(new URL(url.startsWith("http") ? url : `https://${url}`).hostname);
  } catch {
    return false;
  }
};

/** The first link-in-bio address in a website field or bio. */
export function linkInBioIn(...texts: Array<string | undefined>): string | undefined {
  for (const t of texts)
    for (const m of t?.matchAll(/\b((?:https?:\/\/)?(?:www\.)?(?:linktr\.ee|bio\.link|beacons\.ai|linkr\.bio|lnk\.bio|taplink\.cc|campsite\.bio|solo\.to|stan\.store|linkin\.bio|milkshake\.app|hoo\.be)\/[A-Za-z0-9_.-]+)/gi) ?? [])
      return m[1].startsWith("http") ? m[1] : `https://${m[1]}`;
  return undefined;
}

export interface LinkInBio {
  /** Their own website, if one is listed (still to be verified as theirs). */
  website?: string;
  emails: string[];
  /** Numbers from wa.me / WhatsApp and tel: links, digits with country code when given. */
  phones: string[];
}

export function parseLinkInBio(html: string): LinkInBio {
  let urls: string[] = [];
  const data = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (data) {
    try {
      const account = JSON.parse(data[1])?.props?.pageProps?.account;
      urls = ((account?.links ?? []) as Array<{ url?: unknown }>).map((l) => (typeof l.url === "string" ? l.url : "")).filter(Boolean);
    } catch {
      /* fall back to the page's links */
    }
  }
  if (!urls.length) urls = [...html.matchAll(/href="((?:https?:|mailto:|tel:)[^"]+)"/gi)].map((m) => m[1].replace(/&amp;/g, "&"));
  const out: LinkInBio = { emails: [], phones: [] };
  for (const u of urls) {
    if (/^mailto:/i.test(u)) {
      const e = decodeURIComponent(u.slice(7).split("?")[0]).trim().toLowerCase();
      if (/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/.test(e) && !out.emails.includes(e)) out.emails.push(e);
      continue;
    }
    const wa = u.match(/^https?:\/\/(?:wa\.me|api\.whatsapp\.com\/send\?phone=)\/?\+?(\d{10,15})/i) ?? u.match(/^tel:\+?([\d\s-]{10,18})$/i);
    if (wa) {
      const n = wa[1].replace(/\D/g, "");
      if (!out.phones.includes(n)) out.phones.push(n);
      continue;
    }
    if (out.website || !/^https?:\/\//i.test(u)) continue;
    let host = "";
    try {
      host = new URL(u).hostname.replace(/^www\./, "");
    } catch {
      continue;
    }
    if (HOSTS.test(host) || isSocialHost(host) || NOT_A_SITE.test(host)) continue;
    out.website = u;
  }
  return out;
}

export async function readLinkInBio(url: string, f: typeof fetchPublic = fetchPublic): Promise<LinkInBio | undefined> {
  const res = await f(url, { headers: { Accept: "text/html" } }, 10_000).catch(() => undefined);
  if (!res?.ok) return undefined;
  return parseLinkInBio((await res.text()).slice(0, 2_000_000));
}

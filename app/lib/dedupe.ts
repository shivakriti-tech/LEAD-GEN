import type { Lead, RawPlace } from "./types";
import { facebookPage, instagramHandle, socialKey } from "./sources/social";
import { domainOf, isSocialHost, metres, normalizePhone, simplifyName, uid } from "./util";

/**
 * Merge raw places from every source into unique leads.
 * Two places are the same business if they share a phone number, a (non-social)
 * website domain, or a similar name within 150 m.
 */
export function mergePlaces(raw: RawPlace[]): Lead[] {
  const leads: Lead[] = [];
  const byPhone = new Map<string, Lead>();
  const byDomain = new Map<string, Lead>();
  const bySocial = new Map<string, Lead>();

  for (const r of raw) {
    const phone = normalizePhone(r.phone);
    const dom = domainOf(r.website);
    const domKey = dom && !isSocialHost(dom) ? dom : undefined;
    const simple = simplifyName(r.name);

    const soc = socialKey(r.website);
    let match = (phone && byPhone.get(phone)) || (domKey && byDomain.get(domKey)) || (soc && bySocial.get(soc)) || undefined;
    // Instagram/Facebook results have no map position: same exact name in the same city counts as the same business.
    if (!match && (r.lat == null || r.source === "instagram" || r.source === "facebook") && simple.length >= 4) {
      match = leads.find((l) => simplifyName(l.name) === simple && (l.city ?? "").toLowerCase() === (r.city ?? "").toLowerCase());
    }
    if (!match && r.lat != null && r.lng != null) {
      match = leads.find(
        (l) =>
          l.lat != null &&
          l.lng != null &&
          metres(l.lat, l.lng, r.lat!, r.lng!) < 150 &&
          namesAlike(simplifyName(l.name), simple),
      );
    }

    if (match) {
      mergeInto(match, r, phone);
    } else {
      match = {
        id: uid(),
        name: r.name.trim(),
        category: r.category,
        address: r.address,
        city: r.city,
        lat: r.lat,
        lng: r.lng,
        phone,
        phones: phone ? [phone] : [],
        email: r.email?.toLowerCase(),
        emails: r.email ? [r.email.toLowerCase()] : [],
        website: r.website,
        sources: [r.source],
        placeId: r.source === "google" ? r.sourceId : undefined,
        osmId: r.source === "osm" ? r.sourceId : undefined,
        mapsUrl: r.mapsUrl,
        rating: r.rating,
        reviews: r.reviews,
        businessStatus: r.businessStatus,
        brand: r.brand,
        signals: [],
        score: 0,
        tier: "cold",
        whyNow: "",
      };
      leads.push(match);
    }
    if (phone) byPhone.set(phone, match);
    if (domKey) byDomain.set(domKey, match);
    if (soc) bySocial.set(soc, match);
    rememberSocial(match, r.website);
  }
  return leads;
}

function namesAlike(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b || a.includes(b) || b.includes(a)) return true;
  const ta = new Set(a.split(" ")), tb = new Set(b.split(" "));
  const common = [...ta].filter((t) => tb.has(t) && t.length > 2).length;
  return common / Math.min(ta.size, tb.size) >= 0.6;
}

function mergeInto(l: Lead, r: RawPlace, phone?: string) {
  if (!l.sources.includes(r.source)) l.sources.push(r.source);
  // Google data wins for the core fields; fill gaps from anything else.
  const prefer = r.source === "google" || r.source === "gmaps";
  if (prefer || !l.address) l.address = r.address ?? l.address;
  if (prefer && r.name) l.name = r.name.trim();
  if (l.lat == null || prefer) { l.lat = r.lat ?? l.lat; l.lng = r.lng ?? l.lng; }
  if (phone && !l.phones.includes(phone)) l.phones.push(phone);
  l.phone ??= phone;
  if (r.email) { const e = r.email.toLowerCase(); if (!l.emails.includes(e)) l.emails.push(e); l.email ??= e; }
  // a real website beats a social link
  const cur = domainOf(l.website), next = domainOf(r.website);
  if (r.website && (!l.website || (isSocialHost(cur) && !isSocialHost(next)))) l.website = r.website;
  if (r.source === "google") { l.placeId = r.sourceId; l.mapsUrl = r.mapsUrl ?? l.mapsUrl; }
  if (r.source === "gmaps") l.mapsUrl = r.mapsUrl ?? l.mapsUrl;
  if (r.source === "osm") l.osmId = r.sourceId;
  if (r.rating != null) l.rating = r.rating;
  if (r.reviews != null) l.reviews = r.reviews;
  if (r.businessStatus) l.businessStatus = r.businessStatus;
  l.brand ??= r.brand;
}

/** Keep Instagram/Facebook links on the lead even when a real website wins the "website" field. */
export function rememberSocial(l: Lead, url?: string) {
  const ig = instagramHandle(url);
  if (ig) {
    l.social ??= {};
    l.social.instagram ??= { handle: ig, url: `https://www.instagram.com/${ig}/`, checked: "link_only" };
  }
  const fb = facebookPage(url);
  if (fb) {
    l.social ??= {};
    l.social.facebook ??= { page: fb, url: `https://www.facebook.com/${fb}` };
  }
}

/**
 * After websites are crawled we learn which Instagram/Facebook profile each business links to.
 * If a lead found on Instagram/Facebook is that same profile, fold it into the map lead.
 */
export function mergeBySocial(leads: Lead[]): Lead[] {
  const owner = new Map<string, Lead>();
  const out: Lead[] = [];
  const keysOf = (l: Lead) =>
    [l.social?.instagram && `ig:${l.social.instagram.handle}`, l.social?.facebook && `fb:${l.social.facebook.page}`].filter(Boolean) as string[];
  // map/Google leads claim their profiles first
  const ordered = [...leads].sort((a, b) => socialOnly(a) - socialOnly(b));
  for (const l of ordered) {
    const hit = keysOf(l).map((k) => owner.get(k)).find(Boolean);
    if (hit && socialOnly(l)) {
      for (const s of l.sources) if (!hit.sources.includes(s)) hit.sources.push(s);
      for (const p of l.phones) if (!hit.phones.includes(p)) hit.phones.push(p);
      hit.social = { ...l.social, ...hit.social };
      continue;
    }
    for (const k of keysOf(l)) if (!owner.has(k)) owner.set(k, l);
    out.push(l);
  }
  return leads.filter((l) => out.includes(l));
}

const socialOnly = (l: Lead) => (l.sources.every((s) => s === "instagram" || s === "facebook") ? 1 : 0);

import type { RawPlace } from "../types";
import { fetchWithTimeout } from "../util";

/**
 * Google Places API (New) — Text Search.
 * Asking for phone/website/rating puts each request on the Enterprise SKU
 * (1,000 free requests/month at the time of writing). One request = up to 20 places;
 * Google allows at most 3 pages (60 places) per query.
 */
const FIELDS = [
  "places.id",
  "places.displayName",
  "places.formattedAddress",
  "places.location",
  "places.nationalPhoneNumber",
  "places.internationalPhoneNumber",
  "places.websiteUri",
  "places.rating",
  "places.userRatingCount",
  "places.businessStatus",
  "places.googleMapsUri",
  "nextPageToken",
].join(",");

interface GPlace {
  id: string;
  displayName?: { text: string };
  formattedAddress?: string;
  location?: { latitude: number; longitude: number };
  nationalPhoneNumber?: string;
  internationalPhoneNumber?: string;
  websiteUri?: string;
  rating?: number;
  userRatingCount?: number;
  businessStatus?: RawPlace["businessStatus"];
  googleMapsUri?: string;
}

export interface GoogleSearchResult {
  places: RawPlace[];
  requests: number;
}

export async function googleTextSearch(opts: {
  apiKey: string;
  query: string; // "dental clinic in Kothrud, Pune"
  category: string;
  city: string;
  max: number; // up to 60
  sleep?: (ms: number) => Promise<void>;
}): Promise<GoogleSearchResult> {
  const { apiKey, query, category, city } = opts;
  const max = Math.min(Math.max(opts.max, 1), 60);
  const sleep = opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const places: RawPlace[] = [];
  let pageToken: string | undefined;
  let requests = 0;

  do {
    const body: Record<string, unknown> = {
      textQuery: query,
      pageSize: Math.min(20, max - places.length),
      languageCode: "en",
      regionCode: "IN",
    };
    if (pageToken) body.pageToken = pageToken;

    const res = await fetchWithTimeout(
      "https://places.googleapis.com/v1/places:searchText",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Goog-Api-Key": apiKey, "X-Goog-FieldMask": FIELDS },
        body: JSON.stringify(body),
      },
      15_000,
    );
    requests++;
    if (!res.ok) {
      const text = await res.text();
      let msg = text.slice(0, 300);
      try {
        msg = JSON.parse(text)?.error?.message ?? msg;
      } catch {}
      throw new Error(`Google Places ${res.status}: ${msg}`);
    }
    const json = (await res.json()) as { places?: GPlace[]; nextPageToken?: string };
    for (const p of json.places ?? []) places.push(toRaw(p, category, city));
    pageToken = json.nextPageToken;
    // the next page token needs a moment before it becomes valid
    if (pageToken && places.length < max) await sleep(1500);
  } while (pageToken && places.length < max);

  return { places: places.slice(0, max), requests };
}

export function toRaw(p: GPlace, category: string, city: string): RawPlace {
  return {
    source: "google",
    sourceId: p.id,
    name: p.displayName?.text ?? "Unnamed",
    category,
    address: p.formattedAddress,
    city,
    lat: p.location?.latitude,
    lng: p.location?.longitude,
    phone: p.internationalPhoneNumber || p.nationalPhoneNumber,
    website: p.websiteUri,
    rating: p.rating,
    reviews: p.userRatingCount,
    businessStatus: p.businessStatus,
    mapsUrl: p.googleMapsUri,
  };
}

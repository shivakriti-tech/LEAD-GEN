import type { RawPlace } from "../types";
import { crawlerContact, fetchWithTimeout } from "../util";
import { CITY_CENTRES } from "./cityCentres";

/**
 * OpenStreetMap: free, no key. A geocoder turns "Kothrud, Pune" into a bounding box,
 * Overpass returns tagged businesses inside it.
 * Public servers are for light use; data is © OpenStreetMap contributors (ODbL).
 */
export type BBox = { south: number; west: number; north: number; east: number };


const bboxCache = new Map<string, { box: BBox; via: string }>();

function boxAround(lat: number, lng: number, half: number): BBox {
  return { south: lat - half, north: lat + half, west: lng - half, east: lng + half };
}

/** Whole-city boxes can be huge; cap at ~0.35° (≈ 38 km) around the centre to keep Overpass fast. */
function capBox(b: BBox, cap = 0.35): BBox {
  const cLat = (b.south + b.north) / 2, cLng = (b.west + b.east) / 2;
  return {
    south: Math.max(b.south, cLat - cap / 2),
    north: Math.min(b.north, cLat + cap / 2),
    west: Math.max(b.west, cLng - cap / 2),
    east: Math.min(b.east, cLng + cap / 2),
  };
}

async function viaNominatim(place: string): Promise<BBox> {
  const q = new URLSearchParams({ format: "json", limit: "1", countrycodes: "in", q: place });
  const contact = crawlerContact();
  if (contact) q.set("email", contact);
  const res = await fetchWithTimeout(`https://nominatim.openstreetmap.org/search?${q}`, { headers: { "Accept-Language": "en" } }, 12_000);
  if (!res.ok) throw new Error(`Nominatim ${res.status}${res.status === 403 ? " (blocked: set CRAWLER_CONTACT in .env.local to your real email)" : ""}`);
  const arr = (await res.json()) as Array<{ boundingbox: [string, string, string, string] }>;
  if (!arr.length) throw new Error(`Nominatim couldn't find "${place}"`);
  const [s, n, w, e] = arr[0].boundingbox.map(Number);
  return { south: s, north: n, west: w, east: e };
}

async function viaPhoton(place: string): Promise<BBox> {
  const q = new URLSearchParams({ q: `${place}, India`, limit: "1", lang: "en" });
  const res = await fetchWithTimeout(`https://photon.komoot.io/api/?${q}`, {}, 12_000);
  if (!res.ok) throw new Error(`Photon ${res.status}`);
  const json = (await res.json()) as { features?: Array<{ geometry: { coordinates: [number, number] }; properties: { extent?: [number, number, number, number]; type?: string; countrycode?: string } }> };
  const f = json.features?.find((x) => !x.properties.countrycode || x.properties.countrycode === "IN");
  if (!f) throw new Error(`Photon couldn't find "${place}"`);
  const ext = f.properties.extent; // [minLon, maxLat, maxLon, minLat]
  if (ext) return { west: ext[0], north: ext[1], east: ext[2], south: ext[3] };
  const [lng, lat] = f.geometry.coordinates;
  return boxAround(lat, lng, f.properties.type === "city" ? 0.15 : 0.03);
}

function viaBuiltIn(place: string): BBox {
  const words = place.toLowerCase().split(/[,\s]+/).filter(Boolean);
  const hit = CITY_CENTRES.find((c) => c.names.some((n) => words.includes(n) || place.toLowerCase().includes(n)));
  if (!hit) throw new Error(`"${place}" isn't in the built-in city list`);
  return boxAround(hit.lat, hit.lng, 0.15);
}

/**
 * Turn "Kothrud, Pune" into a search box. Tries Nominatim, then Photon, then a built-in
 * list of Indian city centres, so one blocked server doesn't stop the search.
 */
export async function geocodeBBox(place: string, onWarn?: (m: string) => void): Promise<{ box: BBox; via: string }> {
  const key = place.toLowerCase().trim();
  const hit = bboxCache.get(key);
  if (hit) return hit;
  const tries: Array<[string, () => Promise<BBox> | BBox]> = [
    ["Nominatim", () => viaNominatim(place)],
    ["Photon", () => viaPhoton(place)],
    ["built-in city list", () => viaBuiltIn(place)],
  ];
  const errors: string[] = [];
  for (const [via, fn] of tries) {
    try {
      const out = { box: capBox(await fn()), via };
      bboxCache.set(key, out);
      if (errors.length) onWarn?.(`Map lookup: ${errors.join("; ")}. Used ${via} instead.`);
      return out;
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e));
    }
  }
  throw new Error(`Couldn't locate "${place}": ${errors.join("; ")}`);
}

export function buildOverpassQuery(filters: string[], box: BBox, limit: number): string {
  const b = `${box.south},${box.west},${box.north},${box.east}`;
  const parts = filters.map((f) => `nwr${f}["name"](${b});`).join("");
  return `[out:json][timeout:40];(${parts});out center tags ${Math.max(1, limit)};`;
}

interface OsmEl {
  type: "node" | "way" | "relation";
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

export function osmToRaw(el: OsmEl, category: string, city: string): RawPlace | null {
  const t = el.tags ?? {};
  if (!t.name) return null;
  const addr = [t["addr:housenumber"], t["addr:street"], t["addr:suburb"] || t["addr:neighbourhood"], t["addr:city"] || city, t["addr:postcode"]]
    .filter(Boolean)
    .join(", ");
  return {
    source: "osm",
    sourceId: `${el.type}/${el.id}`,
    name: t.name,
    category,
    address: addr || undefined,
    city,
    lat: el.lat ?? el.center?.lat,
    lng: el.lon ?? el.center?.lon,
    phone: (t.phone || t["contact:phone"] || t["contact:mobile"] || "").split(";")[0].trim() || undefined,
    website: t.website || t["contact:website"] || t.url || t["contact:facebook"] || t["contact:instagram"] || undefined,
    email: t.email || t["contact:email"] || undefined,
    businessStatus: t["disused:shop"] || t["disused:amenity"] ? "CLOSED_PERMANENTLY" : undefined,
    brand: t.brand || t["brand:wikidata"] || undefined,
  };
}

const OVERPASS_ENDPOINTS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"];

export async function osmSearch(opts: { place: string; box?: BBox; filters: string[]; category: string; city: string; max: number }): Promise<RawPlace[]> {
  const box = opts.box ?? (await geocodeBBox(opts.place)).box;
  const q = buildOverpassQuery(opts.filters, box, opts.max * 2);
  let lastErr: unknown;
  for (const ep of OVERPASS_ENDPOINTS) {
    try {
      const res = await fetchWithTimeout(ep, { method: "POST", body: "data=" + encodeURIComponent(q), headers: { "Content-Type": "application/x-www-form-urlencoded" } }, 45_000);
      if (!res.ok) throw new Error(`Overpass ${res.status}`);
      const json = (await res.json()) as { elements: OsmEl[] };
      const out = json.elements.map((e) => osmToRaw(e, opts.category, opts.city)).filter((x): x is RawPlace => !!x);
      // prefer entries that have some way to contact them
      out.sort((a, b) => Number(!!b.phone || !!b.website) - Number(!!a.phone || !!a.website));
      return out.slice(0, opts.max);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("Overpass failed");
}

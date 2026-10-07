import { currentMarket } from "../marketContext";
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

/** Whole-city boxes can be huge; cap at ~0.35° (≈ 38 km) around the centre to keep Overpass fast. Tiny ones are widened. */
export function capBox(b: BBox, cap = 0.35, min = 0.024): BBox {
  const cLat = (b.south + b.north) / 2, cLng = (b.west + b.east) / 2;
  // a neighbourhood that the geocoder knows only as a point gets at least ~2.6 km across
  if (b.north - b.south < min) b = { ...b, south: cLat - min / 2, north: cLat + min / 2 };
  if (b.east - b.west < min) b = { ...b, west: cLng - min / 2, east: cLng + min / 2 };
  return {
    south: Math.max(b.south, cLat - cap / 2),
    north: Math.min(b.north, cLat + cap / 2),
    west: Math.max(b.west, cLng - cap / 2),
    east: Math.min(b.east, cLng + cap / 2),
  };
}

async function viaNominatim(place: string): Promise<BBox> {
  const q = new URLSearchParams({ format: "json", limit: "1", countrycodes: currentMarket().cc, q: place });
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
  const q = new URLSearchParams({ q: `${place}, ${currentMarket().name}`, limit: "1", lang: "en" });
  const res = await fetchWithTimeout(`https://photon.komoot.io/api/?${q}`, {}, 12_000);
  if (!res.ok) throw new Error(`Photon ${res.status}`);
  const json = (await res.json()) as { features?: Array<{ geometry: { coordinates: [number, number] }; properties: { extent?: [number, number, number, number]; type?: string; countrycode?: string } }> };
  const f = json.features?.find((x) => !x.properties.countrycode || x.properties.countrycode === currentMarket().code);
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
  const key = `${currentMarket().code}|${place.toLowerCase().trim()}`;
  const hit = bboxCache.get(key);
  if (hit) return hit;
  const tries: Array<[string, () => Promise<BBox> | BBox]> = [
    ["Nominatim", () => viaNominatim(place)],
    ["Photon", () => viaPhoton(place)],
    // the built-in list only knows Indian cities
    ...(currentMarket().code === "IN" ? [["built-in city list", () => viaBuiltIn(place)] as [string, () => BBox]] : []),
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

export interface OsmEl {
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

/** Public Overpass servers (see wiki.openstreetmap.org/wiki/Overpass_API). Each allows ~2 queries at a time per computer. */
export const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];
let nextEndpoint = 0;
const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Run an Overpass query. A busy server says so in several ways: HTTP 429/503/504, a timeout, or
 * HTTP 200 with a "runtime error" remark and no data. That last one used to look like "no businesses
 * here"; now all of them count as failures.
 *
 * Servers are raced, not tried one after another: the query goes to one server, and if it hasn't
 * answered within `hedgeMs` (4s) or fails, also to the next. The first good answer wins and the
 * rest are cancelled, so one overloaded server costs seconds, not a minute. If every server failed
 * quickly, wait and try them all once more; if they all timed out, they're overloaded: give up.
 */
export async function overpass(query: string, opts: { endpoints?: string[]; sleep?: (ms: number) => Promise<void>; timeoutMs?: number; hedgeMs?: number } = {}): Promise<OsmEl[]> {
  const eps = opts.endpoints ?? OVERPASS_ENDPOINTS;
  const sleep = opts.sleep ?? wait;
  const start = nextEndpoint++;
  const order = eps.map((_, k) => eps[(start + k) % eps.length]);
  let errors: string[] = [];
  for (let round = 0; round < 2; round++) {
    if (round) await sleep(10_000);
    errors = [];
    const began = Date.now();
    const cancel = new AbortController();
    try {
      return await hedged(order.length, async (k) => {
        const ep = order[k];
        const host = new URL(ep).host;
        try {
          const res = await fetchWithTimeout(ep, { method: "POST", body: "data=" + encodeURIComponent(query), headers: { "Content-Type": "application/x-www-form-urlencoded" }, signal: cancel.signal }, opts.timeoutMs ?? 45_000);
          if (!res.ok) throw new Error(`HTTP ${res.status}${res.status === 429 ? " too many requests" : res.status === 503 || res.status === 504 ? " busy" : ""}`);
          const json = (await res.json()) as { elements?: OsmEl[]; remark?: string };
          if (json.remark && /runtime error|timed out|rate_limited|out of memory|too many/i.test(json.remark)) throw new Error("busy");
          if (!Array.isArray(json.elements)) throw new Error("unexpected answer");
          return json.elements;
        } catch (e) {
          const m = e instanceof Error ? e.message : String(e);
          errors.push(`${host}: ${/abort/i.test(m) ? "timed out" : m}`);
          throw e;
        }
      }, opts.hedgeMs ?? 4000);
    } catch {
      if (Date.now() - began > 30_000) break; // they all timed out: overloaded, another round won't help
    } finally {
      cancel.abort(); // the slower servers' requests aren't needed any more
    }
  }
  throw new Error(`map servers are busy (${errors.join("; ")}). Try again in a few minutes`);
}

/**
 * Run attempt 0 now, and attempt k+1 when attempt k fails or after `hedgeMs` without an answer.
 * Resolves with the first success; rejects when all `n` failed.
 */
function hedged<T>(n: number, run: (k: number) => Promise<T>, hedgeMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let started = 0, failed = 0, settled = false;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const finish = () => {
      settled = true;
      timers.forEach(clearTimeout);
    };
    const launch = () => {
      if (settled || started >= n) return;
      const k = started++;
      if (started < n) timers.push(setTimeout(launch, hedgeMs));
      run(k).then(
        (v) => {
          if (settled) return;
          finish();
          resolve(v);
        },
        (e) => {
          if (settled) return;
          if (++failed === n) {
            finish();
            reject(e);
          } else launch();
        },
      );
    };
    launch();
  });
}

/** One Overpass tag filter (`["shop"="clothes"]`, `["name"~"traders",i]`, `["school"!="public"]`, `["office"]`, `[!"brand"]`) as parts. */
const FILTER_PART = /\[\s*(!?)"([^"]+)"\s*(?:(=|!=|~|!~)\s*"([^"]*)"\s*(,\s*i)?)?\s*\]/g;

/** Do these tags pass this filter, the way Overpass reads it? Pure, exported for tests. */
export function matchesFilter(filter: string, tags: Record<string, string> = {}): boolean {
  for (const m of filter.matchAll(FILTER_PART)) {
    const [, not, k, op, v = "", ci] = m;
    const t = tags[k];
    if (!op) {
      if ((t === undefined) !== !!not) return false; // ["k"]: has the tag; [!"k"]: doesn't
    } else if (op === "=") {
      if (t !== v) return false;
    } else if (op === "!=") {
      if (t === v) return false;
    } else {
      let re: RegExp;
      try {
        re = new RegExp(v, ci ? "i" : "");
      } catch {
        return false;
      }
      const hit = t !== undefined && re.test(t);
      if (op === "~" ? !hit : hit) return false;
    }
  }
  return true;
}

/** Several business types in one Overpass query: one `out` per type, so each keeps its own limit. */
export function buildBatchQuery(groups: Array<{ filters: string[]; limit: number }>, box: BBox): string {
  const b = `${box.south},${box.west},${box.north},${box.east}`;
  const body = groups.map((g, i) => `(${g.filters.map((f) => `nwr${f}["name"](${b});`).join("")})->.s${i};.s${i} out center tags ${Math.max(1, g.limit)};`).join("");
  return `[out:json][timeout:60];${body}`;
}

type OsmOpts = { place: string; box?: BBox; filters: string[]; category: string; city: string; max: number };
type Waiting = { opts: OsmOpts; resolve: (r: RawPlace[]) => void; reject: (e: unknown) => void };
const batches = new Map<string, Waiting[]>();

function placesFor(elements: OsmEl[], opts: OsmOpts): RawPlace[] {
  const seen = new Set<string>();
  const out: RawPlace[] = [];
  for (const e of elements) {
    const id = `${e.type}/${e.id}`;
    if (seen.has(id) || !opts.filters.some((f) => matchesFilter(f, e.tags))) continue;
    seen.add(id);
    const r = osmToRaw(e, opts.category, opts.city);
    if (r) out.push(r);
  }
  // prefer entries that have some way to contact them
  out.sort((a, b) => Number(!!b.phone || !!b.website) - Number(!!a.phone || !!a.website));
  return out.slice(0, opts.max);
}

/**
 * Businesses of one type in a place. Types asked for at the same moment for the same area go to
 * the map servers as ONE query (public servers allow only ~2 queries at a time per computer, so
 * 6 separate queries meant waiting in line), and the answer is split back by type.
 */
export async function osmSearch(opts: OsmOpts, batchMs = 25): Promise<RawPlace[]> {
  const box = opts.box ?? (await geocodeBBox(opts.place)).box;
  const key = `${currentMarket().code}|${JSON.stringify(box)}`;
  return new Promise<RawPlace[]>((resolve, reject) => {
    let waiting = batches.get(key);
    if (!waiting) {
      waiting = [];
      batches.set(key, waiting);
      setTimeout(async () => {
        const group = batches.get(key) ?? [];
        batches.delete(key);
        try {
          const elements = await overpass(buildBatchQuery(group.map((w) => ({ filters: w.opts.filters, limit: w.opts.max * 2 })), box));
          for (const w of group) w.resolve(placesFor(elements, w.opts));
        } catch (e) {
          for (const w of group) w.reject(e);
        }
      }, batchMs);
    }
    waiting.push({ opts: { ...opts, box }, resolve, reject });
  });
}

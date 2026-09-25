/**
 * Builds the Vadodara benchmark:
 *   bench/vadodara.cases.json   the businesses
 *   bench/vadodara.labels.csv   your hand-checked answers (new businesses are added as new rows;
 *                               rows you already have are never changed)
 *
 *   npm run bench:build                          OpenStreetMap (free, but thin in Vadodara)
 *   npm run bench:build -- --source=gmaps        Google Maps scraper (GMAPS_SCRAPER_URL, ~3 min per type)
 *   npm run bench:build -- --source=google       Google Places (GOOGLE_PLACES_API_KEY, ~1 request per type)
 *   npm run bench:build -- --source=gmaps --types=dentist,salon,cafe --per=20
 *   npm run bench:build -- --reset               start the business list again (labels are kept)
 *
 * Businesses already in the list are kept, so you can run it once per source to combine them.
 */
import { existsSync, promises as fs } from "node:fs";
import path from "node:path";
import { CATEGORIES } from "../lib/categories";
import { geocodeBBox, osmSearch } from "../lib/sources/osm";
import { googleTextSearch } from "../lib/sources/googlePlaces";
import { gmapsScrapeBatch, gmapsScraperUrl, parseCsv } from "../lib/sources/gmapsScraper";
import { LABEL_COLUMNS, type BenchCase } from "../lib/bench";
import { normalizePhone, simplifyName } from "../lib/util";
import type { RawPlace } from "../lib/types";

try {
  process.loadEnvFile(".env.local");
} catch {}

const CITY = "Vadodara";
const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
const SOURCE = (arg("source") ?? "osm") as "osm" | "gmaps" | "google";
const ALL_TYPES = ["dentist", "skin", "physio", "clinic", "salon", "gym", "restaurant", "cafe", "coaching", "realestate", "interior", "ca", "hotel", "furniture", "retail"];
const TYPES = arg("types")?.split(",").map((t) => t.trim()) ?? ALL_TYPES;
const PER = Number(arg("per")) || (SOURCE === "osm" ? 12 : 20);
const dir = path.join(process.cwd(), "bench");
const casesFile = path.join(dir, "vadodara.cases.json");
const labelsFile = path.join(dir, "vadodara.labels.csv");

async function fetchPlaces(): Promise<RawPlace[]> {
  const cats = TYPES.map((k) => {
    const c = CATEGORIES.find((x) => x.key === k);
    if (!c) throw new Error(`Unknown business type "${k}". Use: ${ALL_TYPES.join(", ")}`);
    return c;
  });
  const out: RawPlace[] = [];

  if (SOURCE === "gmaps") {
    const baseUrl = gmapsScraperUrl();
    if (!baseUrl) throw new Error("Set GMAPS_SCRAPER_URL in .env.local and start the scraper (see README, Google Maps scraper).");
    console.log(`Google Maps scraper: ${cats.length} business types, about 2–4 minutes each. Watch progress at ${baseUrl}.`);
    const results = await gmapsScrapeBatch({
      baseUrl, city: CITY, max: PER,
      requests: cats.map((c) => ({ category: c.label, keyword: `${c.google} in ${CITY}` })),
      onProgress: (m) => console.log(`  ${m}`),
    });
    for (const r of results) {
      if (r.error) console.warn(`${r.category}: ${r.error}`);
      out.push(...r.places);
    }
    return out;
  }

  if (SOURCE === "google") {
    const apiKey = process.env.GOOGLE_PLACES_API_KEY;
    if (!apiKey) throw new Error("Set GOOGLE_PLACES_API_KEY in .env.local.");
    let requests = 0;
    for (const c of cats) {
      try {
        const r = await googleTextSearch({ apiKey, query: `${c.google} in ${CITY}`, category: c.label, city: CITY, max: PER });
        requests += r.requests;
        out.push(...r.places);
        console.log(`${c.label}: ${r.places.length}`);
      } catch (e) {
        console.warn(`${c.label}: failed (${e instanceof Error ? e.message : e})`);
      }
    }
    console.log(`Used ${requests} Google Places requests.`);
    return out;
  }

  const { box, via } = await geocodeBBox(CITY, (m) => console.warn(m));
  console.log(`Vadodara located via ${via}.`);
  for (const c of cats) {
    try {
      const places = await osmSearch({ place: CITY, box, filters: c.osm, category: c.label, city: CITY, max: PER });
      out.push(...places);
      console.log(`${c.label}: ${places.length}`);
    } catch (e) {
      console.warn(`${c.label}: failed (${e instanceof Error ? e.message : e})`);
    }
    await new Promise((r) => setTimeout(r, 1500)); // be gentle with the public Overpass server
  }
  return out;
}

/** OSM ids stay as before ("node/123") so existing labels still match. */
const caseId = (p: RawPlace) => (p.source === "osm" ? p.sourceId : `${p.source}/${p.sourceId}`);

async function main() {
  const existing: BenchCase[] = !process.argv.includes("--reset") && existsSync(casesFile) ? JSON.parse(await fs.readFile(casesFile, "utf8")) : [];
  // the same business from another source (same phone, or same name) isn't added twice
  const seenIds = new Set(existing.map((c) => c.id));
  const seenPhones = new Set(existing.map((c) => normalizePhone(c.phone)).filter(Boolean));
  const seenNames = new Set(existing.map((c) => simplifyName(c.name)));

  const places = await fetchPlaces();
  const added: BenchCase[] = [];
  for (const p of places) {
    if (p.businessStatus === "CLOSED_PERMANENTLY") continue;
    const id = caseId(p), phone = normalizePhone(p.phone), name = simplifyName(p.name);
    if (seenIds.has(id) || (phone && seenPhones.has(phone)) || seenNames.has(name)) continue;
    seenIds.add(id);
    if (phone) seenPhones.add(phone);
    seenNames.add(name);
    added.push({
      id, source: p.source === "osm" || p.source === "google" || p.source === "gmaps" ? p.source : undefined,
      name: p.name, category: p.category, city: CITY, address: p.address, phone: p.phone, email: p.email, lat: p.lat, lng: p.lng,
      knownWebsite: p.website, brand: p.brand, owner: p.owner, rating: p.rating, reviews: p.reviews,
    });
  }
  const cases = [...existing, ...added];
  await fs.writeFile(casesFile, JSON.stringify(cases, null, 1));
  const withSite = cases.filter((c) => c.knownWebsite ?? c.osmWebsite).length;
  console.log(`\nAdded ${added.length} businesses. bench/vadodara.cases.json now has ${cases.length} (${withSite} with a listed website).`);

  // labels: add rows for the new businesses, never touch existing rows
  const esc = (v?: string | number) => {
    const t = v == null ? "" : String(v);
    const s = /^[=+\-@\t\r]/.test(t) && !/^[+-]?[\d\s().-]+$/.test(t) ? `'${t}` : t; // no spreadsheet formulas
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const row = (c: BenchCase) => [c.id, c.name, c.category, c.phone, c.address, c.knownWebsite ?? c.osmWebsite, "", "", "", "", "", ""].map(esc).join(",");
  if (!existsSync(labelsFile)) {
    await fs.writeFile(labelsFile, [LABEL_COLUMNS.join(","), ...cases.map(row)].join("\r\n"));
    console.log("Created bench/vadodara.labels.csv: fill in what you check by hand (see bench/README.md).");
    return;
  }
  const current = await fs.readFile(labelsFile, "utf8");
  const have = new Set(parseCsv(current).map((r) => r.id));
  const newRows = cases.filter((c) => !have.has(c.id)).map(row);
  if (newRows.length) {
    await fs.writeFile(labelsFile, current.replace(/\s*$/, "") + "\r\n" + newRows.join("\r\n"));
    console.log(`Added ${newRows.length} new rows to bench/vadodara.labels.csv (your existing rows are unchanged).`);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});

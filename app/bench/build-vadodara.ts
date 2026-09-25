/**
 * Builds the Vadodara benchmark from OpenStreetMap (free, no key):
 *   bench/vadodara.cases.json   the businesses (re-created each time you run this)
 *   bench/vadodara.labels.csv   your hand-checked answers (only created if missing, never overwritten)
 *
 *   npm run bench:build
 */
import { existsSync, promises as fs } from "node:fs";
import path from "node:path";
import { CATEGORIES } from "../lib/categories";
import { geocodeBBox, osmSearch } from "../lib/sources/osm";
import { LABEL_COLUMNS, type BenchCase } from "../lib/bench";

try {
  process.loadEnvFile(".env.local");
} catch {}

const CITY = "Vadodara";
const KEYS = ["dentist", "skin", "physio", "clinic", "salon", "gym", "restaurant", "cafe", "coaching", "realestate", "interior", "ca", "hotel", "furniture", "retail"];
const PER = Number(process.argv.find((a) => a.startsWith("--per="))?.slice(6)) || 12;
const dir = path.join(process.cwd(), "bench");

async function main() {
  const { box, via } = await geocodeBBox(CITY, (m) => console.warn(m));
  console.log(`Vadodara located via ${via}.`);
  const cases: BenchCase[] = [];
  const seen = new Set<string>();
  for (const key of KEYS) {
    const c = CATEGORIES.find((x) => x.key === key)!;
    try {
      const places = await osmSearch({ place: CITY, box, filters: c.osm, category: c.label, city: CITY, max: PER });
      let added = 0;
      for (const p of places) {
        if (seen.has(p.sourceId)) continue;
        seen.add(p.sourceId);
        cases.push({ id: p.sourceId, name: p.name, category: p.category, city: CITY, address: p.address, phone: p.phone, email: p.email, lat: p.lat, lng: p.lng, osmWebsite: p.website });
        added++;
      }
      console.log(`${c.label}: ${added}`);
    } catch (e) {
      console.warn(`${c.label}: failed (${e instanceof Error ? e.message : e})`);
    }
    await new Promise((r) => setTimeout(r, 1500)); // be gentle with the public Overpass server
  }
  await fs.writeFile(path.join(dir, "vadodara.cases.json"), JSON.stringify(cases, null, 1));
  const withSite = cases.filter((c) => c.osmWebsite).length;
  console.log(`\n${cases.length} businesses saved to bench/vadodara.cases.json (${withSite} have a website on OpenStreetMap).`);

  const labels = path.join(dir, "vadodara.labels.csv");
  if (existsSync(labels)) {
    console.log("bench/vadodara.labels.csv already exists, left as it is.");
    return;
  }
  const esc = (v?: string) => {
    const s = v && /^[=+\-@\t\r]/.test(v) && !/^[+-]?[\d\s().-]+$/.test(v) ? `'${v}` : v ?? ""; // no spreadsheet formulas
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const rows = cases.map((c) => [c.id, c.name, c.category, c.phone, c.address, c.osmWebsite, "", "", "", "", "", ""].map(esc).join(","));
  await fs.writeFile(labels, [LABEL_COLUMNS.join(","), ...rows].join("\r\n"));
  console.log("Created bench/vadodara.labels.csv: fill in what you check by hand (see bench/README.md).");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

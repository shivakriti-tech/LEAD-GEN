import { describe, expect, it } from "vitest";
import { CATEGORIES } from "@/lib/categories";
import { afterEach, vi } from "vitest";
import { buildBatchQuery, buildOverpassQuery, matchesFilter, osmSearch } from "@/lib/sources/osm";

// one Overpass tag filter: ["key"], [!"key"], ["key"="v"], ["key"!="v"], ["key"~"re"], ["key"~"re",i], ["key"!~"re",i]
const FILTER = /^(\[(!?"[^"]+")(\s*(=|!=|~|!~)\s*"[^"]*"(,i)?)?\])+$/;

describe("OpenStreetMap filters", () => {
  it("are all valid Overpass filters (a bad one fails the whole query)", () => {
    for (const c of CATEGORIES) for (const f of c.osm) expect(f, `${c.key}: ${f}`).toMatch(FILTER);
    const q = buildOverpassQuery(CATEGORIES.find((c) => c.key === "pharma")!.osm, { south: 22.2, west: 73.1, north: 22.4, east: 73.3 }, 40);
    expect(q.match(/\(/g)!.length).toBe(q.match(/\)/g)!.length);
  });

  it("find factories by name, since Indian factories are rarely tagged by product", () => {
    const pharma = CATEGORIES.find((c) => c.key === "pharma")!.osm;
    const re = (f: string) => new RegExp(f.match(/\["name"~"([^"]+)",i\]/)![1], "i");
    const byName = pharma.filter((f) => f.includes('["name"~'));
    expect(byName.length).toBeGreaterThan(3);
    expect(re(byName[0]).test("Alembic Pharmaceuticals Ltd")).toBe(true);
    expect(re(byName[0]).test("Sun Life Sciences")).toBe(true);
    // an estate is not a business
    const estate = CATEGORIES.find((c) => c.key === "manufacturer")!.osm.find((f) => f.includes('"landuse"'))!;
    expect(new RegExp(estate.match(/\["name"!~"([^"]+)",i\]/)![1], "i").test("Makarpura GIDC")).toBe(true);
    for (const k of ["textile", "chemical", "food_proc", "engineering", "exporter", "importer", "distributor"]) expect(CATEGORIES.find((c) => c.key === k)!.osm.length, k).toBeGreaterThan(1);
  });
});

describe("several business types in one map query", () => {
  afterEach(() => vi.unstubAllGlobals());
  const box = { south: 22.2, west: 73.1, north: 22.4, east: 73.3 };

  it("reads filters the way Overpass does", () => {
    expect(matchesFilter('["amenity"="dentist"]', { amenity: "dentist" })).toBe(true);
    expect(matchesFilter('["amenity"="dentist"]', { amenity: "clinic" })).toBe(false);
    expect(matchesFilter('["amenity"="school"]["school"!="public"]', { amenity: "school", school: "public" })).toBe(false);
    expect(matchesFilter('["amenity"="school"]["school"!="public"]', { amenity: "school" })).toBe(true);
    expect(matchesFilter('["shop"]["name"~"distribut|stockist",i]', { shop: "yes", name: "Shah DISTRIBUTORS" })).toBe(true);
    expect(matchesFilter('["shop"]["name"~"distribut|stockist",i]', { name: "Shah Distributors" })).toBe(false);
    expect(matchesFilter('["name"!~"GIDC|estate",i]', { name: "Makarpura gidc" })).toBe(false);
    expect(matchesFilter('[!"brand"]', { name: "x" })).toBe(true);
    expect(matchesFilter('[!"brand"]', { brand: "KFC" })).toBe(false);
    // every filter the app uses parses: an element with exactly the tags it names passes it
    for (const c of CATEGORIES) for (const f of c.osm) {
      const tags: Record<string, string> = {};
      for (const m of f.matchAll(/\["([^"]+)"(?:=|$|\])"?([^"\]]*)/g)) tags[m[1]] = m[2] || "x";
      expect(typeof matchesFilter(f, tags), f).toBe("boolean");
    }
  });

  it("gives each type its own limit, with balanced brackets", () => {
    const q = buildBatchQuery([{ filters: ['["amenity"="dentist"]'], limit: 40 }, { filters: ['["shop"="beauty"]', '["shop"="hairdresser"]'], limit: 20 }], box);
    expect(q).toContain(".s0 out center tags 40;");
    expect(q).toContain(".s1 out center tags 20;");
    expect(q.match(/\(/g)!.length).toBe(q.match(/\)/g)!.length);
  });

  it("sends types searched together as one query and splits the answer back", async () => {
    let calls = 0;
    vi.stubGlobal("fetch", async () => {
      calls++;
      const el = (id: number, tags: Record<string, string>) => ({ type: "node", id, lat: 22.3, lon: 73.2, tags });
      return new Response(JSON.stringify({ elements: [el(1, { amenity: "dentist", name: "Aum Dental" }), el(2, { shop: "hairdresser", name: "Glow Salon", phone: "+91 98250 11111" }), el(3, { shop: "beauty", name: "Rose Beauty" })] }), { headers: { "Content-Type": "application/json" } });
    });
    const [dent, salon] = await Promise.all([
      osmSearch({ place: "Vadodara", box, filters: ['["amenity"="dentist"]'], category: "Dentist", city: "Vadodara", max: 10 }),
      osmSearch({ place: "Vadodara", box, filters: ['["shop"="beauty"]', '["shop"="hairdresser"]'], category: "Salon", city: "Vadodara", max: 10 }),
    ]);
    expect(calls).toBe(1);
    expect(dent.map((p) => p.name)).toEqual(["Aum Dental"]);
    expect(salon.map((p) => p.name)).toEqual(["Glow Salon", "Rose Beauty"]); // with a phone first
    expect(salon.every((p) => p.category === "Salon")).toBe(true);
  });
});

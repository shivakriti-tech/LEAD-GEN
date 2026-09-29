import { describe, expect, it } from "vitest";
import { CATEGORIES } from "@/lib/categories";
import { buildOverpassQuery } from "@/lib/sources/osm";

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

import { describe, expect, it } from "vitest";
import { gmapsScrapeBatch, gmapsScraperUrl, parseCsv, rowToRaw } from "@/lib/sources/gmapsScraper";

const CSV = [
  "input_id,link,title,category,address,website,phone,review_count,review_rating,latitude,longitude,status,place_id,emails",
  '1,https://maps.google.com/?cid=11,Kala Furnishers,Furniture store,"Gotri Rd, Vadodara, Gujarat 390021",https://kalafurnishers.com/,090990 12345,120,4.6,22.3101,73.1402,Open,ChIJ11,"info@kalafurnishers.com, sales@kalafurnishers.com"',
  '2,https://maps.google.com/?cid=22,"Shree ""Ganesh"" Furniture",Furniture store,"Line one\nAkota, Vadodara",,+91 98250 44444,"1,204",4.2,22.29,73.17,Permanently closed,ChIJ22,',
  "",
].join("\n");

describe("Google Maps scraper (testing only)", () => {
  it("is switched off in live builds", () => {
    expect(gmapsScraperUrl({ GMAPS_SCRAPER_URL: "http://localhost:8090/", NODE_ENV: "development" })).toBe("http://localhost:8090");
    expect(gmapsScraperUrl({ GMAPS_SCRAPER_URL: "http://localhost:8090", NODE_ENV: "production" })).toBeUndefined();
    expect(gmapsScraperUrl({ GMAPS_SCRAPER_URL: "http://localhost:8090", VERCEL: "1" })).toBeUndefined();
    expect(gmapsScraperUrl({ NODE_ENV: "development" })).toBeUndefined();
  });

  it("parses the scraper's CSV, including quotes and line breaks", () => {
    const rows = parseCsv(CSV);
    expect(rows).toHaveLength(2);
    expect(rows[1].title).toBe('Shree "Ganesh" Furniture');
    expect(rows[1].address).toBe("Line one\nAkota, Vadodara");
    expect(rows[1].review_count).toBe("1,204");
  });

  it("maps rows to leads", () => {
    const [a, b] = parseCsv(CSV).map((r) => rowToRaw(r, "Furniture shop", "Vadodara")!);
    expect(a).toMatchObject({ source: "gmaps", sourceId: "ChIJ11", name: "Kala Furnishers", phone: "090990 12345", website: "https://kalafurnishers.com/", email: "info@kalafurnishers.com", rating: 4.6, reviews: 120, lat: 22.3101 });
    expect(b).toMatchObject({ reviews: 1204, businessStatus: "CLOSED_PERMANENTLY", website: undefined, email: undefined });
  });

  it("queues jobs, waits for them and downloads the results", async () => {
    const calls: string[] = [];
    let t = 0;
    let polls = 0;
    const fake = (async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? "GET"} ${url.replace("http://localhost:8090", "")}`);
      if (init?.method === "POST") {
        const body = JSON.parse(String(init.body));
        expect(body).toMatchObject({ keywords: ["furniture shop in Vadodara"], lang: "en", depth: 2, email: true });
        return new Response(JSON.stringify({ id: "job-1" }), { status: 201 });
      }
      if (init?.method === "DELETE") return new Response("", { status: 200 });
      if (url.endsWith("/api/v1/jobs")) return new Response("[]", { status: 200 });
      if (url.endsWith("/download")) return new Response(CSV, { status: 200 });
      polls++;
      return new Response(JSON.stringify({ ID: "job-1", Status: polls < 2 ? "working" : "ok" }), { status: 200 });
    }) as typeof fetch;
    const r = await gmapsScrapeBatch(
      { baseUrl: "http://localhost:8090", city: "Vadodara", max: 20, requests: [{ category: "Furniture shop", keyword: "furniture shop in Vadodara" }] },
      { fetch: fake, sleep: async () => { t += 5000; }, now: () => t },
    );
    expect(r[0].places.map((p) => p.name)).toEqual(["Kala Furnishers", 'Shree "Ganesh" Furniture']);
    expect(calls.slice(0, 5)).toEqual(["GET /api/v1/jobs", "POST /api/v1/jobs", "GET /api/v1/jobs/job-1", "GET /api/v1/jobs/job-1", "GET /api/v1/jobs/job-1/download"]);
  });

  it("runs jobs one at a time and clears leftovers from a stopped search", async () => {
    const calls: string[] = [];
    let t = 0;
    let n = 0;
    const fake = (async (url: string, init?: RequestInit) => {
      const u = url.replace("http://localhost:8090", "");
      calls.push(`${init?.method ?? "GET"} ${u}`);
      if (init?.method === "POST") return new Response(JSON.stringify({ id: `job-${++n}` }), { status: 201 });
      if (init?.method === "DELETE") return new Response("", { status: 200 });
      if (u === "/api/v1/jobs") return new Response(JSON.stringify([{ ID: "old", Name: "lead-autopilot cafe in Vadodara", Status: "pending" }, { ID: "mine", Name: "something else", Status: "pending" }]), { status: 200 });
      if (u.endsWith("/download")) return new Response(CSV, { status: 200 });
      return new Response(JSON.stringify({ Status: "ok" }), { status: 200 });
    }) as typeof fetch;
    const r = await gmapsScrapeBatch(
      { baseUrl: "http://localhost:8090", city: "Vadodara", max: 20, requests: [{ category: "A", keyword: "a in Vadodara" }, { category: "B", keyword: "b in Vadodara" }] },
      { fetch: fake, sleep: async () => { t += 5000; }, now: () => t },
    );
    expect(calls).toContain("DELETE /api/v1/jobs/old");
    expect(calls).not.toContain("DELETE /api/v1/jobs/mine");
    // second job is only queued after the first one is downloaded
    expect(calls.indexOf("POST /api/v1/jobs", calls.indexOf("GET /api/v1/jobs/job-1/download"))).toBeGreaterThan(-1);
    expect(calls.filter((c) => c === "POST /api/v1/jobs")).toHaveLength(2);
    expect(r.map((x) => x.places.length)).toEqual([2, 2]);
  });

  it("gives up on a job the scraper never starts, and doesn't queue the rest", async () => {
    let t = 0, posts = 0;
    const fake = (async (url: string, init?: RequestInit) => {
      if (init?.method === "POST") { posts++; return new Response(JSON.stringify({ id: "j" }), { status: 201 }); }
      if (url.endsWith("/api/v1/jobs")) return new Response("[]", { status: 200 });
      return new Response(JSON.stringify({ Status: "pending" }), { status: 200 });
    }) as typeof fetch;
    const r = await gmapsScrapeBatch(
      { baseUrl: "http://localhost:8090", city: "Vadodara", max: 20, requests: [{ category: "A", keyword: "a" }, { category: "B", keyword: "b" }] },
      { fetch: fake, sleep: async () => { t += 5000; }, now: () => t },
    );
    expect(r[0].error).toMatch(/never started this job in 5 minutes.*docker logs/);
    expect(r[1].error).toMatch(/skipped/);
    expect(posts).toBe(1);
    expect(t).toBeLessThan(330_000);
  });

  it("explains when the scraper isn't running", async () => {
    const fake = (async () => { throw new TypeError("fetch failed"); }) as typeof fetch;
    const r = await gmapsScrapeBatch(
      { baseUrl: "http://localhost:8090", city: "Vadodara", max: 20, requests: [{ category: "Café & bakery", keyword: "cafe in Vadodara" }] },
      { fetch: fake, sleep: async () => {}, now: () => 0 },
    );
    expect(r[0].error).toMatch(/scraper not running at http:\/\/localhost:8090/);
  });
});

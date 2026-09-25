import { afterEach, describe, expect, it, vi } from "vitest";
import { facebookPage, instagramHandle, nameFromTitle, socialQuery, socialSearch } from "@/lib/sources/social";
import { firstRealLink, instagramBusinessDiscovery, MetaError, facebookPageSearch } from "@/lib/sources/meta";
import { mergeBySocial, mergePlaces } from "@/lib/dedupe";

afterEach(() => vi.unstubAllGlobals());

describe("profile links", () => {
  it.each([
    ["https://www.instagram.com/brewbloom.cafe/?hl=en", "brewbloom.cafe"],
    ["instagram.com/Sharma_Dental", "sharma_dental"],
    ["https://www.instagram.com/p/C8xYz/", undefined],
    ["https://www.instagram.com/reel/abc/", undefined],
    ["https://www.instagram.com/explore/tags/vadodara/", undefined],
    ["https://example.com/brewbloom", undefined],
  ])("instagram %s → %s", (u, want) => expect(instagramHandle(u)).toBe(want));
  it.each([
    ["https://m.facebook.com/SharmaDentalVadodara/about", "sharmadentalvadodara"],
    ["https://www.facebook.com/p/Aum-Clinic-100063/", "aum-clinic-100063"],
    ["https://www.facebook.com/groups/vadodarafoodies", undefined],
    ["https://www.facebook.com/events/123", undefined],
    ["https://www.facebook.com/profile.php?id=1000", undefined],
  ])("facebook %s → %s", (u, want) => expect(facebookPage(u)).toBe(want));
});

describe("search results → leads", () => {
  it("reads names out of titles", () => {
    expect(nameFromTitle("instagram", "Brew & Bloom Café (@brewbloom.cafe) • Instagram photos and videos", "brewbloom.cafe")).toBe("Brew & Bloom Café");
    expect(nameFromTitle("facebook", "Sharma Dental Care | Vadodara | Facebook", "x")).toBe("Sharma Dental Care");
    expect(nameFromTitle("facebook", "Aum Clinic - Home | Facebook", "x")).toBe("Aum Clinic");
    expect(nameFromTitle("instagram", "Login • Instagram", "royal.furniture.vdr")).toBe("royal furniture vdr");
  });
  it("builds a site: query", () => expect(socialQuery("instagram", "furniture shop", "Bhayli, Vadodara")).toBe("site:instagram.com furniture shop Bhayli, Vadodara"));
  it("turns hits into Instagram leads, skipping posts and duplicates", async () => {
    const r = await socialSearch({
      platform: "instagram", businessTerm: "furniture shop", place: "Vadodara", category: "Furniture shop", city: "Vadodara", max: 10,
      search: async () => [
        { url: "https://www.instagram.com/royalfurniture.vdr/", title: "Royal Furniture (@royalfurniture.vdr) • Instagram photos and videos" },
        { url: "https://www.instagram.com/p/XYZ/", title: "Post" },
        { url: "https://www.instagram.com/royalfurniture.vdr/reels/", title: "Royal Furniture reels" },
        { url: "https://www.instagram.com/woodcraft_studio/", title: "Woodcraft Studio (@woodcraft_studio) • Instagram" },
      ],
    });
    expect(r.map((x) => [x.name, x.sourceId, x.website])).toEqual([
      ["Royal Furniture", "royalfurniture.vdr", "https://www.instagram.com/royalfurniture.vdr/"],
      ["Woodcraft Studio", "woodcraft_studio", "https://www.instagram.com/woodcraft_studio/"],
    ]);
  });
});

describe("Meta API", () => {
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  it("reads an Instagram business profile", async () => {
    let asked = "";
    vi.stubGlobal("fetch", async (url: string) => {
      asked = url;
      return json({ business_discovery: { username: "royalfurniture.vdr", name: "Royal Furniture", biography: "Custom sofas • Call 98250 12345 • royalfurniture.in", website: "http://royalfurniture.in", followers_count: 2350, media_count: 410, media: { data: [{ timestamp: "2026-09-18T10:00:00+0000" }] } }, id: "1784" });
    });
    const p = await instagramBusinessDiscovery({ token: "t", igUserId: "1784", handle: "royalfurniture.vdr" });
    expect(asked).toContain("graph.facebook.com/v25.0/1784?");
    expect(decodeURIComponent(asked)).toContain("business_discovery.username(royalfurniture.vdr)");
    expect(p).toMatchObject({ followers: 2350, posts: 410, website: "http://royalfurniture.in", lastPostAt: "2026-09-18T10:00:00+0000" });
  });
  it("returns null for personal accounts", async () => {
    vi.stubGlobal("fetch", async () => json({ error: { message: "Invalid user id", code: 110 } }, 400));
    expect(await instagramBusinessDiscovery({ token: "t", igUserId: "1", handle: "someone" })).toBeNull();
  });
  it("explains an expired token", async () => {
    vi.stubGlobal("fetch", async () => json({ error: { message: "Error validating access token: Session has expired", code: 190 } }, 400));
    await expect(instagramBusinessDiscovery({ token: "t", igUserId: "1", handle: "x" })).rejects.toMatchObject({ kind: "auth" });
  });
  it("explains that Facebook Page search needs Meta's approval", async () => {
    vi.stubGlobal("fetch", async () => json({ error: { message: "(#10) This endpoint requires the 'Page Public Metadata Access' feature", code: 10 } }, 400));
    const e = await facebookPageSearch({ token: "t", query: "dentist Vadodara", max: 10 }).catch((x) => x);
    expect(e).toBeInstanceOf(MetaError);
    expect(e.message).toMatch(/Page Public Metadata Access/);
  });
  it("finds a real website in a bio, ignoring social and link-in-bio links", () => {
    expect(firstRealLink(undefined, "DM for orders 📦 linktr.ee/royal • wa.me/919825012345 • www.royalfurniture.in")).toBe("https://www.royalfurniture.in");
    expect(firstRealLink("https://linktr.ee/royal", "Sofas & beds • orders@gmail.com")).toBeUndefined();
  });
});

describe("merging social results with map results", () => {
  it("same Instagram link merges immediately", () => {
    const leads = mergePlaces([
      { source: "osm", sourceId: "n/1", name: "Royal Furniture", category: "Furniture shop", city: "Vadodara", lat: 22.3, lng: 73.1, website: "https://instagram.com/royalfurniture.vdr" },
      { source: "instagram", sourceId: "royalfurniture.vdr", name: "Royal Furniture House", category: "Furniture shop", city: "Vadodara", website: "https://www.instagram.com/royalfurniture.vdr/" },
    ]);
    expect(leads).toHaveLength(1);
    expect(leads[0].sources).toEqual(["osm", "instagram"]);
    expect(leads[0].social?.instagram?.handle).toBe("royalfurniture.vdr");
  });
  it("same exact name in the same city merges; different city doesn't", () => {
    expect(mergePlaces([
      { source: "google", sourceId: "g", name: "Woodcraft Studio", category: "x", city: "Vadodara", lat: 22.3, lng: 73.1 },
      { source: "instagram", sourceId: "woodcraft_studio", name: "Woodcraft Studio", category: "x", city: "Vadodara", website: "https://instagram.com/woodcraft_studio" },
    ])).toHaveLength(1);
    expect(mergePlaces([
      { source: "google", sourceId: "g", name: "Woodcraft Studio", category: "x", city: "Pune", lat: 18.5, lng: 73.8 },
      { source: "instagram", sourceId: "woodcraft_studio", name: "Woodcraft Studio", category: "x", city: "Vadodara", website: "https://instagram.com/woodcraft_studio" },
    ])).toHaveLength(2);
  });
  it("after crawling, an Instagram-only lead folds into the map lead that links to it", () => {
    const [mapLead, igLead] = mergePlaces([
      { source: "google", sourceId: "g", name: "Sharma Dental Care", category: "Dentist", city: "Vadodara", lat: 22.3, lng: 73.1, website: "https://sharmadental.in" },
      { source: "instagram", sourceId: "drsharma.smiles", name: "Dr Sharma Smiles", category: "Dentist", city: "Vadodara", website: "https://instagram.com/drsharma.smiles", phone: "+91 98250 11111" },
    ]);
    mapLead.social = { instagram: { handle: "drsharma.smiles", url: "https://www.instagram.com/drsharma.smiles/", checked: "link_only" } };
    const out = mergeBySocial([igLead, mapLead]);
    expect(out).toEqual([mapLead]);
    expect(mapLead.sources).toEqual(["google", "instagram"]);
    expect(mapLead.phones).toContain("+919825011111");
  });
});

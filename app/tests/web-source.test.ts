import { describe, expect, it } from "vitest";
import { mentionsPlace, nameFromPageTitle, webLeadSearch, webQueries } from "@/lib/sources/webSearch";

const page = (title: string, body: string) => ({ html: `<html><head><title>${title}</title></head><body>${body}</body></html>`, finalUrl: "" });

// The real Bing results for "furniture shop vadodara" from the user's SearXNG, 22 Sep 2026, plus two local shops.
const hits = [
  { url: "https://www.pepperfry.com/", title: "Best Furniture & Home Decor Online in India - Up to 70% Off" },
  { url: "https://www.royaloakindia.com/", title: "Buy Furniture Online: Home & Office Furniture at Best Prices in India" },
  { url: "https://www.damroindia.com/", title: "Buy Furniture Online India | Damro" },
  { url: "https://www.woodenstreet.com/", title: "Furniture @upto 70% OFF | Wooden Street" },
  { url: "https://srisenthurfurniture.com/", title: "Sri Senthur Furniture" },
  { url: "https://www.flipkart.com/furniture/pr?sid=wwe", title: "Buy Furniture Online - Flipkart.com" },
  { url: "https://www.justdial.com/Vadodara/Furniture-Dealers", title: "Top Furniture Dealers in Vadodara - Justdial" },
  { url: "https://www.instagram.com/royalfurniture.vdr/", title: "Royal Furniture (@royalfurniture.vdr)" },
  { url: "https://shreeganeshfurniture.in/products/sofa", title: "Sofas | Shree Ganesh Furniture Vadodara" },
  { url: "https://kalafurnishers.com/", title: "Kala Furnishers | Custom Furniture in Baroda" },
  { url: "https://furnchain.com/", title: "FurnChain" },
];
const sites: Record<string, ReturnType<typeof page>> = {
  "https://srisenthurfurniture.com/": page("Sri Senthur Furniture", "Chennai showroom. Call 98400 11111"),
  "https://shreeganeshfurniture.in/": page("Shree Ganesh Furniture | Best Sofa Shop in Vadodara", "Visit us at Gotri Road, Vadodara. Call 098250 44444"),
  "https://kalafurnishers.com/": page("Kala Furnishers", "Custom furniture made in Baroda since 1998. <a href='tel:+91 90990 12345'>Call</a>"),
  "https://furnchain.com/": page("FurnChain", "150+ outlets across India. Franchise enquiries welcome. Vadodara store open."),
};

describe("search engines as a lead source", () => {
  it("runs two queries per business type", () => {
    expect(webQueries("furniture shop", "Vadodara")).toEqual(["furniture shop in Vadodara", "furniture shop Vadodara contact number address"]);
  });

  it("keeps only local businesses with their own website", async () => {
    const r = await webLeadSearch(
      { term: "furniture shop", place: "Vadodara", city: "Vadodara", category: "Furniture shop", max: 10 },
      { search: async () => hits, fetchHtml: async (u) => (sites[u] ? { ...sites[u], finalUrl: u } : null) },
    );
    expect(r.places.map((p) => [p.name, p.website, p.phone])).toEqual([
      ["Shree Ganesh Furniture", "https://shreeganeshfurniture.in/", "+919825044444"],
      ["Kala Furnishers", "https://kalafurnishers.com/", "+919099012345"],
    ]);
    expect(r.places.every((p) => p.source === "web" && p.city === "Vadodara")).toBe(true);
    const why = Object.fromEntries(r.rejected.map((x) => [x.domain, x.why]));
    expect(why["pepperfry.com"]).toBe("national store or news site");
    expect(why["justdial.com"]).toBe("listing site");
    expect(why["srisenthurfurniture.com"]).toBe("doesn't mention Vadodara");
    expect(why["furnchain.com"]).toBe("chain or franchise");
    expect(r.rejected.find((x) => x.domain === "instagram.com")).toBeUndefined(); // left to the Instagram source
  });

  it("knows city aliases and areas", () => {
    expect(mentionsPlace("Made in Baroda since 1998", "Vadodara")).toBe(true);
    expect(mentionsPlace("Shop at Gotri Road", "Vadodara", "Gotri")).toBe(true);
    expect(mentionsPlace("Chennai showroom", "Vadodara")).toBe(false);
    expect(mentionsPlace("Vadodaranagar Traders", "Vadodara")).toBe(false);
  });

  it("pulls a clean name from page titles", () => {
    expect(nameFromPageTitle("Shree Ganesh Furniture | Best Sofa Shop in Vadodara", "shreeganeshfurniture.in")).toBe("Shree Ganesh Furniture");
    expect(nameFromPageTitle("Welcome to Kala Furnishers", "kalafurnishers.com")).toBe("Kala Furnishers");
    expect(nameFromPageTitle("Home - Patel Interiors - Vadodara", "patelinteriors.com")).toBe("Patel Interiors");
  });

  it("passes a search failure up so the pipeline can report it", async () => {
    await expect(webLeadSearch({ term: "x", place: "Y", city: "Y", category: "x", max: 5 }, { search: async () => { throw new Error("No web search available"); } })).rejects.toThrow(/No web search/);
  });
});

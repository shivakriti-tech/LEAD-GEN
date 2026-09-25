import { describe, expect, it } from "vitest";
import { discoverWebsite, domainMatchesName, isListingPath } from "@/lib/enrich/discover";
import { mergePlaces } from "@/lib/dedupe";

// Real cases from the Bhayli, Vadodara run on 22 Sep 2026.
const lead = (name: string, extra: Record<string, unknown> = {}) =>
  mergePlaces([{ source: "osm", sourceId: "n/" + name, name, category: "Café", city: "Vadodara", ...extra } as any])[0];
const page = (title: string, body: string) => `<html><head><title>${title}</title></head><body>${body}</body></html>`;

describe("domainMatchesName", () => {
  it.each([
    ["theeyeclinicvadodara.com", "The Eye Clinic", true],
    ["teapost.in", "Tea Post", true],
    ["www.sharmadentalcare.co.in", "Sharma Dental Care", true],
    ["sdcvadodara.com", "Sharma Dental Care", true],
    ["stanzaliving.com", "Gossip", false],
    ["restaurant-guru.in", "Tea Post", false],
    ["promallu.com", "Aum Clinic", false],
    ["blogspot.com", "Gossip", false],
  ])("%s vs %s → %s", (d, n, want) => expect(domainMatchesName(d, n)).toBe(want));
});

describe("isListingPath", () => {
  it("spots pages about the business on other sites", () => {
    expect(isListingPath("https://restaurant-guru.in/Tea-Post-Bhayli-Vadodara", "Tea Post")).toBe(true);
    expect(isListingPath("https://promallu.com/toprated/india/aum-clinic-q57lj/", "Aum Clinic")).toBe(true);
    expect(isListingPath("https://www.stanzaliving.com/paying-guest-pg-hostel-near-gossip-vasna-bhayli-main-road-bhayli-vadodara-slng35c3553a5", "Gossip")).toBe(true);
    expect(isListingPath("https://theeyeclinicvadodara.com/", "The Eye Clinic")).toBe(false);
  });
});

describe("discoverWebsite on the real Vadodara results", () => {
  const fetchHtml = async (url: string) => {
    const pages: Record<string, string> = {
      "https://www.stanzaliving.com/paying-guest-pg-hostel-near-gossip-vasna-bhayli-main-road-bhayli-vadodara-slng35c3553a5":
        page("PG near Gossip, Vasna Bhayli Main Road, Bhayli, Vadodara | Stanza Living", "Call 080 4600 7471. Near Gossip, Bhayli."),
      "https://restaurant-guru.in/Tea-Post-Bhayli-Vadodara": page("Tea Post, Vadodara, Bhayli - Restaurant menu and reviews", "Tea Post Bhayli +91 63563 01903"),
      "https://promallu.com/toprated/india/aum-clinic-q57lj/": page("Aum Clinic - Bhayli, Vadodara", "Aum Clinic in Bhayli. 99789 63963"),
      "https://theeyeclinicvadodara.com/": page("The Eye Clinic | Vadodara", "Eye care in Vadodara. Call 99983 39380"),
      "https://grandmall.in/": page("Grand Mall Vadodara", "Stores: Gossip café, level 2. Mall helpline 99999 00000"),
    };
    return pages[url] ? { html: pages[url], finalUrl: url } : null;
  };
  const search = (hits: Array<[string, string]>) => async () => hits.map(([url, title]) => ({ url, title }));

  it("Gossip: rejects the PG hostel page that mentions it", async () => {
    const r = await discoverWebsite(lead("Gossip"), "Bhayli", {
      fetchHtml,
      search: search([["https://www.stanzaliving.com/paying-guest-pg-hostel-near-gossip-vasna-bhayli-main-road-bhayli-vadodara-slng35c3553a5", "PG near Gossip"]]),
    });
    expect(r.website).toBeUndefined();
    expect(r.tried.join(" ")).toMatch(/rejected stanzaliving\.com/);
  });

  it("Tea Post: rejects the Restaurant Guru listing", async () => {
    const r = await discoverWebsite(lead("Tea Post", { phone: "+91 63563 01903" }), "Bhayli", {
      fetchHtml,
      search: search([["https://restaurant-guru.in/Tea-Post-Bhayli-Vadodara", "Tea Post, Vadodara"]]),
    });
    expect(r.website).toBeUndefined();
  });

  it("Aum Clinic: rejects the Promallu listing even though the phone matches", async () => {
    const r = await discoverWebsite(lead("Aum Clinic", { phone: "+91 99789 63963" }), "Bhayli", {
      fetchHtml,
      search: search([["https://promallu.com/toprated/india/aum-clinic-q57lj/", "Aum Clinic - Bhayli"]]),
    });
    expect(r.website).toBeUndefined();
  });

  it("The Eye Clinic: accepts its own site", async () => {
    const r = await discoverWebsite(lead("The Eye Clinic"), undefined, {
      fetchHtml,
      search: search([["https://theeyeclinicvadodara.com/", "The Eye Clinic | Vadodara"]]),
    });
    expect(r.website).toBe("https://theeyeclinicvadodara.com/");
    expect(r.evidence).toMatch(/web address matches the name/);
  });

  it("a mall homepage that lists the café isn't the café's site", async () => {
    const r = await discoverWebsite(lead("Gossip", { phone: "+91 90000 11111" }), undefined, {
      fetchHtml,
      search: search([["https://grandmall.in/", "Grand Mall Vadodara"]]),
    });
    expect(r.website).toBeUndefined();
  });
});

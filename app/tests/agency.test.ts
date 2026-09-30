import { describe, expect, it } from "vitest";
import { techHints } from "@/lib/enrich/tech";
import { parsePage } from "@/lib/enrich/crawl";
import { hasAgencyReason, scoreAgency, trackOf } from "@/lib/score/agency";
import { firstMessage, followUpMessage, issueChips, lastFollowUp, senderFor, subjectLine } from "@/lib/outreach";
import { linkedinNote, NOTE_MAX } from "@/lib/linkedin";
import { categoriesFor } from "@/lib/categories";
import { leadsReport } from "@/lib/report";
import { leadsToCsv } from "@/lib/csv";
import { inCountry, webLeadSearch, webQueries } from "@/lib/sources/webSearch";
import { withCountry } from "@/lib/marketContext";
import type { Lead, SearchRecord, TechHints, WebsiteAudit } from "@/lib/types";

const NOW = new Date("2026-09-30T12:00:00Z");
const audit = (tech: TechHints = {}, over: Partial<WebsiteAudit> = {}): WebsiteAudit => ({ status: "ok", emails: [], phones: [], socials: {}, finalUrl: "https://example.com/", https: true, mobileViewport: true, copyrightYear: 2026, tech, ...over });
const lead = (over: Partial<Lead> = {}): Lead => ({
  id: "1", name: "Maple & Oak Apparel", category: "Fashion & apparel brand", city: "Houston", country: "US",
  phone: "+17135550123", phones: ["+17135550123"], emails: ["hello@mapleoak.com"], email: "hello@mapleoak.com", sources: ["google"], signals: [], score: 0, tier: "cold", whyNow: "", ...over,
});
const scored = (l: Lead, services?: Parameters<typeof scoreAgency>[1]) => {
  const r = scoreAgency(l, services, NOW);
  return { ...l, ...r, pitchFor: { ...r.pitchFor, client: "Shivakriti Tech" } };
};

describe("how a website is built and run", () => {
  it("spots a Shopify store on a free theme, its apps and marketplaces", () => {
    const html = `<script>Shopify.theme = {"name":"Dawn","id":123,"theme_store_id":887,"role":"main"};</script><link href="//cdn.shopify.com/s/files/x.css"><script src="https://static.klaviyo.com/onsite/js/klaviyo.js"></script>`;
    const t = techHints(html, "Add to cart. Free shipping over $50.", ["amazon.com", "etsy.com"]);
    expect(t).toMatchObject({ platform: "Shopify", defaultTheme: "Dawn", store: true, tools: ["Klaviyo"], marketplaces: ["Amazon", "Etsy"] });
    expect(techHints(`<script>Shopify.theme = {"name":"Dawn - updated copy"}</script> cdn.shopify.com`, "").defaultTheme).toBe("Dawn");
    expect(techHints(`<script>Shopify.theme = {"name":"Maple Custom 2024"}</script> cdn.shopify.com`, "").defaultTheme).toBeUndefined();
  });

  it("tells Magento 1 from 2, and finds WooCommerce and builders", () => {
    expect(techHints(`<script src="/js/mage/cookies.js"></script><script>Mage.Cookies.path = '/';</script>`, "").platform).toBe("Magento 1");
    expect(techHints(`<div data-mage-init='{"x":1}'></div>`, "").platform).toBe("Magento 2");
    expect(techHints(`<link href="/wp-content/plugins/woocommerce/style.css">`, "").platform).toBe("WooCommerce");
    expect(techHints(`<img src="https://static.wixstatic.com/a.png">`, "").platform).toBe("Wix");
  });

  it("reads a company's systems: ERP, portal, tracking, quotes, manual roles, locations", () => {
    const t = techHints(`<script src="//js.hs-scripts.com/1.js"></script>`, "We run on SAP and Microsoft Dynamics 365. Customer portal login. Track your shipment. Request a quote. Now hiring: Data Entry Clerk, Dispatcher. 12 terminals across Texas.");
    expect(t).toMatchObject({ erp: ["SAP", "Microsoft Dynamics"], portal: true, tracking: true, quoteForm: true, tools: ["HubSpot"], locations: 12 });
    expect(t.manualRoles).toEqual(["data entry clerk", "dispatcher"]);
    expect(techHints("<p>Hello</p>", "Family owned since 1990. As soon as possible, ASAP.")).toEqual({});
  });

  it("the page parser returns the tech and the careers page", () => {
    const p = parsePage(`<html><body><a href="/careers">Careers</a><a href="/contact">Contact</a><p>Add to cart</p><link href="/wp-content/plugins/woocommerce/a.css"></body></html>`, "https://shop.example.com/");
    expect(p.tech.platform).toBe("WooCommerce");
    expect(p.careersLink).toBe("https://shop.example.com/careers");
  });
});

describe("business types for your agency", () => {
  it("has online-store niches and company sectors, each with a track", () => {
    const cats = categoriesFor("agency");
    expect(cats.filter((c) => c.track === "store").map((c) => c.key)).toEqual(expect.arrayContaining(["store_fashion", "store_beauty", "store_online"]));
    expect(cats.filter((c) => c.track === "company").map((c) => c.key)).toEqual(expect.arrayContaining(["co_freight", "co_trucking", "co_3pl", "co_mining", "co_oilgas", "co_energy", "co_agri", "co_manufacturing"]));
    expect(cats.every((c) => c.google)).toBe(true);
    // not mixed into the other offers
    expect(categoriesFor("website_development").some((c) => c.sells)).toBe(false);
    expect(categoriesFor("logistics").some((c) => c.sells === "agency")).toBe(false);
  });
  it("the track comes from the business type, else from the site", () => {
    expect(trackOf(lead())).toBe("store");
    expect(trackOf(lead({ category: "Trucking & haulage" }))).toBe("company");
    expect(trackOf(lead({ category: "Something else", audit: audit({ store: true }) }))).toBe("store");
  });
});

describe("scoring for your agency: online stores", () => {
  it("a marketplace-only brand is a strong lead for an ecommerce store", () => {
    const r = scoreAgency(lead({ audit: audit({ marketplaces: ["Amazon", "Etsy"] }) }), undefined, NOW);
    expect(r.signals.map((s) => s.key)).toContain("marketplace_only");
    expect(r.pitchFor).toMatchObject({ kind: "agency", track: "store" });
    expect(r.pitchFor.needs).toContain("ecommerce");
    expect(r.whyNow).toBe("Fashion & apparel brand in Houston: sells on Amazon, Etsy but has no store of its own. Likely needs an online store (Shopify or custom).");
  });
  it("Magento 1 and a default Shopify theme are reasons; a custom Shopify store with apps is not", () => {
    expect(scoreAgency(lead({ audit: audit({ platform: "Magento 1", store: true }) }), undefined, NOW).tier).toBe("warm");
    const dawn = scoreAgency(lead({ audit: audit({ platform: "Shopify", defaultTheme: "Dawn", store: true }) }), undefined, NOW);
    expect(dawn.signals.find((s) => s.key === "default_theme")!.label).toBe("Shopify store still on the free Dawn theme");
    const fine = scoreAgency(lead({ audit: audit({ platform: "Shopify", store: true, tools: ["Klaviyo", "Recharge"] }) }), undefined, NOW);
    expect(hasAgencyReason(fine)).toBe(false);
    expect(fine.signals.map((s) => s.key)).toContain("invests");
  });
  it("counts a reason in full only when you sell what it calls for", () => {
    const l = lead({ audit: audit({ marketplaces: ["Amazon"] }) });
    const all = scoreAgency(l, undefined, NOW).signals.find((s) => s.key === "marketplace_only")!.points;
    const webOnly = scoreAgency(l, ["website"], NOW).signals.find((s) => s.key === "marketplace_only")!.points;
    expect(webOnly).toBeLessThan(all);
    expect(scoreAgency(l, ["website"], NOW).pitchFor.needs).toEqual(["website"]);
  });
  it("web agencies are competitors, not leads", () => {
    const r = scoreAgency(lead({ name: "Pixel Web Design Studio" }), undefined, NOW);
    expect(r.tier).toBe("cold");
    expect(r.whyNow).toMatch(/competitor/);
  });
});

describe("scoring for your agency: companies", () => {
  const co = (tech: TechHints, over: Partial<Lead> = {}) => lead({ name: "Lone Star Freight Lines", category: "Trucking & haulage", audit: audit(tech, { copyrightYear: 2019 }), ...over });
  it("an old site, no tracking, manual roles and several terminals: a hot lead for CRM / ERP and automation", () => {
    const r = scoreAgency(co({ quoteForm: true, manualRoles: ["dispatcher"], locations: 6, erp: ["Tally"] }), undefined, NOW);
    expect(r.tier).toBe("hot");
    expect(r.signals.map((s) => s.key)).toEqual(expect.arrayContaining(["stale", "no_portal", "quote_by_email", "manual_roles", "locations", "erp"]));
    expect(r.pitchFor.needs).toEqual(["website", "crm_erp", "ai_automation"]);
    expect(r.pitchFor.track).toBe("company");
    expect(r.whyNow).toBe("Trucking & haulage in Houston with 6 locations: no shipment tracking or customer login on the site and hiring for manual office work (dispatcher). Likely needs a new website, a CRM / ERP and AI automation.");
  });
  it("a company with a portal and tracking and a current site has less to fix", () => {
    const r = scoreAgency(co({ portal: true, tracking: true }, { audit: audit({ portal: true, tracking: true }) }), undefined, NOW);
    expect(hasAgencyReason(r)).toBe(false);
    expect(r.pitchFor.needs).toEqual(["crm_erp"]);
  });
  it("very large companies score lower", () => {
    const small = scoreAgency(co({}, { company: { employees: 80 } }), undefined, NOW).score;
    const huge = scoreAgency(co({}, { company: { employees: 5000 } }), undefined, NOW).score;
    expect(huge).toBeLessThan(small);
  });
});

describe("messages for your agency's leads", () => {
  const me = senderFor({ name: "Riya", address: "12 Main St" }, { name: "Shivakriti Tech", proof: ["We built the website and ERP for SVIL and RENP."], sender: { link: "shivakriti.tech" } });
  it("store: names the reason, what you build, your proof and a small ask, in English", () => {
    const l = scored(lead({ audit: audit({ marketplaces: ["Amazon", "Etsy"] }) }));
    const m = firstMessage(l, "hi", me);
    expect(m).toContain("I saw you sell on Amazon and Etsy, but there's no store on your own website");
    expect(m).toContain("I'm Riya from Shivakriti Tech: we build online stores (Shopify or custom) for product brands");
    expect(m).toContain("We built the website and ERP for SVIL and RENP.");
    expect(m).toContain("three quick wins");
    expect(m).toMatch(/shivakriti\.tech$/);
    expect(subjectLine(l)).toBe("An idea for the Maple & Oak Apparel store");
    expect(issueChips(l)[0]).toEqual({ label: "Only on Amazon", kind: "bad" });
  });
  it("company: hiring for manual work leads, and the follow-ups stay on topic", () => {
    const l = scored(lead({ name: "Lone Star Freight Lines", category: "Trucking & haulage", audit: audit({ manualRoles: ["data entry clerk"] }) }));
    expect(firstMessage(l, "en", me)).toContain("I saw you're hiring a data entry clerk");
    expect(firstMessage(l, "en", me, "short")).toMatch(/^Hi there, Riya from Shivakriti Tech here\./);
    expect(followUpMessage(l, "en", me)).toContain("about a CRM / ERP for Lone Star Freight Lines");
    expect(lastFollowUp(l, "en", me)).toContain("one last note about a CRM / ERP");
    expect(linkedinNote(l, me).length).toBeLessThanOrEqual(NOTE_MAX);
    expect(linkedinNote(l, me)).toContain("CRM/ERP and automation");
  });
});

describe("report and CSV for an agency search", () => {
  it("shows what each lead needs and the country", () => {
    const l = scored(lead({ audit: audit({ marketplaces: ["Amazon"] }) }));
    const search: SearchRecord = { id: "s", createdAt: NOW.toISOString(), status: "done", counts: { found: 1, afterDedupe: 1, hot: 0, warm: 1, cold: 0 }, params: { sells: "agency", agency: { services: ["website", "ecommerce"] }, country: "US", categories: ["store_fashion"], city: "Houston", perCategory: 20, sources: { google: true, osm: true, apollo: false, instagram: false, facebook: false, web: true, gmaps: false }, pageSpeed: false, verifyWebsites: true, webSearch: true } };
    const html = leadsReport({ search, leads: [l], all: true, now: NOW });
    expect(html).toContain("Houston, United States");
    expect(html).toContain("Businesses to build for");
    expect(html).toContain("an online store (Shopify or custom)");
    expect(html).toContain("Website, Ecommerce store");
    expect(leadsToCsv([l])).toContain("an online store (Shopify or custom)");
  });
});

describe("web search for online brands", () => {
  it("searches the whole country for stores and checks the site is from there", async () => {
    expect(webQueries("clothing brand store", "Houston", "country")[0]).toBe("clothing brand store online store Houston");
    await withCountry("US", async () => {
      expect(inCountry("mapleoak.com", "Free shipping across the USA", "Houston")).toBe(true);
      expect(inCountry("mapleoak.com", "Made in Toronto", "Houston")).toBe(false);
    });
    await withCountry("AU", async () => expect(inCountry("koala.com.au", "Shop now", "Sydney")).toBe(true));
    const r = await withCountry("US", () =>
      webLeadSearch(
        { term: "clothing brand store", place: "Houston", city: "Houston", category: "Fashion & apparel brand", max: 5, scope: "country" },
        {
          search: async () => [{ url: "https://mapleoak.com/", title: "Maple & Oak | Apparel" }, { url: "https://www.etsy.com/shop/x", title: "Etsy" }, { url: "https://torontotee.ca/", title: "Toronto Tee" }],
          fetchHtml: async (u) => (u.includes("mapleoak") ? { html: "<title>Maple & Oak</title><body>Free shipping across the USA. Call (713) 555-0123</body>", finalUrl: "https://mapleoak.com/" } : u.includes("torontotee") ? { html: "<body>Made in Toronto, shipped across Canada</body>", finalUrl: u } : null),
        },
      ),
    );
    expect(r.places.map((p) => p.sourceId)).toEqual(["mapleoak.com"]);
    expect(r.places[0].phone).toBe("+17135550123");
    expect(r.rejected.map((x) => x.why)).toEqual(expect.arrayContaining(["national store or news site", "not in United States"]));
  });
});

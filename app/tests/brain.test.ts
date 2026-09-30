import { describe, expect, it } from "vitest";
import { analyzeClientSite, draftToBrain, pricesIn, readClientSite, type Draft } from "@/lib/brainAnalyze";
import { bannedIn, parseBrain, priceFrom } from "@/lib/brain";

const SITE: Record<string, string> = {
  "https://shreelogistics.in/": `<html><head><title>Shree Logistics | Customs & Freight, Vadodara</title><meta name="description" content="Customs clearance and freight forwarding from Vadodara since 2009."></head>
    <body><nav><a href="/services">Our Services</a><a href="/pricing">Pricing</a><a href="/about">About us</a><a href="https://facebook.com/x">FB</a></nav>
    <h1>Shree Logistics</h1><p>Serving 300+ exporters across Gujarat. Licensed customs broker. Call +91 98250 12345, info@shreelogistics.in</p></body></html>`,
  "https://shreelogistics.in/services": `<html><body><h2>Customs Clearance</h2><p>At all Gujarat ports.</p><h2>Sea Freight (FCL / LCL)</h2><h2>DGFT Licences</h2><h2>Why choose us?</h2><h2>Road Transport</h2></body></html>`,
  "https://shreelogistics.in/pricing": `<html><body><h3>Customs Clearance</h3><p>Customs clearance starting ₹4,500 per shipment</p></body></html>`,
  "https://shreelogistics.in/about": `<html><body><h2>About us</h2><p>ISO 9001 certified, 15 years of experience.</p></body></html>`,
};
const fakeFetch = (async (url: string) => {
  const u = url.endsWith(".in") ? url + "/" : url;
  const body = SITE[u];
  const res = new Response(body ?? "not found", { status: body ? 200 : 404, headers: { "content-type": "text/html" } });
  Object.defineProperty(res, "url", { value: u });
  return res;
}) as never;

describe("reading a client's website", () => {
  it("reads the home page and its service, pricing and about pages (not other sites)", async () => {
    const site = await readClientSite("shreelogistics.in", fakeFetch);
    expect(site.pages.map((p) => p.url)).toEqual(["https://shreelogistics.in/", "https://shreelogistics.in/pricing", "https://shreelogistics.in/services", "https://shreelogistics.in/about"]);
    expect(site.phones).toContain("+919825012345");
    expect(site.emails).toContain("info@shreelogistics.in");
  });

  it("drafts a brain without AI: logistics offer, services mapped, the price found", async () => {
    const r = await analyzeClientSite({ website: "shreelogistics.in" }, { fetch: fakeFetch, drafter: null });
    expect(r.by).toBe("rules");
    const d = r.draft;
    expect(d.name).toBe("Shree Logistics");
    expect(d.offer).toBe("logistics");
    expect(d.city).toBe("Vadodara");
    expect(d.services!.map((s) => [s.name, s.logistics])).toEqual([["Customs Clearance", "customs"], ["Sea Freight (FCL / LCL)", "sea"], ["DGFT Licences", "dgft"], ["Road Transport", "freight"]]);
    expect(d.services![0].price).toBe("starting ₹4,500 per shipment");
    expect(d.proof!.join(" ")).toMatch(/300\+ exporters|ISO 9001/);
    expect(parseBrain(d).ok).toBe(true);
  });

  it("with AI: uses Claude's draft but drops any price the site doesn't show", async () => {
    const draft: Draft = {
      name: "Shree Logistics", offer: "logistics", summary: "Customs and freight for Gujarat exporters.", city: "Vadodara", phone: null, email: null,
      services: [{ name: "Customs clearance", description: null, price: "₹4,500", logistics: "customs" }, { name: "Sea freight", description: null, price: "₹9,000", logistics: "sea" }],
      audience_categories: ["exporter", "manufacturer", "dentist"], audience_notes: null, usps: ["Licensed customs broker"], proof: ["300+ exporters"],
      dos: ["Mention the port"], donts: ["Don't quote rates before knowing the cargo"], banned_phrases: ["cheapest"], price_hook: "₹9,000 flat", usp_line: "Own customs licence", notes: ["No sea freight prices on the site"],
    };
    let prompt = "";
    const r = await analyzeClientSite({ website: "shreelogistics.in" }, { fetch: fakeFetch, drafter: async (_s, p) => ((prompt = p), draft) });
    expect(r.by).toBe("claude");
    expect(prompt).toContain('<page url="https://shreelogistics.in/pricing">');
    expect(r.draft.services!.map((s) => s.price)).toEqual(["₹4,500", undefined]);
    expect(r.draft.pitch!.priceHook).toBeUndefined(); // "₹9,000" isn't on the site
    expect(r.draft.audience!.categories).toEqual(["exporter", "manufacturer"]); // a website-client type is dropped for a logistics client
    expect(r.draft.analysis!.notes!.at(-1)).toMatch(/Prices not found on the site were left out: Sea freight \(₹9,000\)/);
    expect(r.draft.phone).toBe("+919825012345"); // filled from the site when Claude gave none
  });

  it("falls back to the basic reader when the AI call fails", async () => {
    const r = await analyzeClientSite({ website: "shreelogistics.in" }, { fetch: fakeFetch, drafter: async () => { throw new Error("rate limited"); } });
    expect(r.by).toBe("rules");
    expect(r.warning).toMatch(/AI reading failed \(rate limited\)/);
  });
});

describe("brain helpers", () => {
  it("checks a brain before saving", () => {
    expect(parseBrain({ name: "", offer: "logistics" })).toEqual({ ok: false, error: "name: Give the client a name" });
    expect(parseBrain({ name: "X", offer: "shoes" }).ok).toBe(false);
    const ok = parseBrain({ name: " Shree ", offer: "logistics", usps: ["a", "", "b"] });
    expect(ok.ok && ok.brain).toMatchObject({ name: "Shree", usps: ["a", "b"], services: [], rules: { dos: [], donts: [], bannedPhrases: [] } });
  });

  it("reads prices and finds banned phrases", () => {
    expect(priceFrom("from ₹15,000 / month")).toBe(15000);
    expect(priceFrom("Rs. 1.5 lakh")).toBe(150000);
    expect(priceFrom("on request")).toBeUndefined();
    expect(pricesIn("Basic site only ₹9,999/- and SEO ₹5k per month").map((p) => p.price)).toEqual(["only ₹9,999/-", "₹5k per month"]);
    expect(bannedIn("We are the cheapest, 100% guaranteed!", ["cheapest", "100%", "guarantee", "free"])).toEqual(["cheapest", "100%"]);
  });
});

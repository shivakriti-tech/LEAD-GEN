import { describe, expect, it } from "vitest";
import { candidateDomains, discoverWebsite, isDirectory, significantTokens, verifyPageForLead } from "@/lib/enrich/discover";
import { mergePlaces } from "@/lib/dedupe";

const lead = (o: Record<string, unknown> = {}) => ({ ...mergePlaces([{ source: "google", sourceId: "x", name: "Tea Post", category: "Café", city: "Pune", phone: "+91 90000 12345", ...o } as any])[0] });
const page = (title: string, body: string) => `<html><head><title>${title}</title></head><body>${body}</body></html>`;

describe("candidateDomains", () => {
  it("builds likely domains, most likely first", () => {
    expect(candidateDomains("Tea Post", "Pune").slice(0, 3)).toEqual(["teapost.com", "teapost.in", "teapost.co.in"]);
    expect(candidateDomains("Dr. Sharma's Dental Care Pvt Ltd")).toContain("drsharmasdentalcare.com");
    expect(candidateDomains("The Bombay Canteen")).toContain("bombaycanteen.com");
  });
});

describe("verifyPageForLead", () => {
  it("accepts a page with the name and the phone number", () => {
    expect(verifyPageForLead(page("Tea Post | Chai & Snacks", "Call 090000 12345"), lead()).ok).toBe(true);
  });
  it("accepts name in the title plus the area", () => {
    const v = verifyPageForLead(page("Tea Post", "Visit us in Kothrud, Pune"), lead(), "Kothrud");
    expect(v).toMatchObject({ ok: true });
    expect(v.evidence).toMatch(/kothrud/);
  });
  it("rejects a parked domain that only repeats the name", () => {
    expect(verifyPageForLead(page("teapost.com is for sale", "Buy teapost.com today"), lead()).ok).toBe(false);
  });
  it("rejects a page for a different business", () => {
    expect(verifyPageForLead(page("Blog post about tea", "We post tea recipes from Pune"), lead()).ok).toBe(false);
  });
  it("won't verify names that are only generic words", () => {
    // only generic words: the full name plus the business's own phone number is the only proof accepted
    expect(verifyPageForLead(page("Dental Clinic", "Pune, call us"), lead({ name: "Dental Clinic" }))).toMatchObject({ ok: false, evidence: /needs the phone/ });
    expect(verifyPageForLead(page("Dental Clinic", "Pune 9000012345"), lead({ name: "Dental Clinic" }))).toMatchObject({ ok: true, proof: "phone" });
    expect(verifyPageForLead(page("Smile Dental Clinic", "Pune 9000012345"), lead({ name: "Dental Clinic" }))).toMatchObject({ ok: true });
    expect(verifyPageForLead(page("Best clinics", "Pune 9000012345"), lead({ name: "Dental Clinic" }))).toMatchObject({ ok: false, evidence: /not on the page/ });
    expect(significantTokens("Sai Dental Clinic & Implant Centre")).toEqual(["sai"]);
  });
});

describe("discoverWebsite", () => {
  it("finds the site by guessing its address", async () => {
    const r = await discoverWebsite(lead(), "Kothrud", {
      fetchHtml: async (url) => (url === "https://teapost.in" ? { html: page("Tea Post", "Call +91 90000 12345"), finalUrl: "https://teapost.in/" } : null),
    });
    expect(r).toMatchObject({ website: "https://teapost.in/", via: "domain_guess" });
  });
  it("falls back to web search, skips directories, and spots franchises", async () => {
    const r = await discoverWebsite(lead(), undefined, {
      fetchHtml: async (url) =>
        url === "https://teapostindia.co/" ? { html: page("Tea Post - Official", "Franchise enquiries. Pune outlet: 9000012345"), finalUrl: url } : null,
      search: async () => [
        { url: "https://www.justdial.com/Pune/Tea-Post", title: "Tea Post - Justdial" },
        { url: "https://teapostindia.co/", title: "Tea Post Official" },
      ],
    });
    expect(r.via).toBe("web_search");
    expect(r.website).toBe("https://teapostindia.co/");
    expect(r.chainHint).toMatch(/franchis/);
  });
  it("records an Instagram page when that's all there is", async () => {
    const r = await discoverWebsite(lead(), undefined, {
      fetchHtml: async () => null,
      search: async () => [{ url: "https://www.instagram.com/teapost.kothrud/", title: "Tea Post Kothrud (@teapost.kothrud) • Instagram" }],
    });
    expect(r.social).toContain("instagram.com");
    expect(r.website).toBeUndefined();
  });
  it("says what it tried when nothing is found", async () => {
    const r = await discoverWebsite(lead(), "Baner", { fetchHtml: async () => null, search: async () => [] });
    expect(r.website).toBeUndefined();
    expect(r.tried[0]).toMatch(/likely web addresses \(teapost\.com/);
    expect(r.tried[1]).toBe('web search: "Tea Post" Baner Pune');
  });
  it("knows directories", () => {
    expect(isDirectory("www.justdial.com".replace("www.", ""))).toBe(true);
    expect(isDirectory("teapost.in")).toBe(false);
  });
});

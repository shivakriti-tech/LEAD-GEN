import { describe, expect, it } from "vitest";
import { discoverWebsite, phoneQuery } from "@/lib/enrich/discover";
import { emptyAudit } from "@/lib/enrich/crawl";
import { limited, runSearch, type Deps } from "@/lib/pipeline";
import type { Lead, ProgressEvent, SearchRecord } from "@/lib/types";
import type { Store } from "@/lib/store";

const baseLead = (over: Partial<Lead> = {}): Lead => ({
  id: "1", name: "Shah's Dental Care", category: "Dentist", city: "Vadodara", phone: "+912652333394", phones: ["+912652333394"],
  emails: [], sources: ["gmaps"], signals: [], score: 0, tier: "cold", whyNow: "", ...over,
});
const home = (title: string, body: string) => `<html><head><title>${title}</title></head><body>${body}</body></html>`;

describe("phone number search", () => {
  it("writes the number the way Indian sites do", () => {
    expect(phoneQuery("+919825011111")).toBe('"98250 11111" OR "9825011111"');
    expect(phoneQuery("+912652333394")).toBe('"2652333394" OR "02652333394"');
    expect(phoneQuery("123")).toBeUndefined();
  });

  it("finds a site whose address has nothing to do with the name, and skips directories listing the number", async () => {
    const queries: string[] = [];
    const pages: Record<string, string> = {
      "https://sdcclinic.in/": home("SDC · Shah's Dental Care", "Call 0265 2333394, Alkapuri"),
      "https://someguide.in/": home("Some Guide: best clinics", "Find doctors near you"), // lists the number on an inner page only
    };
    const r = await discoverWebsite(baseLead(), undefined, {
      phoneSearch: true,
      resolves: async () => false,
      fetchHtml: async (url) => (pages[url] ? { html: pages[url], finalUrl: url } : null),
      search: async (q) => {
        queries.push(q);
        return q.includes("2652333394")
          ? [{ url: "https://someguide.in/vadodara/dentists/shahs-dental-care", title: "Shah's Dental Care - Some Guide" }, { url: "https://sdcclinic.in/contact", title: "Contact | SDC", snippet: "Call 0265 2333394" }]
          : [];
      },
    });
    expect(queries).toEqual(['"Shah\'s Dental Care" Vadodara', '"2652333394" OR "02652333394"']);
    expect(r).toMatchObject({ website: "https://sdcclinic.in/", via: "web_search", evidence: expect.stringMatching(/^found by searching its phone number/) });
    expect(r.tried.join(" ")).not.toMatch(/someguide.*verified/);
  });

  it("doesn't search the phone when the name search already found the site", async () => {
    const queries: string[] = [];
    await discoverWebsite(baseLead(), undefined, {
      phoneSearch: true,
      resolves: async () => false,
      fetchHtml: async (url) => (url === "https://shahsdentalcare.com/" ? { html: home("Shah's Dental Care", "0265 2333394"), finalUrl: url } : null),
      search: async (q) => { queries.push(q); return [{ url: "https://shahsdentalcare.com/", title: "Shah's Dental Care" }]; },
    });
    expect(queries).toHaveLength(1);
  });
});

describe("phone search is opt-in and skips unrelated results", () => {
  it("is off unless asked for", async () => {
    const queries: string[] = [];
    await discoverWebsite(baseLead(), undefined, { resolves: async () => false, fetchHtml: async () => null, search: async (q) => { queries.push(q); return []; } });
    expect(queries).toHaveLength(1);
  });
  it("doesn't load results that show neither the number nor the name", async () => {
    const loaded: string[] = [];
    await discoverWebsite(baseLead(), undefined, {
      phoneSearch: true,
      resolves: async () => false,
      fetchHtml: async (url) => { loaded.push(url); return null; },
      search: async (q) => (q.startsWith('"Shah') ? [] : [{ url: "https://www.zhihu.com/question/1", title: "如何评价" }, { url: "https://support.microsoft.com/x", title: "Office help" }]),
    });
    expect(loaded).toEqual([]);
  });
  it("searches with the cleaned name even when it's all generic words", async () => {
    const queries: string[] = [];
    await discoverWebsite(baseLead({ name: "Family Dental Care & Implant Center – Best Dentist in Vadodara" }), undefined, { resolves: async () => false, fetchHtml: async () => null, search: async (q) => { queries.push(q); return []; } });
    expect(queries[0]).toBe('"Family Dental Care & Implant Center" Vadodara');
  });
});

describe("limited", () => {
  it("keeps at most n calls in flight", async () => {
    let active = 0, peak = 0;
    const f = limited(async (x: number) => { active++; peak = Math.max(peak, active); await new Promise((r) => setTimeout(r, 5)); active--; return x * 2; }, 3);
    expect(await Promise.all([1, 2, 3, 4, 5, 6, 7].map(f))).toEqual([2, 4, 6, 8, 10, 12, 14]);
    expect(peak).toBe(3);
  });
});

describe("streaming search", () => {
  function memStore() {
    const saves: Lead[][] = [];
    const data = new Map<string, { search: SearchRecord; leads: Lead[] }>();
    const store: Store = {
      kind: "local",
      async saveSearch(s) { data.set(s.id, { search: structuredClone(s), leads: data.get(s.id)?.leads ?? [] }); },
      async saveLeads(id, leads) { saves.push(structuredClone(leads)); data.get(id)!.leads = structuredClone(leads); },
      async listSearches() { return [...data.values()].map((x) => x.search); },
      async getSearch(id) { return data.get(id) ?? null; },
    };
    return { store, saves };
  }

  it("shows every business first, then each one as it's checked, with sources searched in parallel", async () => {
    const { store, saves } = memStore();
    let inFlight = 0, overlap = false;
    const slow = async <T,>(v: T) => { inFlight++; if (inFlight > 1) overlap = true; await new Promise((r) => setTimeout(r, 10)); inFlight--; return v; };
    const deps: Deps = {
      keys: { google: "k" }, store,
      google: async ({ category, city }) => slow({ requests: 1, places: [
        { source: "google" as const, sourceId: "g1", name: "Aum Dental", category, city, phone: "+919825011111" },
        { source: "google" as const, sourceId: "g2", name: "Kiran Salon", category, city, website: "https://kiransalon.in" },
      ] }),
      osm: async ({ category, city }) => slow([{ source: "osm" as const, sourceId: "n/1", name: "Moti Cafe", category, city }]),
      geocode: async () => ({ box: { south: 22.2, west: 73.1, north: 22.4, east: 73.3 }, via: "test" }),
      discover: async () => ({ tried: ["looked"] }),
      audit: async (w) => (w ? { ...emptyAudit("ok"), https: true, mobileViewport: true } : emptyAudit("none")),
      pageSpeed: async () => { throw new Error("off"); }, apollo: async () => null,
      social: async () => [], web: async () => ({ places: [], queries: 0, rejected: [] }), gmaps: async () => [],
      igLookup: async () => null, fbSearch: async () => [], checkCandidate: async () => ({ ok: false, evidence: "" }),
    };
    const events: ProgressEvent[] = [];
    const { search, leads } = await runSearch(
      { sells: "website_development", categories: ["dentist"], city: "Vadodara", perCategory: 20, sources: { google: true, osm: true, apollo: false, instagram: false, facebook: false, web: false, gmaps: false }, pageSpeed: false, verifyWebsites: true, webSearch: false },
      deps, (e) => events.push(e),
    );
    expect(search.status).toBe("done");
    expect(overlap).toBe(true); // Google and OpenStreetMap ran at the same time

    const first = events.findIndex((e) => e.type === "leads");
    const firstLead = events.findIndex((e) => e.type === "lead");
    expect(first).toBeGreaterThan(-1);
    expect(firstLead).toBeGreaterThan(first);
    const all = events[first] as Extract<ProgressEvent, { type: "leads" }>;
    expect(all.leads).toHaveLength(3);
    const updates = events.filter((e): e is Extract<ProgressEvent, { type: "lead" }> => e.type === "lead");
    expect(updates).toHaveLength(3);
    expect(updates.every((u) => u.lead.pending === false)).toBe(true);
    expect(leads.every((l) => !l.pending)).toBe(true);

    // partial results were saved while running, the final list at the end
    expect(saves[0].every((l) => l.pending)).toBe(true);
    expect(saves.at(-1)!.every((l) => !l.pending)).toBe(true);
  });
});

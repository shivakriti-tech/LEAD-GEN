import { describe, expect, it } from "vitest";
import { growthHints } from "@/lib/enrich/crawl";
import { emptyAudit } from "@/lib/enrich/crawl";
import { domainRegisteredOn, registrableDomain } from "@/lib/enrich/domainAge";
import { growthSignals } from "@/lib/score/growth";
import { scoreWebsiteDev } from "@/lib/score/websiteDev";
import { scoreLogistics } from "@/lib/score/logistics";
import { issueChips } from "@/lib/outreach";
import type { Lead } from "@/lib/types";

const now = new Date("2026-09-30T10:00:00Z");
const lead = (over: Partial<Lead> = {}): Lead => ({ id: "a", name: "Glow Skin Clinic", category: "Skin clinic", city: "Vadodara", phones: ["+919825011111"], phone: "+919825011111", emails: [], sources: ["google"], signals: [], score: 0, tier: "cold", whyNow: "", ...over }) as Lead;

describe("growth clues on a website", () => {
  it("finds hiring, a new opening and expansion, with the words that showed it", () => {
    const g = growthHints("Welcome! Grand Opening this Diwali. We are hiring: current openings for nurses. Our new branch at Gotri is open.");
    expect(g).toEqual({ hiring: "We are hiring", opened: "Grand Opening", expanding: "new branch at" });
    expect(growthHints("Careers | About us | Contact")).toEqual({}); // a careers link alone isn't hiring
    expect(growthHints("Now open in Surat and Vadodara").expanding).toBe("Now open in Surat");
  });
});

describe("domain age (RDAP)", () => {
  it("looks up the registrable domain and reads the registration date", async () => {
    expect(registrableDomain("www.shop.shivsteel.co.in")).toBe("shivsteel.co.in");
    expect(registrableDomain("glowskin.in")).toBe("glowskin.in");
    let asked = "";
    const f = (async (url: string) => ((asked = url), new Response(JSON.stringify({ events: [{ eventAction: "last changed", eventDate: "2026-05-01T00:00:00Z" }, { eventAction: "registration", eventDate: "2026-03-14T08:00:00Z" }] })))) as never;
    expect(await domainRegisteredOn("www.glowskin.in", f)).toBe("2026-03-14");
    expect(asked).toBe("https://rdap.org/domain/glowskin.in");
    expect(await domainRegisteredOn("x.in", (async () => new Response("", { status: 404 })) as never)).toBeUndefined();
  });
});

describe("why-now signals in scoring", () => {
  it("a new business with no website scores higher and says why", () => {
    const base = scoreWebsiteDev(lead({ audit: emptyAudit("none") }), now);
    const fresh = scoreWebsiteDev(lead({ audit: { ...emptyAudit("none"), foundedYear: 2026 } }), now);
    expect(fresh.score - base.score).toBe(15);
    expect(fresh.signals.find((s) => s.key === "new_business")!.label).toBe("New business: started in 2026");
    expect(fresh.whyNow).toMatch(/It's a new business: the best time to get a proper website\.$/);
  });

  it("a young domain means new only if the business isn't years old", () => {
    const young = { ...emptyAudit("ok"), mobileViewport: true, https: true, domainSince: "2026-03-14" };
    expect(growthSignals(lead({ audit: young }), "website", now).map((s) => s.label)).toEqual(["New business: website domain registered Mar 2026"]);
    expect(growthSignals(lead({ audit: { ...young, foundedYear: 2012 } }), "website", now)).toEqual([]);
    expect(growthSignals(lead({ audit: { ...young, copyrightYear: 2019 } }), "website", now)).toEqual([]); // an old site on a new domain
  });

  it("a fine website that's expanding isn't written off as low priority", () => {
    const r = scoreWebsiteDev(lead({ audit: { ...emptyAudit("ok"), mobileViewport: true, https: true, growth: { expanding: "new branch at" } } }), now);
    expect(r.whyNow).toBe(`Glow Skin Clinic's website looks fine. They're expanding ("new branch at"), a good moment to look better online.`);
    expect(issueChips({ ...lead(), ...r, audit: { ...emptyAudit("ok") } } as Lead)[0]).toEqual({ label: "Expanding", kind: "good" });
  });

  it("low rating is a website pitch angle, not a logistics one", () => {
    const l = lead({ rating: 3.4, reviews: 60, audit: emptyAudit("none") });
    expect(scoreWebsiteDev(l, now).signals.some((s) => s.key === "low_rating")).toBe(true);
    expect(growthSignals(l, "logistics", now)).toEqual([]);
    expect(growthSignals(lead({ rating: 3.4, reviews: 5 }), "website", now)).toEqual([]); // too few reviews to mean much
  });

  it("an expanding factory is a stronger logistics lead", () => {
    const f = (growth?: object) => scoreLogistics(lead({ name: "Om Engineering", category: "Engineering & fabrication", address: "Plot 8, GIDC Makarpura, Vadodara", audit: { ...emptyAudit("ok"), growth } as never }), undefined, now);
    const a = f(), b = f({ expanding: "new plant", hiring: "walk-in interview" });
    expect(b.score - a.score).toBe(20);
    expect(b.whyNow).toMatch(/It's expanding \("new plant"\), so shipments will grow\. It's hiring, a sign of growing volumes\.$/);
    // competitors get no growth points
    expect(scoreLogistics(lead({ name: "Maruti Roadways Transport", audit: { ...emptyAudit("ok"), growth: { expanding: "new branch" } } as never }), undefined, now).score).toBe(0);
  });
});

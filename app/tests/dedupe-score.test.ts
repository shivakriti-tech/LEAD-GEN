import { describe, expect, it } from "vitest";
import { mergePlaces } from "@/lib/dedupe";
import { scoreWebsiteDev } from "@/lib/score/websiteDev";
import type { RawPlace } from "@/lib/types";
import { emptyAudit } from "@/lib/enrich/crawl";

const g = (o: Partial<RawPlace>): RawPlace => ({ source: "google", sourceId: "g" + Math.random(), name: "X", category: "Dentist", city: "Pune", ...o });
const o = (x: Partial<RawPlace>): RawPlace => ({ ...g(x), source: "osm", sourceId: "node/" + Math.random() });

describe("mergePlaces", () => {
  it("merges by phone across sources and keeps Google's name", () => {
    const leads = mergePlaces([
      o({ name: "sharma dental", phone: "098220 12345", email: "a@b.in" }),
      g({ name: "Sharma Dental Care", phone: "+91 98220 12345", rating: 4.6, reviews: 212 }),
    ]);
    expect(leads).toHaveLength(1);
    expect(leads[0].name).toBe("Sharma Dental Care");
    expect(leads[0].sources).toEqual(["osm", "google"]);
    expect(leads[0].email).toBe("a@b.in");
    expect(leads[0].reviews).toBe(212);
  });
  it("merges by website domain but not by shared Instagram", () => {
    expect(mergePlaces([g({ name: "A", website: "https://www.abc.in" }), o({ name: "A clinic", website: "http://abc.in/home" })])).toHaveLength(1);
    expect(mergePlaces([g({ name: "A", website: "https://instagram.com/a" }), g({ name: "B", website: "https://instagram.com/b" })])).toHaveLength(2);
  });
  it("merges similar names within 150 m, not farther", () => {
    expect(mergePlaces([g({ name: "Brew & Bloom Cafe", lat: 18.5600, lng: 73.7800 }), o({ name: "Brew and Bloom", lat: 18.5605, lng: 73.7802 })])).toHaveLength(1);
    expect(mergePlaces([g({ name: "Brew & Bloom Cafe", lat: 18.56, lng: 73.78 }), o({ name: "Brew and Bloom", lat: 18.58, lng: 73.78 })])).toHaveLength(2);
  });
  it("keeps different businesses apart", () => {
    expect(mergePlaces([g({ name: "Smile Dental", lat: 18.56, lng: 73.78 }), g({ name: "Glow Salon", lat: 18.5601, lng: 73.7801 })])).toHaveLength(2);
  });
});

describe("scoreWebsiteDev", () => {
  const base = () => mergePlaces([g({ name: "Pink City Dental", phone: "9000011111", rating: 4.7, reviews: 390 })])[0];
  const now = new Date("2026-09-22");
  it("no website + busy + phone = hot", () => {
    const l = base(); l.audit = emptyAudit("none");
    const r = scoreWebsiteDev(l, now);
    expect(r.score).toBe(70);
    expect(r.tier).toBe("hot");
    expect(r.whyNow).toMatch(/has no website even though 390 people/);
  });
  it("old, slow, insecure site scores high", () => {
    const l = base();
    l.audit = { ...emptyAudit("ok"), https: false, mobileViewport: false, copyrightYear: 2019, pageSpeed: { score: 22 }, emails: ["a@b.in"] };
    const r = scoreWebsiteDev(l, now);
    expect(r.signals.map((s) => s.key)).toEqual(["not_mobile", "very_slow", "no_https", "stale", "busy", "has_phone", "has_email"]);
    expect(r.score).toBe(85);
    expect(r.tier).toBe("hot");
  });
  it("a good site is cold", () => {
    const l = base(); l.audit = { ...emptyAudit("ok"), https: true, mobileViewport: true, copyrightYear: 2026, pageSpeed: { score: 88 } };
    const r = scoreWebsiteDev(l, now);
    expect(r.tier).toBe("cold");
    expect(r.whyNow).toMatch(/looks fine/);
  });
  it("caps at 100", () => {
    const l = base(); l.audit = { ...emptyAudit("ok"), freeSubdomain: true, builder: "Wix free site", https: false, mobileViewport: false, copyrightYear: 2015, pageSpeed: { score: 10 }, emails: ["x@y.in"] };
    expect(scoreWebsiteDev(l, now).score).toBe(100);
  });
});

import { describe, expect, it } from "vitest";
import { tradeHints } from "@/lib/enrich/crawl";
import { scoreLogistics } from "@/lib/score/logistics";
import { firstMessage, followUpMessage, issueChips } from "@/lib/outreach";
import { categoriesFor } from "@/lib/categories";
import { leadsReport } from "@/lib/report";
import { leadsToCsv } from "@/lib/csv";
import type { Lead, SearchRecord } from "@/lib/types";

const audit = (trade = {}) => ({ status: "ok" as const, emails: [], phones: [], socials: {}, trade });
const lead = (over: Partial<Lead> = {}): Lead => ({
  id: "1", name: "Shiv Steel Industries", category: "Manufacturer", city: "Vadodara", address: "Plot 45, GIDC Makarpura, Vadodara",
  phone: "+919825012345", phones: ["+919825012345"], emails: [], sources: ["google"], signals: [], score: 0, tier: "cold", whyNow: "", ...over,
});
const scored = (l: Lead, client = "Shree Logistics", services?: Parameters<typeof scoreLogistics>[1]) => {
  const r = scoreLogistics(l, services);
  return { ...l, ...r, pitchFor: { ...r.pitchFor, client } };
};

describe("what a website says about shipping", () => {
  it("finds exports, countries, pan-India supply, IEC, B2B listings and online selling", () => {
    const t = tradeHints("Leading manufacturers and exporters of steel pipes to UAE, USA and Kenya. Supplying pan India. IEC No 123.", ["indiamart.com", "www.example.com"]);
    expect(t).toMatchObject({ exports: true, iec: true, panIndia: true, manufactures: true, b2b: ["IndiaMart"] });
    expect(t.countries).toEqual(expect.arrayContaining(["UAE", "USA", "Kenya"]));
    expect(tradeHints("Shop now. Free shipping on all orders.", []).sellsOnline).toBe(true);
    expect(tradeHints("Buy on", ["amazon.in"]).sellsOnline).toBe(true);
    expect(tradeHints("A family dental clinic in Alkapuri.", [])).toEqual({});
  });
});

describe("scoring for a logistics client", () => {
  it("rates an exporting factory in an industrial estate as a top lead, and says what it needs", () => {
    const r = scoreLogistics(lead({ audit: audit({ exports: true, countries: ["UAE", "USA"], panIndia: true }) }));
    expect(r.tier).toBe("hot");
    expect(r.signals.map((s) => s.key)).toEqual(expect.arrayContaining(["makes_goods", "exports", "pan_india", "industrial"]));
    expect(r.signals.find((s) => s.key === "industrial")!.label).toBe("In an industrial area (GIDC Makarpura)");
    expect(r.whyNow).toBe("Manufacturer in GIDC Makarpura that exports to UAE and USA and supplies across India. Likely needs truck freight, export forwarding and customs clearance.");
    expect(r.pitchFor.needs).toEqual(["freight", "forwarding", "customs"]);
  });

  it("only counts services the client offers", () => {
    const r = scoreLogistics(lead({ audit: audit({ exports: true }) }), ["freight", "courier"]);
    expect(r.pitchFor.needs).toEqual(["freight"]);
    expect(r.signals.find((s) => s.key === "exports")!.points).toBe(10); // exports matter less without forwarding/customs
  });

  it("marks transporters and couriers as competitors, not customers", () => {
    const r = scoreLogistics(lead({ name: "Maruti Roadways Transport", address: "Vadodara" }));
    expect(r.score).toBe(0);
    expect(r.tier).toBe("cold");
    expect(r.whyNow).toMatch(/competitor/);
    expect(issueChips(scored(lead({ name: "Om Cargo Movers" })))[0]).toEqual({ label: "Logistics company", kind: "bad" });
  });

  it("sees online sellers as courier customers", () => {
    const r = scoreLogistics(lead({ name: "Kala Boutique", category: "Online seller", address: "Alkapuri" }), ["courier"]);
    expect(r.tier).toBe("warm");
    expect(r.pitchFor.needs).toEqual(["courier"]);
  });

  it("has its own business types", () => {
    const keys = categoriesFor("logistics").map((c) => c.key);
    expect(keys).toEqual(expect.arrayContaining(["manufacturer", "exporter", "importer", "wholesaler", "online_seller"]));
    expect(keys).not.toContain("dentist");
    expect(categoriesFor("website_development").map((c) => c.key)).not.toContain("exporter");
  });
});

describe("messages for a logistics client", () => {
  const l = scored(lead({ owner: { name: "Rakesh Patel", via: "google_maps" }, audit: audit({ exports: true, countries: ["UAE", "USA"] }) }));
  it("mentions what we saw, the client, and the services that fit", () => {
    expect(firstMessage(l, "en", { name: "Divy" })).toBe(
      "Hi Rakesh, I came across Shiv Steel Industries. I saw you export to UAE and USA. I'm Divy from Shree Logistics. We handle truck freight, export forwarding and customs clearance for businesses like yours: pickup, paperwork and tracking in one place, usually at better rates than booking each load separately. Could we quote for your next export shipment?",
    );
    expect(firstMessage(l, "en", { name: "Divy" }, "short")).toBe("Hi Rakesh, Divy from Shree Logistics here. We handle truck freight, export forwarding and customs clearance from Vadodara. Can we quote for your next shipment?");
    expect(firstMessage(l, "hi", { name: "Divy" })).toMatch(/^Namaste Rakesh ji, maine dekha aap UAE aur USA export karte hain\. Main Divy, Shree Logistics se\./);
    expect(followUpMessage(l, "en", { name: "Divy" })).toMatch(/shipping for Shiv Steel Industries/);
  });
  it("shows fit chips instead of website problems", () => {
    expect(issueChips(l).map((c) => c.label)).toEqual(["Exporter", "Industrial area", "Factory"]);
  });
});

describe("report and CSV for the client", () => {
  const search = { id: "s", createdAt: "2026-09-29T10:00:00Z", status: "done", counts: {} as never, params: { sells: "logistics", categories: ["manufacturer", "exporter"], city: "Vadodara", area: "Makarpura", client: { name: "Shree <Logistics>", services: ["freight", "customs"] } } as never } as SearchRecord;
  const leads = [
    scored(lead({ id: "a", audit: audit({ exports: true, countries: ["UAE"] }), email: "sales@shivsteel.in", website: "https://shivsteel.in" }), "Shree Logistics", ["freight", "customs"]),
    scored(lead({ id: "b", name: "Maruti Roadways Transport" })),
    scored(lead({ id: "c", name: "Pending one" })) && { ...scored(lead({ id: "c", name: "Pending one" })), pending: true },
  ];
  it("lists the best leads with why they fit and how to reach them, leaving out competitors", () => {
    const html = leadsReport({ search, leads, by: "Divy", now: new Date("2026-09-29T12:00:00Z") });
    expect(html).toContain("Leads for Shree &lt;Logistics&gt;"); // escaped
    expect(html).toContain("prepared by Divy");
    expect(html).toContain("Shiv Steel Industries");
    expect(html).toContain("sales@shivsteel.in");
    expect(html).toContain("Likely needs: truck freight, customs clearance");
    expect(html).not.toContain("Maruti Roadways");
    expect(html).not.toContain("Pending one");
    expect(html).not.toMatch(/<script/i);
  });
  it("adds needs and export countries to the CSV", () => {
    const [head, row] = leadsToCsv([leads[0]]).replace(/^﻿/, "").split("\r\n");
    expect(head).toContain("Likely needs,Exports to,Listed on");
    expect(row).toContain(",truck freight; customs clearance,UAE,");
  });
});

import { describe, expect, it } from "vitest";
import { firstMessage, senderFor } from "@/lib/outreach";
import { parsePriceList } from "@/lib/brain";
import { scoreWebsiteDev } from "@/lib/score/websiteDev";
import { scoreLogistics } from "@/lib/score/logistics";
import { emptyAudit } from "@/lib/enrich/crawl";
import type { Lead } from "@/lib/types";

const lead = (over: Partial<Lead> = {}): Lead => {
  const l = { id: "a", name: "Aum Dental Care", category: "Dentist", city: "Vadodara", phones: ["+919825011111"], phone: "+919825011111", emails: [], sources: ["google"], signals: [], score: 0, tier: "cold", whyNow: "", audit: emptyAudit("none"), ...over } as Lead;
  return { ...l, ...scoreWebsiteDev(l) };
};
const pixel = { name: "Pixel Craft Studio", city: "Vadodara", sender: { name: "Divy" }, pitch: { usp: "We've built 120+ clinic websites", priceHook: "Websites from ₹14,999", mentionPrice: true } };

describe("messages written for a client (Business Brain)", () => {
  it("introduces you from the client's company, with their reason and price line", () => {
    const me = senderFor({ name: "Someone else", work: "freelancer" }, pixel);
    expect(me).toMatchObject({ name: "Divy", company: "Pixel Craft Studio", city: "Vadodara", usp: pixel.pitch.usp, priceLine: "Websites from ₹14,999" });
    const m = firstMessage(lead(), "en", me);
    expect(m).toContain("I'm Divy from Pixel Craft Studio in Vadodara. We've built 120+ clinic websites. Websites from ₹14,999.");
    expect(m).not.toContain("freelancer");
    expect(firstMessage(lead(), "en", me, "short")).toMatch(/^Hi there, Divy here, from Pixel Craft Studio\. .* We can build you a simple website\. Websites from ₹14,999\. /);
    expect(firstMessage(lead(), "hi", me)).toContain("Main Divy, Pixel Craft Studio se. We've built 120+ clinic websites.");
  });

  it("leaves the price out unless the client chose to show it, and changes nothing without a client", () => {
    expect(senderFor({ name: "Divy" }, { ...pixel, pitch: { ...pixel.pitch, mentionPrice: false } }).priceLine).toBeUndefined();
    expect(senderFor({ name: "Divy" }, null)).toEqual({ name: "Divy" });
  });

  it("a logistics client's reason goes after the services", () => {
    const l0 = { id: "b", name: "Shiv Steel", category: "Manufacturer", city: "Vadodara", address: "Plot 4, GIDC Makarpura", phones: [], emails: [], sources: ["google"], signals: [], score: 0, tier: "cold", whyNow: "", audit: { ...emptyAudit("ok"), trade: { exports: true } } } as unknown as Lead;
    const s = scoreLogistics(l0, ["customs", "sea"]);
    const l = { ...l0, ...s, pitchFor: s.pitchFor } as Lead; // no client name on the lead: the brain's company is used
    const m = firstMessage(l, "en", senderFor({ name: "Divy" }, { name: "Shree Logistics", pitch: { usp: "Own customs licence, so clearance is same day" } }));
    expect(m).toContain("I'm Divy from Shree Logistics");
    expect(m).toContain("usually at better rates than booking each load separately. Own customs licence, so clearance is same day. Could we quote");
  });

  it("reads a pasted price list", () => {
    expect(parsePriceList("Basic website - ₹9,999\nE-commerce site: from ₹35,000\nSEO | ₹5,000 per month\nLogo design\nAMC — on request")).toEqual([
      { name: "Basic website", price: "₹9,999" },
      { name: "E-commerce site", price: "from ₹35,000" },
      { name: "SEO", price: "₹5,000 per month" },
      { name: "Logo design" },
      { name: "AMC", price: "on request" },
    ]);
  });
});

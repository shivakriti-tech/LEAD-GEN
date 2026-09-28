import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { emailLink, firstMessage, issueChips, shortAddress, whatsappLink, whatsappNumber } from "@/lib/outreach";
import { emptyAudit } from "@/lib/enrich/crawl";
import { leadsToCsv } from "@/lib/csv";
import type { Lead } from "@/lib/types";

const lead = (over: Partial<Lead> = {}): Lead => ({
  id: "1", name: "Aum Dental Care", category: "Dentist", city: "Vadodara", address: "Shop 4, Race Course Rd, Alkapuri, Vadodara, Gujarat 390007",
  phone: "+912652333394", phones: ["+912652333394", "+919825011111"], emails: [], sources: ["google"], signals: [], score: 80, tier: "hot", whyNow: "", ...over,
});

describe("outreach helpers", () => {
  it("shortens an address to street and area", () => {
    expect(shortAddress("Shop 4, Race Course Rd, Alkapuri, Vadodara, Gujarat 390007", "Vadodara")).toBe("Race Course Rd, Alkapuri");
    expect(shortAddress(undefined, "Vadodara")).toBeUndefined();
  });

  it("WhatsApps a mobile, never a landline, and prefers the site's WhatsApp number", () => {
    expect(whatsappNumber(lead())).toBe("+919825011111");
    expect(whatsappNumber(lead({ phones: ["+912652333394"] }))).toBeUndefined();
    expect(whatsappNumber(lead({ audit: { ...emptyAudit("ok"), whatsapp: "+919000011111" } }))).toBe("+919000011111");
    expect(whatsappLink(lead({ audit: emptyAudit("none") }), "en", "Riya, WebCraft")).toMatch(/^https:\/\/wa\.me\/919825011111\?text=Hi%20/);
  });

  it("writes a first message in English or Hinglish that greets the owner and names the problem", () => {
    const l = lead({ owner: { name: "Dr. Mehul Shah", via: "google_maps" }, audit: emptyAudit("none") });
    const en = firstMessage(l, "en", "Riya, WebCraft");
    expect(en).toMatch(/^Hi Dr\. Mehul,/);
    expect(en).toContain("don't have a website");
    expect(en).toContain("dentist in Vadodara");
    expect(en).toMatch(/– Riya, WebCraft$/);
    const hi = firstMessage(l, "hi");
    expect(hi).toMatch(/^Namaste Dr\. Mehul ji,/);
    expect(hi).toContain("website nahi hai");
    expect(hi).toMatch(/\[aapka naam\]$/);
    const down = firstMessage(lead({ website: "https://moticafe.in", audit: { ...emptyAudit("down"), finalUrl: "https://moticafe.in/" } }), "en");
    expect(down).toContain("Your website (moticafe.in) isn't loading");
  });

  it("emails only when there's an address", () => {
    expect(emailLink(lead())).toBeUndefined();
    expect(emailLink(lead({ email: "hi@aum.in" }))).toMatch(/^mailto:hi@aum\.in\?subject=A%20quick%20idea/);
  });

  it("shows at most three problem chips, the website state first", () => {
    const l = lead({ audit: { ...emptyAudit("ok"), copyrightYear: 2018 }, signals: [{ key: "not_mobile", label: "", points: 25 }, { key: "no_https", label: "", points: 10 }, { key: "stale", label: "", points: 10 }, { key: "free_builder", label: "", points: 20 }] });
    expect(issueChips(l).map((c) => c.label)).toEqual(["Not mobile-friendly", "No HTTPS", "Not updated since 2018"]);
    expect(issueChips(lead({ audit: emptyAudit("none") }))[0]).toEqual({ label: "No website", kind: "bad" });
    expect(issueChips(lead({ pending: true }))).toEqual([]);
  });

  it("puts status and note in the CSV", () => {
    const csv = leadsToCsv([lead({ followUp: { status: "interested", note: "call Monday", updatedAt: "2026-09-29" } })]);
    const [head, row] = csv.replace(/^﻿/, "").split("\r\n");
    expect(head.split(",").slice(0, 3)).toEqual(["Score", "Status", "Note"]);
    expect(row.split(",").slice(0, 3)).toEqual(["80", "Interested", "call Monday"]);
  });
});

describe("saving a lead's status (local store)", () => {
  afterEach(() => vi.restoreAllMocks());
  it("updates just that lead and keeps the rest", async () => {
    vi.spyOn(process, "cwd").mockReturnValue(mkdtempSync(path.join(os.tmpdir(), "lead-store-")));
    vi.stubEnv("SUPABASE_URL", "");
    const { getStore } = await import("@/lib/store");
    const store = getStore();
    const s = { id: "55555555-5555-4555-8555-555555555555", createdAt: "2026-09-29T00:00:00Z", params: {} as never, status: "done" as const, counts: { found: 2, afterDedupe: 2, hot: 1, warm: 0, cold: 1 } };
    await store.saveSearch(s);
    await store.saveLeads(s.id, [lead({ id: "a" }), lead({ id: "b", name: "Other" })]);
    const up = await store.updateLead(s.id, "a", { status: "contacted", note: "sent WhatsApp", updatedAt: "2026-09-29T10:00:00Z" });
    expect(up?.followUp?.status).toBe("contacted");
    const back = await store.getSearch(s.id);
    expect(back!.leads.find((l) => l.id === "a")!.followUp).toMatchObject({ status: "contacted", note: "sent WhatsApp" });
    expect(back!.leads.find((l) => l.id === "b")!.followUp).toBeUndefined();
    expect(await store.updateLead(s.id, "nope", { status: "won", updatedAt: "" })).toBeNull();
    vi.unstubAllEnvs();
  });
});

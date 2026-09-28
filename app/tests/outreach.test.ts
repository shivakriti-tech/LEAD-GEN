import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { addDays, dueLabel, emailLink, firstMessage, followUpLabel, followUpMessage, issueChips, normalizeStatus, scoreSummary, shortAddress, whatsappLink, whatsappNumber } from "@/lib/outreach";
import { mergeFollowUp, pipeline, validPatch } from "@/lib/followups";
import type { Store } from "@/lib/store";
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
    expect(en).toContain("I noticed Aum Dental Care doesn't have a website yet");
    expect(en).toContain("dentist in Vadodara");
    expect(en).toMatch(/– Riya, WebCraft$/);
    const hi = firstMessage(l, "hi");
    expect(hi).toMatch(/^Namaste Dr\. Mehul ji,/);
    expect(hi).toContain("website nahi hai");
    expect(hi).toMatch(/\[aapka naam\]$/);
    const down = firstMessage(lead({ website: "https://moticafe.in", audit: { ...emptyAudit("down"), finalUrl: "https://moticafe.in/" } }), "en");
    expect(down).toContain("website (moticafe.in) isn't loading");
    expect(firstMessage(lead({ audit: emptyAudit("none") }), "en")).toMatch(/^Hi there,/);
  });

  it("writes a short follow-up nudge", () => {
    expect(followUpMessage(lead(), "en", "Riya")).toMatch(/^Hi there, just following up on my message about a website for Aum Dental Care\..*– Riya$/);
    expect(followUpMessage(lead(), "hi")).toMatch(/^Namaste ji, Aum Dental Care ki website/);
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
    expect(row.split(",").slice(0, 3)).toEqual(["80", "Replied", "call Monday"]);
  });
});

describe("statuses, follow-up dates and the score in a line", () => {
  it("maps old saved statuses to the new ones", () => {
    expect(normalizeStatus("interested")).toBe("replied");
    expect(normalizeStatus("not_fit")).toBe("lost");
    expect(normalizeStatus("meeting")).toBe("meeting");
    expect(normalizeStatus("junk")).toBe("new");
    expect(followUpLabel("meeting")).toBe("Meeting booked");
  });

  it("labels due dates in plain words", () => {
    expect(dueLabel("2026-09-28", "2026-09-28")).toBe("Today");
    expect(dueLabel("2026-09-29", "2026-09-28")).toBe("Tomorrow");
    expect(dueLabel("2026-09-20", "2026-09-28")).toMatch(/^Overdue · /);
    expect(addDays(3, new Date("2026-09-28T12:00:00"))).toBe("2026-10-01");
  });

  it("explains a score in a few words", () => {
    const l = lead({ reviews: 212, signals: [{ key: "no_website", label: "No website", points: 40 }, { key: "busy", label: "Busy", points: 15 }, { key: "owner_known", label: "Owner", points: 5 }] });
    expect(scoreSummary(l)).toBe("No website + 212 reviews + Owner known");
    expect(scoreSummary(lead())).toBe("Nothing stands out");
  });

  it("merges a follow-up change, remembering when you first made contact", () => {
    const t1 = new Date("2026-09-28T10:00:00Z"), t2 = new Date("2026-09-30T10:00:00Z");
    const a = mergeFollowUp(undefined, { status: "contacted", followUpOn: "2026-10-01" }, t1);
    expect(a).toMatchObject({ status: "contacted", followUpOn: "2026-10-01", contactedAt: t1.toISOString() });
    const b = mergeFollowUp(a, { status: "replied", note: "wants a quote" }, t2);
    expect(b).toMatchObject({ status: "replied", note: "wants a quote", followUpOn: "2026-10-01", contactedAt: t1.toISOString() });
    expect(mergeFollowUp(b, { followUpOn: null }, t2).followUpOn).toBeUndefined();
    expect(mergeFollowUp(b, { status: "won" }, t2).followUpOn).toBeUndefined();
    expect(mergeFollowUp(b, { status: "new" }, t2).contactedAt).toBeUndefined();
    expect(mergeFollowUp(undefined, { followUpOn: "tomorrow" }, t1).followUpOn).toBeUndefined();
  });

  it("accepts only known fields in a change", () => {
    expect(validPatch({ status: "won", note: "x", followUpOn: null, evil: 1 })).toEqual({ status: "won", note: "x", followUpOn: null });
    expect(validPatch({ status: "hacked" })).toEqual({});
    expect(validPatch("nope")).toBeNull();
  });

  it("lists follow-ups due today or overdue across searches, skipping closed leads", async () => {
    const now = new Date("2026-09-28T12:00:00Z");
    const fu = (followUpOn: string, status: "contacted" | "won" = "contacted", contactedAt = "2026-09-27T10:00:00Z") => ({ status, followUpOn, contactedAt, updatedAt: "" });
    const leads = [
      lead({ id: "a", name: "Late", score: 50, followUp: fu("2026-09-25") }),
      lead({ id: "b", name: "Today", score: 90, followUp: fu("2026-09-28") }),
      lead({ id: "c", name: "Later", followUp: fu("2026-10-05", "contacted", "2026-09-01T00:00:00Z") }),
      lead({ id: "d", name: "Won", followUp: { status: "won", followUpOn: "2026-09-20", updatedAt: "" } }),
      lead({ id: "e", name: "Untouched" }),
    ];
    const s = { id: "s1", createdAt: "", params: { city: "Vadodara", area: "Alkapuri" } as never, status: "done" as const, counts: {} as never };
    const store = { listSearches: async () => [s], getSearch: async () => ({ search: s, leads }) } as unknown as Store;
    const p = await pipeline(store, "2026-09-28", now);
    expect(p.due.map((d) => d.lead.name)).toEqual(["Late", "Today"]);
    expect(p.due[0].search).toBe("Alkapuri, Vadodara");
    expect(p.contactedThisWeek).toBe(2);
    expect(p.byStatus).toMatchObject({ contacted: 3, new: 1 });
  });
});

describe("saving follow-ups and deleting leads (local store)", () => {
  afterEach(() => vi.restoreAllMocks());
  it("updates just the chosen leads, keeps the rest, and deletes by id", async () => {
    vi.spyOn(process, "cwd").mockReturnValue(mkdtempSync(path.join(os.tmpdir(), "lead-store-")));
    vi.stubEnv("SUPABASE_URL", "");
    const { getStore } = await import("@/lib/store");
    const store = getStore();
    const s = { id: "55555555-5555-4555-8555-555555555555", createdAt: "2026-09-29T00:00:00Z", params: {} as never, status: "done" as const, counts: { found: 3, afterDedupe: 3, hot: 1, warm: 0, cold: 2 } };
    await store.saveSearch(s);
    await store.saveLeads(s.id, [lead({ id: "a" }), lead({ id: "b", name: "Other" }), lead({ id: "c", name: "Third" })]);
    const up = await store.updateFollowUps(s.id, [
      { id: "a", followUp: { status: "contacted", note: "sent WhatsApp", updatedAt: "2026-09-29T10:00:00Z" } },
      { id: "nope", followUp: { status: "won", updatedAt: "" } },
    ]);
    expect(up.map((l) => l.id)).toEqual(["a"]);
    let back = await store.getSearch(s.id);
    expect(back!.leads.find((l) => l.id === "a")!.followUp).toMatchObject({ status: "contacted", note: "sent WhatsApp" });
    expect(back!.leads.find((l) => l.id === "b")!.followUp).toBeUndefined();
    expect(await store.deleteLeads(s.id, ["b", "c", "zzz"])).toBe(2);
    back = await store.getSearch(s.id);
    expect(back!.leads.map((l) => l.id)).toEqual(["a"]);
    vi.unstubAllEnvs();
  });
});

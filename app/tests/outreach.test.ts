import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { addDays, dueLabel, emailLink, firstMessage, followUpLabel, followUpMessage, issueChips, normalizeStatus, pitchText, scoreSummary, shortAddress, toneFor, whatsappLink, whatsappNumber } from "@/lib/outreach";
import { mergeFollowUp, pipeline, touchedElsewhere, touchKeys, validPatch } from "@/lib/followups";
import { estimate, sameSearch } from "@/app/_ui/SearchForm";
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

  it("writes a first message in English or Hinglish that greets the owner, names the problem and introduces you", () => {
    const me = { name: "Divy", work: "web developer", city: "Vadodara", link: "divy.dev" };
    const l = lead({ owner: { name: "Dr. Mehul Shah", via: "google_maps" }, audit: emptyAudit("none"), rating: 4.8, reviews: 212 });
    const en = firstMessage(l, "en", me);
    expect(en).toMatch(/^Hi Dr\. Mehul, I came across Aum Dental Care on Google\. 212 reviews and a 4\.8 rating is really good\./);
    expect(en).toContain("there's no website yet, so people searching for a dentist in Vadodara");
    expect(en).toContain("booking button helps new patients"); // what a site does for a clinic
    expect(en).toContain("I'm Divy, a web developer in Vadodara.");
    expect(en).toMatch(/Some of my work: divy\.dev$/);
    const hi = firstMessage(l, "hi");
    expect(hi).toMatch(/^Namaste Dr\. Mehul ji,/);
    expect(hi).toContain("website nahi hai");
    expect(hi).toContain("Main [aapka naam] hoon");
    const down = firstMessage(lead({ website: "https://moticafe.in", category: "Café & bakery", audit: { ...emptyAudit("down"), finalUrl: "https://moticafe.in/" } }), "en");
    expect(down).toContain("your website (moticafe.in) and it isn't loading");
    expect(firstMessage(lead({ audit: emptyAudit("none") }), "en")).toMatch(/^Hi there,/);
    // no praise for a poor or thin rating
    expect(firstMessage(lead({ audit: emptyAudit("none"), rating: 3.6, reviews: 400 }), "en")).not.toContain("rating is really good");
  });

  it("writes a short version, and fits the pitch to the kind of business", () => {
    const me = { name: "Divy", city: "Vadodara" };
    const l = lead({ audit: emptyAudit("none"), reviews: 212 });
    expect(firstMessage(l, "en", me, "short")).toBe("Hi there, Divy here, web developer from Vadodara. Aum Dental Care has 212 Google reviews but no website. I can build you a simple website. Can I show you a quick sample?");
    const salon = lead({ name: "Kiran Beauty Salon", category: "Salon & spa", audit: { ...emptyAudit("social_only"), socials: { instagram: "x" } } });
    expect(firstMessage(salon, "en")).toContain("people can only find you on Instagram");
    expect(firstMessage(salon, "en")).toContain("prices and a booking button");
    const slow = lead({ website: "https://shree.in", audit: { ...emptyAudit("ok"), finalUrl: "https://shree.in/", copyrightYear: 2018 }, signals: [{ key: "not_mobile", label: "", points: 25 }, { key: "stale", label: "", points: 10 }] });
    expect(firstMessage(slow, "en", me, "short")).toContain("Aum Dental Care's website is not mobile-friendly and not updated since 2018.");
    expect(firstMessage(slow, "hi", me, "short")).toContain("phone pe theek se nahi dikhti aur 2018 se update nahi hui");
  });

  it("starts with a follow-up once you've messaged them", () => {
    expect(toneFor(lead(), "short")).toBe("short");
    expect(toneFor(lead({ followUp: { status: "contacted", updatedAt: "" } }), "short")).toBe("follow");
    expect(toneFor(lead({ followUp: { status: "won", updatedAt: "" } }), "friendly")).toBe("friendly");
    expect(pitchText(lead(), "en", "follow", { name: "Divy" })).toMatch(/^Hi there, just following up.*– Divy$/);
  });

  it("writes a short follow-up nudge", () => {
    expect(followUpMessage(lead(), "en", "Riya")).toMatch(/^Hi there, just following up on my message about a website for Aum Dental Care\..*– Riya$/);
    expect(followUpMessage(lead(), "hi")).toMatch(/^Namaste ji, Aum Dental Care ki website/);
  });

  it("emails only when there's an address", () => {
    expect(emailLink(lead())).toBeUndefined();
    expect(emailLink(lead({ email: "hi@aum.in" }))).toMatch(/^mailto:hi@aum\.in\?subject=Aum%20Dental/);
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
    // remembers who you've contacted, by phone, for other searches
    const other = lead({ id: "zz", phones: ["+91 98250 11111"] });
    expect(touchKeys(other)).toContain("p:9825011111");
    expect(touchedElsewhere(other, "s2", p.touched)).toMatchObject({ search: "Alkapuri, Vadodara" });
    expect(touchedElsewhere(leads[0], "s1", p.touched)?.leadId).not.toBe("a"); // itself doesn't count
    // results per business type, per city and overall
    expect(p.stats["vadodara|Dentist"]).toMatchObject({ searches: 1, total: 5, hot: 5, noSite: 5 });
    expect(p.stats["*|Dentist"].total).toBe(5);
  });

  it("estimates a new search from past ones, and spots a repeat", () => {
    const stats = { "vadodara|Dentist": { searches: 2, total: 30, hot: 12, noSite: 20 }, "*|Salon & spa": { searches: 1, total: 8, hot: 2, noSite: 3 } };
    expect(estimate(stats, "Vadodara", ["dentist", "salon", "gym"])).toEqual({ total: 23, hot: 8, known: 2 });
    expect(estimate(stats, "Surat", ["gym"])).toBeNull();
    const h = [{ id: "x", createdAt: new Date(Date.now() - 3 * 86_400_000).toISOString(), status: "done" as const, params: { city: "Vadodara", area: "Alkapuri", categories: ["dentist", "salon"] } as never, counts: { found: 0, afterDedupe: 20, hot: 5, warm: 0, cold: 0 } }];
    expect(sameSearch(h, { city: "vadodara ", area: "alkapuri", cats: ["dentist"] })?.id).toBe("x");
    expect(sameSearch(h, { city: "Vadodara", area: "", cats: ["dentist"] })).toBeUndefined();
    expect(sameSearch(h, { city: "Vadodara", area: "Alkapuri", cats: ["gym"] })).toBeUndefined();
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

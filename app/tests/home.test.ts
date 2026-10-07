import { describe, expect, it } from "vitest";
import { homeData, localDay, windowed } from "@/lib/home";
import { historyOf, mergeFollowUp, validPatch } from "@/lib/followups";
import type { Store } from "@/lib/store";
import type { Lead, SearchRecord } from "@/lib/types";

const lead = (over: Partial<Lead>): Lead => ({ id: "x", name: "Biz", category: "Dentist", phones: [], emails: [], sources: ["google"], signals: [], score: 80, tier: "hot", whyNow: "", ...over });
const search = (id: string, area: string, createdAt: string): SearchRecord => ({ id, createdAt, params: { city: "Vadodara", area } as never, status: "done", counts: { found: 0, afterDedupe: 0, hot: 1, warm: 0, cold: 0 } });
const fakeStore = (data: Array<{ search: SearchRecord; leads: Lead[] }>) =>
  ({ listSearches: async () => data.map((d) => d.search), getSearch: async (id: string) => data.find((d) => d.search.id === id) ?? null }) as unknown as Store;

describe("status history and deal value", () => {
  it("records each status change with its time, and keeps a deal value", () => {
    const t1 = new Date("2026-09-20T05:00:00Z"), t2 = new Date("2026-09-22T05:00:00Z"), t3 = new Date("2026-09-25T05:00:00Z");
    const a = mergeFollowUp(undefined, { status: "contacted" }, t1);
    const b = mergeFollowUp(a, { note: "call back" }, t2); // no status change, no new entry
    const c = mergeFollowUp(b, { status: "won", value: 15000 }, t3);
    expect(c.history).toEqual([{ status: "contacted", at: t1.toISOString() }, { status: "won", at: t3.toISOString() }]);
    expect(c.value).toBe(15000);
    expect(mergeFollowUp(c, { value: null }, t3).value).toBeUndefined();
    expect(validPatch({ value: -5 })).toEqual({});
    expect(validPatch({ value: 2500 })).toEqual({ value: 2500 });
  });

  it("rebuilds history for leads saved before it existed", () => {
    expect(historyOf({ status: "replied", contactedAt: "2026-09-01T00:00:00Z", updatedAt: "2026-09-03T00:00:00Z" })).toEqual([
      { status: "contacted", at: "2026-09-01T00:00:00Z" },
      { status: "replied", at: "2026-09-03T00:00:00Z" },
    ]);
    expect(historyOf(undefined)).toEqual([]);
  });

  it("puts a time on your local day", () => {
    expect(localDay("2026-09-28T20:00:00Z", -330)).toBe("2026-09-29"); // 1:30 am in India
    expect(localDay("2026-09-28T20:00:00Z", 0)).toBe("2026-09-28");
  });
});

describe("Home numbers", () => {
  it("counts messages and replies per day, the pipeline, and the leads still waiting", async () => {
    const h = (s: string, at: string) => ({ status: s as never, at });
    const alk = {
      search: search("s1", "Alkapuri", "2026-09-27T10:00:00Z"),
      leads: [
        lead({ id: "a", name: "Aum", phones: ["+919825011111"], followUp: { status: "replied", contactedAt: "2026-09-26T06:00:00Z", updatedAt: "", history: [h("contacted", "2026-09-26T06:00:00Z"), h("replied", "2026-09-27T06:00:00Z")] } }),
        lead({ id: "b", name: "Smile", category: "Salon & spa", followUp: { status: "won", value: 20000, contactedAt: "2026-09-27T06:00:00Z", updatedAt: "", history: [h("contacted", "2026-09-27T06:00:00Z"), h("meeting", "2026-09-28T06:00:00Z"), h("won", "2026-09-28T09:00:00Z")] } }),
        lead({ id: "c", name: "Fresh", score: 90, phones: ["+919000000001"] }),
        lead({ id: "d", name: "Cold one", tier: "cold" }),
        lead({ id: "e", name: "Still checking", pending: true }),
      ],
    };
    const manj = {
      search: search("s2", "Manjalpur", "2026-09-20T10:00:00Z"),
      leads: [
        lead({ id: "f", name: "Aum again", phones: ["+91 98250 11111"], score: 99 }), // already messaged in Alkapuri
        lead({ id: "g", name: "Fresh again", phones: ["+919000000001"], score: 70 }), // same as "Fresh"
        lead({ id: "h", name: "Other", score: 60 }),
      ],
    };
    const d = await homeData(fakeStore([alk, manj]), { today: "2026-09-28", tz: -330 });
    expect(d.days).toHaveLength(60);
    expect(d.days.at(-1)).toMatchObject({ date: "2026-09-28", messaged: 0, replied: 1, meetings: 1, won: 1, wonValue: 20000 });
    expect(d.days.at(-2)).toMatchObject({ date: "2026-09-27", messaged: 1, replied: 1 });
    expect(windowed(d.days, 7, "messaged")).toEqual({ now: 2, prev: 0 });
    expect(d.byStatus).toMatchObject({ replied: 1, won: 1, new: 6 });
    expect(d.waiting.map((l) => l.name)).toEqual(["Fresh", "Other"]);
    expect(d.waiting[0].search).toBe("Alkapuri, Vadodara");
    expect(d.recent.map((r) => r.lead.name)).toEqual(["Smile", "Aum"]);
    expect(d.byCategory).toEqual({ Dentist: { messaged: 1, replied: 1 }, "Salon & spa": { messaged: 1, replied: 1 } });
    expect(d.latest).toMatchObject({ id: "s1", search: "Alkapuri, Vadodara" });
    expect(d.searches).toBe(2);
  });
});

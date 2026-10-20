import { describe, expect, it } from "vitest";
import { aucOf, learnedSignal, learnedSummary, learnFrom } from "@/lib/learn";
import type { Lead } from "@/lib/types";

const NOW = new Date("2026-10-20T12:00:00Z");
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString();
let seq = 0;

/** n messaged leads with these reasons and type, `replied` of them replied, first messaged `ago` days back. */
function batch(n: number, replied: number, keys: string[], opts: { category?: string; ago?: number } = {}): Lead[] {
  return Array.from({ length: n }, (_, i) => {
    const id = `l${seq++}`;
    const at = daysAgo(opts.ago ?? 30);
    return {
      id, name: `Biz ${id}`, placeId: id, category: opts.category ?? "Dentist", phones: [], emails: [], sources: ["google"],
      signals: keys.map((k) => ({ key: k, label: k, points: 10 })), score: 50, tier: "warm", whyNow: "",
      followUp: { status: i < replied ? "replied" : "contacted", updatedAt: at, contactedAt: at, touches: [{ channel: "email", step: 0, at }] },
    } as Lead;
  });
}
const pts = (keys: string[], learned: ReturnType<typeof learnFrom>, category?: string) => learnedSignal(keys.map((k) => ({ key: k, label: k, points: 10 })), learned, category)?.points ?? 0;

describe("the learned scoring model", () => {
  it("doesn't count a reason twice when it only comes along with the one that works", () => {
    // "listed_ig" mostly shows up with "no_website"; on its own it replies no better than anything else
    const learned = learnFrom(
      [...batch(30, 15, ["no_website", "listed_ig"]), ...batch(15, 8, ["no_website"]), ...batch(15, 1, ["listed_ig"]), ...batch(20, 2, ["stale"])],
      NOW,
    );
    expect(learned.signals.listed_ig.lift).toBeGreaterThan(1); // its plain reply rate looks good…
    expect(pts(["listed_ig"], learned)).toBeLessThanOrEqual(0); // …but alone it isn't lifted
    expect(pts(["no_website", "listed_ig"], learned) - pts(["no_website"], learned)).toBeLessThanOrEqual(3);
    expect(pts(["no_website"], learned)).toBeGreaterThan(5);
  });

  it("learns which business types reply, and says so", () => {
    const learned = learnFrom([...batch(20, 12, ["no_website"], { category: "Dentist" }), ...batch(20, 2, ["no_website"], { category: "Cafe" })], NOW);
    const s = learnedSignal([{ key: "no_website", label: "", points: 55 }], learned, "Dentist")!;
    expect(s.points).toBeGreaterThan(0);
    expect(s.label).toMatch(/^Your results: dentist leads replied \d\.\d× as often \(12 of 20\)$/);
    expect(pts(["no_website"], learned, "Cafe")).toBeLessThan(0);
  });

  it("doesn't count a lead messaged in the last 3 days as 'no reply' yet", () => {
    const learned = learnFrom([...batch(30, 10, ["no_website"]), ...batch(5, 0, ["no_website"], { ago: 1 }), ...batch(2, 2, ["no_website"], { ago: 1 })], NOW);
    expect(learned.contacted).toBe(32);
    expect(learned.replied).toBe(12);
  });

  it("is tested on your newest leads, and not used when it can't tell who replies", () => {
    // older leads: "exports" replied far more; the newest quarter: the opposite
    const flipped = learnFrom(
      [...batch(30, 20, ["exports"], { ago: 200 }), ...batch(30, 5, ["factory"], { ago: 200 }), ...batch(10, 1, ["exports"], { ago: 10 }), ...batch(10, 6, ["factory"], { ago: 10 })],
      NOW,
    );
    expect(flipped.model?.test).toMatchObject({ leads: 20, replied: 7 });
    expect(flipped.model!.test!.auc).toBeLessThan(0.55);
    expect(flipped.model!.useful).toBe(false);
    expect(learnedSignal([{ key: "exports", label: "", points: 20 }], flipped)).toBeUndefined();
    expect(learnedSummary(flipped)).toMatch(/couldn't yet tell who replies \(\d+%, a coin flip is 50%\), so scores stay as written\.$/);

    // when the newest leads agree, it's used, and the log says how well it ranks them
    const steady = learnFrom(
      [...batch(30, 20, ["exports"], { ago: 200 }), ...batch(30, 5, ["factory"], { ago: 200 }), ...batch(10, 7, ["exports"], { ago: 10 }), ...batch(10, 1, ["factory"], { ago: 10 })],
      NOW,
    );
    expect(steady.model!.useful).toBe(true);
    expect(steady.model!.test!.auc).toBeGreaterThan(0.7);
    expect(pts(["exports"], steady)).toBeGreaterThan(0);
    expect(learnedSummary(steady)).toMatch(/^Scores learn from 80 leads you messaged before \(41% replied\)\. Tested on your 20 newest: they put a lead that replied above one that didn't \d+% of the time \(written scores alone: 50%\)\.$/);
  });

  it("says when there isn't enough to learn from yet", () => {
    expect(learnedSummary(learnFrom(batch(12, 3, ["no_website"]), NOW))).toBe("Scores will start learning from your replies after 30 messaged leads of this kind (12 so far).");
    expect(learnedSummary(learnFrom(batch(31, 0, ["no_website"]), NOW))).toMatch(/once the leads you messaged show both replies and silence \(0 of 31/);
    expect(learnedSummary(learnFrom([], NOW))).toBeUndefined();
  });

  it("measures ranking the plain way: how often a replier comes out above a non-replier", () => {
    expect(aucOf([{ y: 1, s: 3 }, { y: 0, s: 1 }, { y: 0, s: 2 }])).toBe(1);
    expect(aucOf([{ y: 1, s: 1 }, { y: 0, s: 1 }])).toBe(0.5);
    expect(aucOf([{ y: 1, s: 0 }, { y: 0, s: 1 }])).toBe(0);
  });
});

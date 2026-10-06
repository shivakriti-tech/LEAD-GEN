import { describe, expect, it } from "vitest";
import { accountOf, balance, canCharge, memoryBillingStore, statement, territoryOwner, topUp } from "@/lib/billing";
import { createHandoff, handoffMessage, memoryHandoffStore, setOutcome, REJECT_DAYS } from "@/lib/handoff";
import { columnOf } from "@/lib/crm";
import { handoffLink } from "@/lib/handoffLink";
import { signedOk } from "@/lib/mail/unsubscribe";
import { mergeFollowUp, type FollowUpPatch } from "@/lib/followups";
import type { Lead } from "@/lib/types";

const NOW = new Date("2026-10-06T10:00:00Z");
const lead = (over: Partial<Lead> = {}): Lead => ({ id: "l1", name: "Lone Star Freight", category: "Trucking & haulage", city: "Houston", country: "US", phone: "+17135550123", phones: ["+17135550123"], email: "mike@lonestar.com", emails: [], sources: ["web"], signals: [], score: 80, tier: "hot", whyNow: "No shipment tracking; hiring a dispatcher.", followUp: { status: "replied", updatedAt: "" }, ...over });
const A = { id: "c1", name: "Shivakriti Tech" }, B = { id: "c2", name: "Other Agency" };

function setup(credits = 5) {
  const billing = memoryBillingStore();
  if (credits) topUp(billing.data, A.id, credits, 5000, "UPI", NOW);
  const handoffs = memoryHandoffStore();
  const leads = new Map<string, Lead>([["l1", lead()]]);
  const patches: FollowUpPatch[] = [];
  const deps = { handoffs, billing, now: () => NOW, patchLead: async (_s: string, id: string, p: FollowUpPatch) => { patches.push(p); const l = leads.get(id)!; l.followUp = mergeFollowUp(l.followUp, p, NOW); } };
  return { billing, handoffs, leads, patches, deps };
}

describe("credits", () => {
  it("top-ups get receipt numbers; a lead costs its price; low balance warns", () => {
    const { billing } = setup(0);
    const e1 = topUp(billing.data, A.id, 10, 5000, undefined, NOW), e2 = topUp(billing.data, A.id, 2, undefined, undefined, NOW);
    expect([e1.receipt, e2.receipt]).toEqual(["R-2026-0001", "R-2026-0002"]);
    expect(balance(billing.data, A.id)).toBe(12);
    billing.data.accounts[A.id] = { ...accountOf(billing.data, A.id), creditsPerLead: 20 };
    expect(canCharge(billing.data, A.id)).toMatchObject({ ok: false });
    billing.data.accounts[A.id].allowOverdraft = true;
    expect(canCharge(billing.data, A.id).ok).toBe(true);
  });
});

describe("handing a lead to a client", () => {
  it("charges a credit, notes it on the lead, and writes the message with the client's link", async () => {
    const { billing, handoffs, leads, deps } = setup();
    const r = await createHandoff(deps, { searchId: "s", lead: leads.get("l1")!, client: A, note: "Call after 3pm" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(balance(billing.data, A.id)).toBe(4);
    expect(handoffs.data).toHaveLength(1);
    expect(leads.get("l1")!.followUp?.note).toBe("Handed to Shivakriti Tech on 2026-10-06");
    const link = await handoffLink(r.handoff.id, { APP_BASE_URL: "https://leads.example.com" });
    expect(link).toMatch(new RegExp(`^https://leads.example.com/api/handoff/${r.handoff.id}\\?t=`));
    expect(await signedOk("handoff", r.handoff.id, new URL(link!).searchParams.get("t")!)).toBe(true);
    expect(await signedOk("handoff", "other-id", new URL(link!).searchParams.get("t")!)).toBe(false);
    const m = handoffMessage(r.handoff, link);
    expect(m.subject).toBe("New lead: Lone Star Freight");
    expect(m.text).toContain("Phone: +17135550123");
    expect(m.text).toContain("Note: Call after 3pm");
    expect(m.text).toContain(`within ${REJECT_DAYS} days`);
  });
  it("one lead goes to one client only, and exclusive areas are respected", async () => {
    const { billing, leads, deps } = setup();
    topUp(billing.data, B.id, 5, undefined, undefined, NOW);
    expect((await createHandoff(deps, { searchId: "s", lead: leads.get("l1")!, client: A })).ok).toBe(true);
    // same business found in another search (same phone)
    expect(await createHandoff(deps, { searchId: "s2", lead: lead({ id: "x9" }), client: B })).toEqual({ ok: false, error: "Already handed to Shivakriti Tech: each lead goes to one client only" });
    billing.data.accounts[A.id] = { ...accountOf(billing.data, A.id), territories: ["dallas|trucking & haulage"] };
    expect(territoryOwner(billing.data, "Dallas", "Trucking & haulage", B.id)).toBe(A.id);
    const r = await createHandoff(deps, { searchId: "s3", lead: lead({ id: "d1", city: "Dallas", phone: "+12145550100", phones: ["+12145550100"] }), client: B });
    expect(r).toEqual({ ok: false, error: "Dallas · Trucking & haulage belongs to another client exclusively" });
    expect(balance(billing.data, B.id)).toBe(5); // nothing charged
  });
  it("no credits, no handoff", async () => {
    const { leads, deps } = setup(0);
    const r = await createHandoff(deps, { searchId: "s", lead: leads.get("l1")!, client: A });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/Not enough credits/);
  });
});

describe("the closed loop: the client reports back", () => {
  it("won updates the lead with the value; the board shows it as won", async () => {
    const { leads, deps } = setup();
    const r = await createHandoff(deps, { searchId: "s", lead: leads.get("l1")!, client: A });
    if (!r.ok) throw new Error();
    expect(columnOf(leads.get("l1")!, r.handoff)).toBe("handed");
    const w = await setOutcome(deps, r.handoff.id, { status: "won", value: 12000 }, "client");
    expect(w).toMatchObject({ ok: true, refunded: false, handoff: { status: "won", value: 12000 } });
    expect(leads.get("l1")!.followUp).toMatchObject({ status: "won", value: 12000 });
    expect(columnOf(leads.get("l1")!, { status: "won" })).toBe("won");
  });
  it("'not a real lead' within 7 days refunds once; later, or after a meeting, the client can't", async () => {
    const { billing, leads, deps } = setup();
    const r = await createHandoff(deps, { searchId: "s", lead: leads.get("l1")!, client: A });
    if (!r.ok) throw new Error();
    expect(await setOutcome(deps, r.handoff.id, { status: "rejected" }, "client")).toMatchObject({ ok: true, refunded: true });
    expect(balance(billing.data, A.id)).toBe(5);
    expect(leads.get("l1")!.followUp?.status).toBe("lost");
    expect(await setOutcome(deps, r.handoff.id, { status: "rejected" }, "client")).toMatchObject({ ok: false });

    const late = setup();
    const r2 = await createHandoff(late.deps, { searchId: "s", lead: late.leads.get("l1")!, client: A });
    if (!r2.ok) throw new Error();
    const later = { ...late.deps, now: () => new Date(NOW.getTime() + 8 * 86_400_000) };
    expect(await setOutcome(later, r2.handoff.id, { status: "rejected" }, "client")).toEqual({ ok: false, error: "Leads can be rejected within 7 days" });
    // you can still refund it yourself
    expect(await setOutcome(later, r2.handoff.id, { status: "rejected" }, "you")).toMatchObject({ ok: true, refunded: true });
  });
});

describe("monthly statement", () => {
  it("opening, entries, leads delivered, value with tax, payments, closing", async () => {
    const { billing, leads, deps } = setup();
    billing.data.accounts[A.id] = { ...accountOf(billing.data, A.id), pricePerCredit: 1000, taxRate: 18, currency: "INR" };
    topUp(billing.data, A.id, 3, 3000, "old", new Date("2026-09-10T00:00:00Z"));
    await createHandoff(deps, { searchId: "s", lead: leads.get("l1")!, client: A });
    const s = statement(billing.data, A.id, "2026-10");
    expect(s).toMatchObject({ opening: 3, closing: 7, leads: 1, used: 1, paid: 5000, value: 1000, tax: 180, total: 1180 });
    expect(s.entries.map((e) => e.kind)).toEqual(["topup", "charge"]);
  });
});

import { describe, expect, it } from "vitest";
import { mergeFollowUp, validPatch } from "@/lib/followups";
import { canContact, followUpAfter, lastFollowUp, messageForStep, nextStep } from "@/lib/outreach";
import type { Lead } from "@/lib/types";

const at = (d: string) => new Date(`${d}T10:00:00+05:30`);

describe("outreach log", () => {
  it("logs each message as the next step, and a first message makes a New lead Contacted", () => {
    let fu = mergeFollowUp(undefined, { touch: { channel: "email", messageId: "<a@x>", subject: "A quick idea" } }, at("2026-10-01"));
    expect(fu.status).toBe("contacted");
    expect(fu.touches).toEqual([{ channel: "email", messageId: "<a@x>", subject: "A quick idea", step: 0, at: at("2026-10-01").toISOString() }]);
    fu = mergeFollowUp(fu, { touch: { channel: "whatsapp" } }, at("2026-10-04"));
    expect(fu.touches!.map((t) => t.step)).toEqual([0, 1]);
    expect(nextStep({ followUp: fu })).toBe(2);
  });

  it("a reply sets Replied (not going backwards), and opting out stops reminders on every channel", () => {
    let fu = mergeFollowUp(undefined, { status: "meeting" });
    fu = mergeFollowUp(fu, { replied: true });
    expect(fu.status).toBe("meeting");
    fu = mergeFollowUp(mergeFollowUp(undefined, { touch: { channel: "email" }, followUpOn: "2026-10-04" }), { replied: true, optIn: { via: "WhatsApp reply" } });
    expect(fu).toMatchObject({ status: "replied", optedIn: { via: "WhatsApp reply" } });
    expect(canContact({ followUp: fu }, "whatsapp_api").ok).toBe(true);
    fu = mergeFollowUp(fu, { optOut: { via: "replied STOP" } });
    expect(fu.followUpOn).toBeUndefined();
    expect(mergeFollowUp(fu, { followUpOn: "2026-10-09" }).followUpOn).toBeUndefined();
    for (const ch of ["email", "whatsapp_api", "whatsapp_phone", "linkedin", "call"] as const) expect(canContact({ followUp: fu }, ch)).toEqual({ ok: false, why: "Asked not to be contacted (replied STOP)" });
    expect(mergeFollowUp(fu, { optOut: false }).optedOut).toBeUndefined(); // undo a mistaken opt-out
  });

  it("the WhatsApp API is only for people who replied or opted in; your own phone is fine for a first hello", () => {
    const fresh = { followUp: undefined };
    expect(canContact(fresh, "whatsapp_api")).toEqual({ ok: false, why: "WhatsApp API messages need them to reply or opt in first" });
    expect(canContact(fresh, "whatsapp_phone").ok).toBe(true);
    expect(canContact({ followUp: { status: "won", updatedAt: "" } }, "email").why).toBe("Already a customer");
  });

  it("checks what the browser sends", () => {
    expect(validPatch({ touch: { channel: "fax" } })).toEqual({});
    expect(validPatch({ touch: { channel: "linkedin" }, optOut: { via: "email unsubscribe" }, optIn: false })).toEqual({ touch: { channel: "linkedin", messageId: undefined, subject: undefined, to: undefined }, optOut: { via: "email unsubscribe" }, optIn: false });
  });

  it("follows a 3 + 4 day schedule and stops after the last follow-up", () => {
    expect(followUpAfter(0, at("2026-10-01"))).toBe("2026-10-04");
    expect(followUpAfter(1, at("2026-10-04"))).toBe("2026-10-08");
    expect(followUpAfter(2, at("2026-10-08"))).toBeNull();
    const l = { id: "a", name: "Aum Dental", category: "Dentist", phones: [], emails: [], sources: [], signals: [], score: 0, tier: "cold", whyNow: "" } as unknown as Lead;
    expect(messageForStep(l, "en", { name: "Divy", company: "Pixel Craft" }, "friendly", 2)).toBe(lastFollowUp(l, "en", { name: "Divy", company: "Pixel Craft" }));
    expect(lastFollowUp(l, "en", { name: "Divy", company: "Pixel Craft" })).toBe("Hi there, one last note about a website for Aum Dental: if now isn't the right time, no problem at all. If it's useful later, just reply here. – Divy, Pixel Craft");
  });
});

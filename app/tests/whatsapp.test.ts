import { describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { isStop, leadsWithNumber, listTemplates, parseWebhook, patchForInbound, sendWhatsApp, signatureOk, waConfig, waPlan } from "@/lib/whatsapp";
import type { Lead } from "@/lib/types";

const C = waConfig({ WHATSAPP_TOKEN: "t", WHATSAPP_PHONE_NUMBER_ID: "123", WHATSAPP_WABA_ID: "999", WHATSAPP_APP_SECRET: "sec" })!;

describe("WhatsApp Business API (only for people who opted in or replied)", () => {
  it("won't message a lead who hasn't replied or opted in; knows when free text is allowed", () => {
    const l = { phone: "+919825012345", phones: [], followUp: undefined } as unknown as Lead;
    expect(waPlan(l, { lastInbound: {} })).toEqual({ ok: false, why: "WhatsApp API messages need them to reply or opt in first" });
    const replied = { ...l, followUp: { status: "replied", updatedAt: "" } } as Lead;
    const now = Date.parse("2026-10-05T12:00:00Z");
    expect(waPlan(replied, { lastInbound: { "919825012345": "2026-10-05T02:00:00Z" } }, now)).toEqual({ ok: true, number: "+919825012345", freeText: true });
    expect(waPlan(replied, { lastInbound: { "919825012345": "2026-10-03T02:00:00Z" } }, now).freeText).toBe(false);
  });

  it("sends a template with its variables, and explains the 24-hour error", async () => {
    let sent: { url: string; body: Record<string, unknown>; auth: string } | undefined;
    const f = (async (url: string, init: RequestInit) => ((sent = { url, body: JSON.parse(String(init.body)), auth: (init.headers as Record<string, string>).Authorization }), new Response(JSON.stringify({ messages: [{ id: "wamid.1" }] })))) as never;
    expect(await sendWhatsApp(C, "+91 98250 12345", { kind: "template", name: "rates_follow_up", language: "en", params: ["Rakesh", "Shree Logistics"] }, f)).toEqual({ id: "wamid.1" });
    expect(sent!.url).toBe("https://graph.facebook.com/v23.0/123/messages");
    expect(sent!.auth).toBe("Bearer t");
    expect(sent!.body).toMatchObject({ messaging_product: "whatsapp", to: "919825012345", type: "template", template: { name: "rates_follow_up", language: { code: "en" }, components: [{ type: "body", parameters: [{ type: "text", text: "Rakesh" }, { type: "text", text: "Shree Logistics" }] }] } });
    const late = (async () => new Response(JSON.stringify({ error: { code: 131047, message: "Re-engagement message" } }), { status: 400 })) as never;
    await expect(sendWhatsApp(C, "+919825012345", { kind: "text", text: "hi" }, late)).rejects.toThrow(/approved template/);
  });

  it("lists templates with how many variables they take", async () => {
    const f = (async () => new Response(JSON.stringify({ data: [{ name: "rates_follow_up", status: "APPROVED", language: "en", category: "MARKETING", components: [{ type: "BODY", text: "Hi {{1}}, {{2}} here. {{1}}, can we share rates?" }] }] }))) as never;
    expect(await listTemplates(C, f)).toEqual([{ name: "rates_follow_up", language: "en", category: "MARKETING", status: "APPROVED", body: "Hi {{1}}, {{2}} here. {{1}}, can we share rates?", params: 2 }]);
  });

  it("accepts only events signed with the app secret, and reads replies, STOP and delivery", () => {
    const raw = JSON.stringify({ entry: [{ changes: [{ value: { messages: [{ from: "919825012345", id: "wamid.in", timestamp: "1791100000", text: { body: "Yes please send rates" } }], statuses: [{ id: "wamid.1", status: "read", recipient_id: "919825012345", timestamp: "1791100010" }] } }] }] });
    const sig = "sha256=" + createHmac("sha256", "sec").update(raw).digest("hex");
    expect(signatureOk(raw, sig, "sec")).toBe(true);
    expect(signatureOk(raw, sig, "other")).toBe(false);
    expect(signatureOk(raw, null, "sec")).toBe(false);
    const ev = parseWebhook(JSON.parse(raw));
    expect(ev.map((e) => [e.kind, e.number, e.text ?? e.status])).toEqual([["message", "919825012345", "Yes please send rates"], ["status", "919825012345", "read"]]);
    expect(patchForInbound("Yes please send rates")).toEqual({ replied: true, optIn: { via: "WhatsApp message" } });
    expect(patchForInbound("STOP")).toEqual({ optOut: { via: "WhatsApp: asked to stop" } });
    expect(["stop", "Band karo", "mat bhejo yaar", "don't message me"].every(isStop)).toBe(true);
    expect(isStop("Please don't stop, send the rates")).toBe(false);
  });

  it("finds the leads with an incoming number across searches", () => {
    const all = [{ searchId: "s1", lead: { id: "a", phone: "+919825012345", phones: [] } }, { searchId: "s2", lead: { id: "b", phones: ["+919000011111"] } }];
    expect(leadsWithNumber(all as never, "919825012345").map((x) => x.lead.id)).toEqual(["a"]);
  });
});

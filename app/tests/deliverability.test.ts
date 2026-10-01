import { describe, expect, it } from "vitest";
import { publicBase, tokenOk, unsubscribeHeaders, unsubscribeToken } from "@/lib/mail/unsubscribe";
import { emailHtml } from "@/lib/mail/html";
import { smtpVerifier, VerifyStop, verifierFromEnv, verifierName } from "@/lib/enrich/verifyEmail";

const KEY = "test-secret";

describe("one-click unsubscribe", () => {
  it("mailto only while the app isn't on a public https address", async () => {
    expect(await unsubscribeHeaders("Jane@acme.com", "riya@getshivakriti.com", {}, KEY)).toEqual({ "List-Unsubscribe": "<mailto:riya@getshivakriti.com?subject=unsubscribe>" });
    expect(publicBase({ APP_BASE_URL: "http://localhost:3000" })).toBeUndefined();
  });
  it("signed https link plus mailto and one-click POST when APP_BASE_URL is set", async () => {
    const h = await unsubscribeHeaders("Jane@acme.com", "riya@getshivakriti.com", { APP_BASE_URL: "https://leads.shivakriti.tech/" }, KEY);
    const t = await unsubscribeToken("jane@acme.com", KEY);
    expect(h["List-Unsubscribe"]).toBe(`<https://leads.shivakriti.tech/api/unsubscribe?e=jane%40acme.com&t=${t}>, <mailto:riya@getshivakriti.com?subject=unsubscribe>`);
    expect(h["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
  });
  it("a link only works for its own address", async () => {
    const t = await unsubscribeToken("jane@acme.com", KEY);
    expect(await tokenOk("JANE@acme.com", t, KEY)).toBe(true);
    expect(await tokenOk("bob@acme.com", t, KEY)).toBe(false);
    expect(await tokenOk("jane@acme.com", "x", KEY)).toBe(false);
  });
});

describe("formal style (EMAIL_STYLE=formal)", () => {
  const text = "Hi Jane,\n\nI saw your store.\nWorth a chat?\n\nRiya\nShivakriti Tech\n\nIf this isn't relevant, just reply \"no\" and I won't email again.";
  it("a clean letter: one font, paragraphs, bold name, small opt-out; no banners, buttons, tables or images", () => {
    const h = emailHtml(text, { name: "Riya" }, undefined, "formal");
    expect(h).toContain('font-family:Arial,Helvetica,sans-serif;font-size:14px');
    expect(h).toContain("<b>Riya</b><br>Shivakriti Tech");
    expect(h).toContain('font-size:12px;color:#888888;">If this isn&#39;t relevant');
    expect(h).not.toMatch(/<table|background|gradient|border|<img|<a /i);
  });
  it("plain is the default", () => {
    expect(emailHtml(text, { name: "Riya" }, undefined, undefined)).toMatch(/^<div dir="ltr">Hi Jane,<br><br>/);
  });
});

describe("free SMTP mailbox check (EMAIL_VERIFY=smtp)", () => {
  const mx = async () => [{ exchange: "mx.acme.com", priority: 10 }];
  const v = (codes: number[]) => smtpVerifier("riya@getshivakriti.com", { mx, talk: async () => codes });
  it("reads the server's answers: exists, doesn't exist, accepts everything", async () => {
    expect((await v([220, 250, 250, 250, 550, 221])("jane@acme.com")).status).toBe("valid");
    expect((await v([220, 250, 250, 550, 550, 221])("nobody@acme.com")).status).toBe("invalid");
    expect((await v([220, 250, 250, 250, 250, 221])("jane@acme.com")).status).toBe("catch_all");
    expect((await v([220, 250, 250, 451, 451, 221])("jane@acme.com")).status).toBe("unknown");
    expect((await smtpVerifier("a@b.com", { mx: async () => [], talk: async () => [] })("x@nomx.example")).status).toBe("invalid");
  });
  it("introduces itself as your mailbox, and stops when port 25 is blocked", async () => {
    let lines: string[] = [];
    await smtpVerifier("riya@getshivakriti.com", { mx, talk: async (_h, l) => ((lines = l), [220, 250, 250, 250, 550, 221]) })("jane@acme.com");
    expect(lines.slice(0, 3)).toEqual(["EHLO getshivakriti.com", "MAIL FROM:<riya@getshivakriti.com>", "RCPT TO:<jane@acme.com>"]);
    const blocked = smtpVerifier("a@b.com", { mx, talk: async () => { throw Object.assign(new Error("t"), { code: "ETIMEDOUT" }); } });
    await expect(blocked("jane@acme.com")).rejects.toBeInstanceOf(VerifyStop);
  });
  it("is chosen with EMAIL_VERIFY=smtp, no key needed", () => {
    expect(verifierFromEnv({ EMAIL_VERIFY: "smtp", MAILBOX_1: "smtps://riya%40getshivakriti.com:p@smtp.zoho.com:465" })).toBeTypeOf("function");
    expect(verifierName({ EMAIL_VERIFY: "smtp" })).toBe("SMTP check (free)");
  });
});

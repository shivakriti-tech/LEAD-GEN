import { describe, expect, it } from "vitest";
import { emailHtml, linkify } from "@/lib/mail/html";

const sender = { name: "Divy Shah", company: "Shree Logistics", address: "12 Alkapuri, Vadodara" };

describe("formal HTML email", () => {
  it("turns paragraphs into HTML, with a signature and the opt-out line", () => {
    const h = emailHtml("Hi Jane,\n\nWe noticed your site is slow.\nHappy to help.\n\nThanks", sender, { email: "divy@x.in" });
    expect(h).toMatch(/^<!DOCTYPE html>/);
    expect((h.match(/<p /g) ?? []).length).toBe(3);
    expect(h).toContain("We noticed your site is slow.<br>Happy to help.");
    expect(h).toContain("Divy Shah");
    expect(h).toContain("Shree Logistics");
    expect(h).toContain("12 Alkapuri, Vadodara");
    expect(h).toContain('href="mailto:divy@x.in"');
    expect(h).toContain("just reply and say so");
  });
  it("escapes the message (nothing the lead's name contains can become markup)", () => {
    const h = emailHtml('Hi <script>alert(1)</script> & "Co"', {}, { email: "a@b.in" });
    expect(h).not.toContain("<script>");
    expect(h).toContain("&lt;script&gt;");
    expect(h).toContain("&amp;");
  });
  it("links show their real address and nothing is hidden: no images, no tracking", () => {
    expect(linkify("See https://acme.in/work.")).toBe('See <a href="https://acme.in/work" style="color:#1f3a5f;text-decoration:underline;">https://acme.in/work</a>.');
    const h = emailHtml("Look: https://acme.in", {}, { email: "a@b.in" });
    expect(h).not.toMatch(/<img|display:\s*none|bit\.ly/i);
  });
  it("doesn't repeat the name or the opt-out line the message already has", () => {
    const msg = 'Hi there,\n\nWould you like a quick sample?\n\nShivaKriti\nBhayli.\n\nIf this isn\'t relevant, just reply "no" and I won\'t email again.';
    const h = emailHtml(msg, { name: "ShivaKriti" }, { email: "a@b.in" }, "formal");
    expect(h).not.toContain("just reply and say so");
    expect((h.match(/ShivaKriti/g) ?? []).length).toBe(1);
  });
  it("MAIL_STYLE=simple is a light, Gmail-like layout with no table, border or colour bar", () => {
    const h = emailHtml("Hi Jane,\n\nQuick question.", { name: "Divy", company: "Shree" }, { email: "a@b.in" }, "simple");
    expect(h).not.toMatch(/<table|border|<!DOCTYPE/i);
    expect(h).toContain("Quick question.");
    expect(h).toContain("Divy<br>Shree<br>a@b.in");
  });
});

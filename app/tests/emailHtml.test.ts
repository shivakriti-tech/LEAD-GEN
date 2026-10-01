import { describe, expect, it } from "vitest";
import { emailHtml, linkify } from "@/lib/mail/html";

describe("HTML part of an email: the way Gmail writes a typed message", () => {
  it("is one div with line breaks: no tables, styles, fonts or colours", () => {
    const h = emailHtml("Hi Jane,\n\nYour site is slow.\nHappy to help.\n\nDivy\nShree Logistics");
    expect(h).toBe('<div dir="ltr">Hi Jane,<br><br>Your site is slow.<br>Happy to help.<br><br>Divy<br>Shree Logistics</div>\n');
    expect(h).not.toMatch(/<table|style=|font|color|<!DOCTYPE|<img/i);
  });
  it("escapes the message (nothing the lead's name contains can become markup)", () => {
    const h = emailHtml('Hi <script>alert(1)</script> & "Co"');
    expect(h).not.toContain("<script>");
    expect(h).toContain("&lt;script&gt;");
    expect(h).toContain("&amp;");
  });
  it("links show their real address", () => {
    expect(linkify("See https://acme.in/work.")).toBe('See <a href="https://acme.in/work">https://acme.in/work</a>.');
  });
});

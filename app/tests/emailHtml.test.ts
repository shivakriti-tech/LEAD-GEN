import { describe, expect, it } from "vitest";
import { emailHtml, linkify } from "@/lib/mail/html";

describe("HTML part of an email, plain style: the way Gmail writes a typed message", () => {
  it("is one div with line breaks inside a minimal document: no tables, styles, fonts or colours", () => {
    const h = emailHtml("Hi Jane,\n\nYour site is slow.\nHappy to help.\n\nDivy\nShree Logistics", undefined, { style: "plain" });
    expect(h).toContain('<body>\n<div dir="ltr">Hi Jane,<br><br>Your site is slow.<br>Happy to help.<br><br>Divy<br>Shree Logistics</div>\n</body>');
    expect(h).not.toMatch(/<table|style=|font-|color|<img/i);
  });
  it("escapes the message (nothing the lead's name contains can become markup)", () => {
    for (const style of ["plain", "formal"]) {
      const h = emailHtml('Hi <script>alert(1)</script> & "Co"', undefined, { style });
      expect(h).not.toContain("<script>");
      expect(h).toContain("&lt;script&gt;");
      expect(h).toContain("&amp;");
    }
  });
  it("links show their real address", () => {
    expect(linkify("See https://acme.in/work.")).toBe('See <a href="https://acme.in/work">https://acme.in/work</a>.');
  });
});

import type { Sender } from "../outreach";

/**
 * The HTML part of an email, written the way Gmail writes it when a person types a message:
 * `<div dir="ltr">` with line breaks, nothing else. No tables, colours, fonts, borders or
 * layout: those make an email look designed, and Gmail files designed email under Promotions
 * (or Spam, from a new domain). The plain-text part says the same thing.
 */

const ESC: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ESC[c]);

/** Escape the text and turn full web addresses into plain links that show the same address. */
export function linkify(text: string): string {
  return esc(text).replace(/\bhttps?:\/\/[^\s<]+[^\s<.,;:!?)'"]/gi, (u) => `<a href="${u}">${u}</a>`);
}

/**
 * The whole email (message + signature) as HTML.
 *  plain (default): Gmail-style, one div with line breaks: reads as a typed message.
 *  formal (EMAIL_STYLE=formal): a clean business letter: one font, paragraphs, your name in bold,
 *    the opt-out line small and grey. Still no backgrounds, banners, buttons, tables or images:
 *    those are what make Gmail file an email under Promotions.
 */
export function emailHtml(plain: string, sender?: Sender, _mailbox?: { email: string }, style = process.env.EMAIL_STYLE): string {
  const text = plain.replace(/\r/g, "").trim();
  if (!/^formal$/i.test(style ?? "")) return `<div dir="ltr">${text.split("\n").map((l) => (l.trim() ? linkify(l) : "")).join("<br>")}</div>\n`;
  const name = sender?.name?.trim();
  const para = (p: string) => {
    if (/^If this isn't relevant/i.test(p)) return `<p style="margin:18px 0 0;font-size:12px;color:#888888;">${linkify(p)}</p>`;
    const lines = p.split("\n").map((l) => (name && l.trim() === name ? `<b>${linkify(l)}</b>` : linkify(l)));
    return `<p style="margin:0 0 14px;">${lines.join("<br>")}</p>`;
  };
  return `<div dir="ltr" style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;color:#222222;">${text.split(/\n{2,}/).map(para).join("")}</div>\n`;
}

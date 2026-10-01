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

/** The whole email (message + signature) as Gmail-style HTML: one div, lines and blank lines. */
export function emailHtml(plain: string, _sender?: Sender, _mailbox?: { email: string }): string {
  const lines = plain.replace(/\r/g, "").trim().split("\n");
  return `<div dir="ltr">${lines.map((l) => (l.trim() ? linkify(l) : "")).join("<br>")}</div>\n`;
}

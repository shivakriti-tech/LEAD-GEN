import type { Sender } from "../outreach";

/**
 * The HTML part of an email. Same words as the plain-text part, as a complete, valid HTML
 * document (doctype, charset, <html>, <head>, <body>): an HTML part without them is itself a
 * spam-filter signal (SpamAssassin's HTML_MIME_NO_HTML_TAG and friends).
 *
 * What it never has: tables, background colours, banners, buttons, images, tracking pixels or
 * hidden text. Those make an email look designed, and Gmail files designed email under
 * Promotions (or Spam, from a new domain).
 */

const ESC: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ESC[c]);

/** Escape the text and turn full web addresses into plain links that show the same address. */
export function linkify(text: string): string {
  return esc(text).replace(/\bhttps?:\/\/[^\s<]+[^\s<.,;:!?)'"]/gi, (u) => `<a href="${u}">${u}</a>`);
}

/** A whole HTML document around the email's body. */
function htmlDocument(body: string, subject?: string): string {
  return [
    "<!DOCTYPE html>",
    '<html lang="en">',
    "<head>",
    '<meta http-equiv="Content-Type" content="text/html; charset=utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${esc(subject?.trim() || "Message")}</title>`,
    "</head>",
    "<body>",
    body,
    "</body>",
    "</html>",
    "",
  ].join("\n");
}

export interface HtmlOptions {
  /** Goes in the document's <title>. */
  subject?: string;
  /** formal (default) or plain (EMAIL_STYLE in .env.local). */
  style?: string;
}

/**
 * The whole email (message + signature) as HTML.
 *  formal (default): a clean business letter: one readable font, real paragraphs, your name in
 *    bold, the opt-out line small and grey.
 *  plain (EMAIL_STYLE=plain): Gmail-style, one div with line breaks: reads as a quickly typed message.
 */
export function emailHtml(plain: string, sender?: Sender, o: HtmlOptions = {}): string {
  const text = plain.replace(/\r/g, "").trim();
  const style = o.style ?? process.env.EMAIL_STYLE;
  if (/^(plain|simple|gmail)$/i.test(style ?? "")) {
    return htmlDocument(`<div dir="ltr">${text.split("\n").map((l) => (l.trim() ? linkify(l) : "")).join("<br>")}</div>`, o.subject);
  }
  const name = sender?.name?.trim();
  const para = (p: string) => {
    if (/^If this isn't relevant/i.test(p)) return `<p style="margin:20px 0 0;font-size:12px;line-height:1.5;color:#777777;">${linkify(p)}</p>`;
    const lines = p.split("\n").map((l) => (name && l.trim() === name ? `<b>${linkify(l)}</b>` : linkify(l)));
    return `<p style="margin:0 0 14px;">${lines.join("<br>")}</p>`;
  };
  return htmlDocument(`<div dir="ltr" style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;color:#222222;max-width:640px;">${text.split(/\n{2,}/).map(para).join("\n")}</div>`, o.subject);
}

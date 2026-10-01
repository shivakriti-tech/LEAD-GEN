import type { Sender } from "../outreach";

/**
 * The formal HTML version of an email, sent beside the plain text (a "multipart" mail, which
 * mail providers expect from real senders). Deliberately plain: one column, system fonts, inline
 * styles (mail apps ignore stylesheets), no images, no tracking pixel, no hidden or shortened
 * links. Every link shows its real address, because anything that hides where a link goes
 * looks like phishing to a spam filter.
 */

const ESC: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ESC[c]);

const FONT = "'Segoe UI',Helvetica,Arial,sans-serif";
const INK = "#1f2933";
const MUTED = "#6b7280";
const ACCENT = "#1f3a5f";
const LINK = `color:${ACCENT};text-decoration:underline;`;

/** Escape the text and turn web addresses into links that show the same address. */
export function linkify(text: string): string {
  return esc(text).replace(/\bhttps?:\/\/[^\s<]+[^\s<.,;:!?)'"]/gi, (u) => `<a href="${u}" style="${LINK}">${u}</a>`);
}

const paragraph = (p: string) => `<p style="margin:0 0 16px 0;font-family:${FONT};font-size:15px;line-height:1.65;color:${INK};">${p.split("\n").map(linkify).join("<br>")}</p>`;

/** The email as HTML: the message, then a signature block and a short note on how to stop emails. */
export function emailHtml(plain: string, sender: Sender, mailbox: { email: string }): string {
  const body = plain
    .trim()
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map(paragraph)
    .join("");
  const line = (s: string, style = "") => `<div style="font-family:${FONT};font-size:13px;line-height:1.55;color:${MUTED};${style}">${s}</div>`;
  const signature = [
    sender.name ? line(esc(sender.name), `font-size:14px;font-weight:600;color:${INK};`) : "",
    sender.company ? line(esc(sender.company)) : "",
    sender.address ? line(esc(sender.address)) : "",
    line(`<a href="mailto:${esc(mailbox.email)}" style="${LINK}">${esc(mailbox.email)}</a>`),
  ].join("");
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title></title></head>
<body style="margin:0;padding:0;background:#ffffff;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#ffffff;"><tr><td align="center" style="padding:24px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;"><tr><td style="border-top:3px solid ${ACCENT};padding:24px 0 0 0;">
${body}
<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 0 0;"><tr><td style="border-left:3px solid ${ACCENT};padding:2px 0 2px 12px;">${signature}</td></tr></table>
<div style="margin:28px 0 0 0;padding-top:14px;border-top:1px solid #e5e7eb;font-family:${FONT};font-size:12px;line-height:1.5;color:#9ca3af;">If you'd rather not get these emails, just reply and say so, and we won't email again.</div>
</td></tr></table>
</td></tr></table>
</body></html>`;
}

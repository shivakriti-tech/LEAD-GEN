import type { Sender } from "../outreach";

/**
 * Messages are written once for every channel, and a WhatsApp message is one block of text.
 * In an email that block reads like a pasted chat message, so before an email goes out it is
 * laid out the way a person types a business email:
 *
 *   Hi Priya,                          ← greeting on its own line
 *
 *   I came across … 212 reviews …      ← short paragraphs, at most 4 sentences each
 *
 *   I'm Riya from Pixel Works.
 *
 *   Would you like to see a sample?    ← the question on its own
 *
 * A sign-off already in the text ("– Riya", "Best regards, Riya") is removed, because the
 * signature (closing, name, company) is added after it. Text that already has line breaks
 * (you wrote or edited it) keeps its layout.
 */

const GREETING = /^((?:hi|hello|hey|dear|namaste|good (?:morning|afternoon|evening))\b[^,.!?\n]{0,60},)\s*/i;
/** Sentence ends, but not after "Dr." / "Pvt." and the like, nor inside "4.6" or "acme.in". */
const SENTENCE_END = /(?<!\b(?:Dr|Mr|Mrs|Ms|Prof|St|No|Pvt|Ltd|Co|Inc|Rs|Sr|Jr|vs|approx|e\.g|i\.e)\.)(?<=[.!?])\s+(?=["'(₹$€£]?[A-Z0-9])/;
/** Where a new paragraph starts: what you noticed about them, and who you are. */
const NOTICED = /^(I had a look|I noticed|I tried|I looked|I checked|I saw|Right now|Maine aapki|Aapki|Abhi log)\b/;
const INTRO = /^(I'm|I am|We're|We are|My name|Main |Hum |Humari|Our team)\b/;
const CLOSING = /^(best( regards)?|kind regards|warm regards|regards|thanks( again)?|thank you|many thanks|cheers|sincerely|yours sincerely|yours truly|dhanyavaad|shukriya)[,.!]?$/i;

const sameText = (a?: string, b?: string) => !!a?.trim() && !!b?.trim() && a.trim().toLowerCase() === b.trim().toLowerCase();

/** Remove a sign-off at the end: "… – Riya", "… – Riya, Pixel Works", or closing + name lines. */
export function stripSignOff(text: string, sender: Sender): string {
  let t = text.replace(/\r/g, "").trim();
  const mine = [sender.name, sender.company, sender.address, "[your name]", "[aapka naam]"].filter((x): x is string => !!x?.trim());
  // inline dash sign-off on the last line
  const dash = t.match(/\s+[–—-]\s*([^\n–—]{1,100})$/);
  if (dash && mine.some((m) => dash[1].toLowerCase().startsWith(m.trim().toLowerCase()))) t = t.slice(0, dash.index).trimEnd();
  // closing and name lines at the end ("Best regards,\nRiya\nPixel Works")
  const lines = t.split("\n");
  while (lines.length > 1 && (!lines.at(-1)!.trim() || mine.some((m) => sameText(m, lines.at(-1))))) lines.pop();
  if (lines.length > 1 && CLOSING.test(lines.at(-1)!.trim())) lines.pop();
  // "Best regards, Riya" on one line
  if (lines.length > 1) {
    const m = lines.at(-1)!.trim().match(/^([^,]+),\s*(.+)$/);
    if (m && CLOSING.test(m[1]) && mine.some((x) => sameText(x, m[2]) || m[2].toLowerCase().startsWith(x.toLowerCase()))) lines.pop();
  }
  return lines.join("\n").trimEnd();
}

/** Split one block of text into sentences. */
export function sentences(text: string): string[] {
  return text.split(SENTENCE_END).map((s) => s.trim()).filter(Boolean);
}

/** The message laid out as an email: greeting line, short paragraphs, no sign-off (the signature follows). */
export function emailLetter(message: string, sender: Sender = {}): string {
  const t = stripSignOff(message, sender);
  if (t.includes("\n")) return t; // already laid out by a person (or the AI): keep it
  let rest = t;
  let greeting = "";
  const g = t.match(GREETING);
  if (g) {
    greeting = /^hi there,$/i.test(g[1]) ? "Hello," : g[1];
    rest = t.slice(g[0].length);
  }
  rest = rest.charAt(0).toUpperCase() + rest.slice(1);
  const parts = sentences(rest);
  const paras: string[][] = [];
  parts.forEach((s, i) => {
    const cur = paras.at(-1);
    const lastQuestion = s.endsWith("?") && i >= parts.length - 2;
    // a link line after the question ("Our work: https://…") stays with it
    const isLinkLine = /^[^.?!]{0,40}:\s*https?:\/\/\S+$/.test(s) && i === parts.length - 1;
    // "what I noticed" opens a paragraph only after a full one (not right after "I came across X.")
    const fresh = !cur || (!isLinkLine && (cur.length >= 4 || (NOTICED.test(s) && cur.length >= 2) || INTRO.test(s) || lastQuestion));
    if (fresh) paras.push([s]);
    else cur.push(s);
  });
  const body = paras.map((p) => p.join(" ")).join("\n\n");
  return greeting ? `${greeting}\n\n${body}` : body;
}

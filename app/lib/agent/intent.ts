/**
 * What a reply means, by plain rules: cheap, instant, and used before (and instead of) the AI for
 * the clear cases: out of office, unsubscribe, a flat no, "talk to X instead". Pure, for tests.
 */

export type Intent = "interested" | "meeting" | "question" | "not_now" | "not_interested" | "unsubscribe" | "out_of_office" | "wrong_person" | "referral" | "other";

export const INTENT_LABEL: Record<Intent, string> = {
  interested: "Interested",
  meeting: "Wants a call",
  question: "Has a question",
  not_now: "Not now",
  not_interested: "Not interested",
  unsubscribe: "Unsubscribe",
  out_of_office: "Out of office",
  wrong_person: "Wrong person",
  referral: "Referred someone",
  other: "Other",
};

/** The new part of a reply: quoted earlier messages and the signature removed. */
export function cleanReply(text: string): string {
  const lines = text.replace(/\r/g, "").split("\n");
  const out: string[] = [];
  for (const line of lines) {
    const t = line.trim();
    // where the quoted thread starts
    if (/^On .{4,200}wrote:?$/i.test(t) || /^-{2,}\s*(Original Message|Forwarded message)/i.test(t) || /^(From|Sent|De|Von):\s/.test(t) && out.length > 0 || /^_{5,}$/.test(t)) break;
    if (t.startsWith(">")) continue;
    if (/^(--|—|Sent from my (iPhone|Android|phone|mobile)|Get Outlook for)/i.test(t)) break;
    out.push(line);
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim().slice(0, 4000);
}

const EMAIL = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i;
const MONTHS = "jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?";

/** "back on 14 October", "return on Oct 14", "until 10/14" → YYYY-MM-DD (this year, or next if passed). */
export function returnDate(text: string, now = new Date()): string | undefined {
  const t = text.toLowerCase();
  const m1 = t.match(new RegExp(`(?:back|return(?:ing)?|until|till|from)\\s+(?:on\\s+)?(?:\\w+day,?\\s+)?(\\d{1,2})(?:st|nd|rd|th)?\\s+(${MONTHS})`));
  const m2 = t.match(new RegExp(`(?:back|return(?:ing)?|until|till|from)\\s+(?:on\\s+)?(?:\\w+day,?\\s+)?(${MONTHS})\\.?\\s+(\\d{1,2})`));
  const day = m1 ? Number(m1[1]) : m2 ? Number(m2[2]) : undefined;
  const mon = m1 ? m1[2] : m2 ? m2[1] : undefined;
  if (!day || !mon) return undefined;
  const month = MONTHS.split("|").findIndex((x) => new RegExp(`^(?:${x})$`).test(mon));
  if (month < 0 || day > 31) return undefined;
  let y = now.getUTCFullYear();
  if (Date.UTC(y, month, day) < now.getTime() - 86_400_000) y++;
  return new Date(Date.UTC(y, month, day)).toISOString().slice(0, 10);
}

export interface RuleRead {
  intent: Intent;
  /** Sure enough to act without the AI. */
  sure: boolean;
  returnOn?: string;
  referral?: string;
}

export function readByRules(subject: string, body: string, now = new Date()): RuleRead {
  const s = subject.toLowerCase(), b = body.toLowerCase();
  if (/auto(matic)?[- ]?reply|out of (the )?office|ooo\b|on (annual )?leave|away from (the )?office|on vacation|on holiday/.test(`${s} ${b.slice(0, 400)}`)) return { intent: "out_of_office", sure: true, returnOn: returnDate(body, now) };
  if (/^\s*(unsubscribe|remove me|stop)\b/.test(s) || /^\s*(unsubscribe|remove me|stop|please remove|take me off|don'?t (email|contact) (me|us))\b/.test(b)) return { intent: "unsubscribe", sure: true };
  const ref = b.match(new RegExp(`(?:contact|reach out to|speak (?:to|with)|email|talk to|cc'?d|copying)\\s+(?:my colleague\\s+|our\\s+\\w+\\s+)?(?:[a-z]+\\s+)?(?:at\\s+)?(${EMAIL.source})`, "i"));
  if (ref) return { intent: "referral", sure: true, referral: ref[1].toLowerCase() };
  if (/\b(wrong person|not the right person|no longer (work|with)|left the company|not responsible for)\b/.test(b)) return { intent: "wrong_person", sure: true };
  if (b.length < 160 && /^\s*(no,? thanks?|no thank you|not interested|we('re| are) (all )?(set|good|covered)|we already have|pass\b|no need)/.test(b)) return { intent: "not_interested", sure: true };
  if (/\b(not (right )?now|maybe later|next (quarter|year|month)|reach out (again )?in|circle back|after (the )?(holidays|season|q[1-4]))\b/.test(b)) return { intent: "not_now", sure: false };
  if (/\b(book|schedule|set up|arrange) (a |the )?(call|meeting|chat|demo)|\b(call|meet) (me|us) (on|at|tomorrow|next)|\bfree (on|at|tomorrow)|calendly\.com/.test(b)) return { intent: "meeting", sure: false };
  if (/\b(interested|sounds (good|great)|tell me more|send (me )?(details|more|the review|it|a proposal|pricing)|let'?s talk|yes,? please)\b/.test(b)) return { intent: "interested", sure: false };
  if (/\?/.test(b) || /\b(how much|price|pricing|cost|quote|timeline|how long)\b/.test(b)) return { intent: "question", sure: false };
  return { intent: "other", sure: false };
}

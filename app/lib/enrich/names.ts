/**
 * People's names, as far as a lead needs them: is this text a person (not the business, not a
 * menu item), and what are their first and last names for an email address. A wrong name is worse
 * than none, because it goes into the greeting ("Hi Rahul"), so anything doubtful is rejected.
 */

export interface PersonName {
  /** As we'd show and greet it: "Dr. Mehul Shah", "Rahul Shah". */
  display: string;
  /** Lower-case ASCII, for email addresses: "mehul", "shah". */
  first: string;
  last?: string;
  /** Written with "Dr." in front: clinics often use dr<last>@ as their address. */
  doctor: boolean;
}

const HONORIFIC = /^(dr|mr|mrs|ms|miss|shri|shree|sri|smt|prof|er|ca|adv|capt|col)\.?$/i;
/** Degrees and suffixes after a name: "Rahul Shah, MDS", "John Smith Jr." */
const SUFFIX = /^(mbbs|bds|mds|md|ms|mch|dm|phd|ca|cfa|cpa|mba|bams|bhms|frcs|mrcp|dnb|jr|sr|ii|iii|iv|esq)\.?$/i;
/** Words that make a "name" a business, a role or a page heading instead of a person. */
const NOT_A_PERSON = new Set(
  (
    "clinic dental dentist care hospital health medical diagnostics lab labs pharmacy enterprises enterprise pvt private ltd limited llp inc llc corp " +
    "company co group solutions services service studio salon spa academy classes institute school college center centre gym fitness hotel resort " +
    "foods food cafe restaurant kitchen bakery sweets store stores shop mart traders trading industries industry exports export imports import " +
    "logistics transport technologies technology tech infotech systems software digital media marketing agency consultants consultancy associates " +
    "india indian international global world team admin manager owner founder director office official support sales info contact enquiry " +
    "home welcome about us our the and of for by with from meet call hello hi dear message read more view all news blog gallery testimonials " +
    "furniture interiors jewellers jewelers motors automobiles realty estate properties builders construction engineering works plastics polymers " +
    "textiles garments fabrics chemicals pharma steel metals electricals electronics mobile photography travels tours events caterers"
  ).split(" "),
);

const ascii = (s: string) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "");
const title = (t: string) => t.charAt(0).toUpperCase() + t.slice(1).toLowerCase();

/**
 * A person's name from free text, or undefined when it doesn't look like one. With `business`,
 * a "name" that is just the business's own words ("Aum Dental", "Shree Furniture") is rejected:
 * Google Maps often lists the business itself as the owner.
 */
export function parsePersonName(raw: string | undefined, business?: string): PersonName | undefined {
  if (!raw) return undefined;
  const text = ascii(raw).replace(/\([^)]*\)/g, " ").split(/[,|/]/)[0].replace(/\s+/g, " ").trim();
  if (!text || text.length > 60 || /[@\d]/.test(text)) return undefined;
  let tokens = text.split(" ").filter(Boolean);
  let doctor = false;
  while (tokens.length && HONORIFIC.test(tokens[0])) {
    if (/^dr\.?$/i.test(tokens[0])) doctor = true;
    tokens = tokens.slice(1);
  }
  while (tokens.length && SUFFIX.test(tokens[tokens.length - 1])) tokens = tokens.slice(0, -1);
  // initials in the middle ("Rahul K. Shah") are fine but don't make an address
  const words = tokens.filter((t) => !/^[A-Za-z]\.?$/.test(t));
  if (!words.length || words.length > 4) return undefined;
  if (!words.every((t) => /^[A-Za-z][A-Za-z'-]{1,19}$/.test(t))) return undefined;
  const lower = words.map((t) => t.toLowerCase().replace(/['-]/g, ""));
  if (lower.some((t) => NOT_A_PERSON.has(t))) return undefined;
  // one word is only a name if it's long enough not to be an initialism ("Raj" is fine, "AB" isn't)
  if (lower.length === 1 && lower[0].length < 3) return undefined;
  if (business) {
    const biz = new Set(ascii(business).toLowerCase().split(/[^a-z]+/).filter(Boolean));
    if (lower.every((t) => biz.has(t))) return undefined;
  }
  const display = `${doctor ? "Dr. " : ""}${words.map(title).join(" ")}`;
  return { display, first: lower[0], last: lower.length > 1 ? lower[lower.length - 1] : undefined, doctor };
}

/** Roles that name the person who decides, in the order we'd trust them. */
const ROLE = /\b(co-?founder|founder|owner|proprietor|proprietress|managing director|chief executive officer|ceo|managing partner|chairman|chairperson|principal|director)\b/gi;
const ROLE_RANK = (role: string) => (/founder|owner|propriet/i.test(role) ? 0 : /managing|chief|ceo|chair/i.test(role) ? 1 : 2);
const NAME = String.raw`(?:(?:Dr|Mr|Mrs|Ms|Shri|Smt|Prof|Er|CA)\.?\s+)?[A-Z][a-z]+(?:\s+[A-Z]\.)?(?:\s+[A-Z][a-z]+){0,2}`;
/** "Founder: Rahul Shah", "Owner – Dr. Mehta", "CEO | Jane Doe" */
const AFTER = new RegExp(String.raw`^\s*(?:&\s*[A-Za-z]+\s*)?[:\-–—|]\s*(${NAME})`);
/** "Rahul Shah, Founder", "Jane Doe (CEO)", "Rahul Shah – Owner" (two words at least) */
const BEFORE = new RegExp(String.raw`((?:(?:Dr|Mr|Mrs|Ms|Shri|Smt|Prof|Er|CA)\.?\s+)?[A-Z][a-z]+(?:\s+[A-Z]\.)?(?:\s+[A-Z][a-z]+){1,2})\s*(?:,|\(|–|—|-|\|)\s*(?:the\s+|our\s+)?$`);
/** Just before a name: a closing quote or testimonial words mean someone talking about the business. */
const QUOTED = /["”“]|\b(testimonials?|reviews?|what (our )?(clients|customers) say|happy (clients|customers)|said|says)\b/i;
const DOCTOR = /\bDr\.?\s+([A-Z][a-z]+(?:\s+[A-Z]\.)?(?:\s+[A-Z][a-z]+){1,2})\b/g;

/**
 * The longest run of words in `cand` that is a person's name, dropping extra words from one end:
 * "Meet Rahul Shah" → "Rahul Shah" (from the start), "Anjali Mehta Dental" → "Anjali Mehta" (from the end).
 */
function trimmedName(cand: string | undefined, drop: "start" | "end"): PersonName | undefined {
  if (!cand) return undefined;
  const t = cand.split(/\s+/);
  for (let i = 0; i < t.length; i++) {
    const words = drop === "start" ? t.slice(i) : t.slice(0, t.length - i);
    const p = parsePersonName(words.join(" "));
    if (p) return p;
  }
  return undefined;
}

/**
 * The owner or decision-maker named in a page's text, conservatively:
 *  1. a name right next to a role word ("Founder: Rahul Shah", "Jane Doe, CEO");
 *  2. otherwise, when the page names exactly one doctor in full ("Dr. Anjali Mehta"), that doctor
 *     (small clinics are run by the doctor whose name is on the site).
 * Testimonials and team lists with several doctors give nothing.
 */
export function ownerFromText(text: string): string | undefined {
  const found: Array<{ name: string; rank: number; at: number }> = [];
  for (const m of text.matchAll(ROLE)) {
    const at = m.index ?? 0;
    // "…great service!” – Ramesh Patel, Proprietor, Patel Traders" is a customer, not the owner
    if (QUOTED.test(text.slice(Math.max(0, at - 160), at))) continue;
    const after = trimmedName(AFTER.exec(text.slice(at + m[0].length, at + m[0].length + 60))?.[1], "end");
    // a name before the role needs two words: "Founder" after a lone word is too often a heading
    const before = trimmedName(BEFORE.exec(text.slice(Math.max(0, at - 60), at))?.[1], "start");
    for (const p of [after, before?.last ? before : undefined]) if (p) found.push({ name: p.display, rank: ROLE_RANK(m[0]), at });
  }
  // three or more different people with roles: a client list or team page, not one owner
  if (new Set(found.map((f) => f.name)).size >= 3) return undefined;
  if (found.length) return found.sort((a, b) => a.rank - b.rank || a.at - b.at)[0].name;
  const doctors = new Set<string>();
  for (const m of text.matchAll(DOCTOR)) {
    const p = trimmedName(`Dr. ${m[1]}`, "end");
    if (p?.last) doctors.add(p.display);
  }
  return doctors.size === 1 ? [...doctors][0] : undefined;
}

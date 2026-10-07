import type { SiteFacts } from "../types";

/**
 * Plain facts a business's website states about itself, used by the niches (lib/niches.ts):
 * already on solar, power-hungry work, online booking, certificates (audits and paperwork), staff
 * size, hazardous goods. Each is read from the words on the page, nothing is guessed. Pure, for tests.
 */

const SOLAR = /\b(rooftop solar|solar (power )?plant|solar panels? (installed|on (our|the) roof)|solar[- ]powered|powered by solar|\d+(\.\d+)?\s?(kwp|kw|mw)\b[^.]{0,30}\bsolar|solar\b[^.]{0,30}\b\d+(\.\d+)?\s?(kwp|kw|mw)\b|green energy from (the )?sun)\b/i;
const HEAVY_POWER = /\b(cold storage|cold chain|cold room|blast freez\w*|deep freez\w*|ice plant|furnace|foundry|forging|injection mou?lding|extrusion|kiln|boilers?|electroplating|spinning mill|weaving mill|data cent(er|re)|24\s?[x×*]\s?7 (production|operations|manufacturing|plant)|round[- ]the[- ]clock (production|operations)|three shifts|3 shifts)\b/i;
const BOOKING_TEXT = /\b(book (an |your |a )?(appointment|table|session|slot|consultation|visit|online|now)|online booking|schedule (an |a )?(appointment|visit|consultation)|reserve (a |your )?table)\b/i;
const BOOKING_HOSTS = /(^|\.)(practo\.com|calendly\.com|setmore\.com|fresha\.com|simplybook\.(me|it)|booksy\.com|zenoti\.com|eazydiner\.com|dineout\.co\.in|district\.in|opentable\.com|vagaro\.com|mindbodyonline\.com|squareup\.com\/appointments)$/i;
const CERTS: Array<[RegExp, string]> = [
  [/\bISO[\s:-]*9001\b/i, "ISO 9001"],
  [/\bISO[\s:-]*14001\b/i, "ISO 14001"],
  [/\bISO[\s:-]*45001\b|\bOHSAS[\s:-]*18001\b/i, "ISO 45001"],
  [/\bISO[\s:-]*22000\b|\bFSSC[\s:-]*22000\b/i, "ISO 22000"],
  [/\bWHO[- ]?GMP\b|\bcGMP\b|\bGMP[- ]certified\b/i, "GMP"],
  [/\bFSSAI\b/, "FSSAI"],
  [/\bHACCP\b/, "HACCP"],
  [/\bBIS (certified|licen[cs]e|mark)\b|\bISI mark\b/i, "BIS"],
  [/\bUS ?FDA\b|\bFDA[- ]approved\b/, "FDA"],
  [/\bCE (marked|certified|certification)\b/i, "CE"],
  [/\bNABH\b/, "NABH"],
  [/\bNABL\b/, "NABL"],
];
const EMPLOYEES = /\b(\d{1,3}(?:,\d{3})+|\d{2,6})\s*\+?\s*(employees|staff( members)?|workforce|team members|workers|people strong|skilled professionals)\b/gi;
const HAZARDOUS = /\b(hazardous (goods|chemicals|materials|cargo)|flammable|solvents?|petrochemicals?|explosives?|acids?|dangerous goods)\b/i;

/** The facts one page states. `hosts` are the domains its links point to (booking widgets). */
export function siteFacts(text: string, hosts: string[] = []): SiteFacts {
  const t = text.slice(0, 400_000);
  const out: SiteFacts = {};
  const solar = t.match(SOLAR)?.[0];
  if (solar) out.solar = solar.trim().slice(0, 80);
  const power = t.match(HEAVY_POWER)?.[0];
  if (power) out.heavyPower = power.trim().toLowerCase();
  if (BOOKING_TEXT.test(t) || hosts.some((h) => BOOKING_HOSTS.test(h))) out.booking = true;
  const certs = CERTS.filter(([re]) => re.test(t)).map(([, n]) => n);
  if (certs.length) out.certs = certs;
  const staff = [...t.matchAll(EMPLOYEES)].map((m) => Number(m[1].replace(/,/g, ""))).filter((n) => n >= 5 && n <= 500_000);
  if (staff.length) out.employees = Math.max(...staff);
  if (HAZARDOUS.test(t)) out.hazardous = true;
  return out;
}

/** Combine what several pages of one site say. */
export function mergeFacts(into: SiteFacts, more: SiteFacts): SiteFacts {
  into.solar ??= more.solar;
  into.heavyPower ??= more.heavyPower;
  if (more.booking) into.booking = true;
  if (more.hazardous) into.hazardous = true;
  if (more.certs?.length) into.certs = [...new Set([...(into.certs ?? []), ...more.certs])];
  if (more.employees) into.employees = Math.max(into.employees ?? 0, more.employees);
  return into;
}

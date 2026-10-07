/**
 * Countries the app searches in. Each one says how to look things up there (map, Google region,
 * search engines, web addresses), how phone numbers look, and when people are at work (for email).
 * India stays the default, so existing searches behave as before.
 */

export type CountryCode = "IN" | "US" | "CA" | "AE" | "SA" | "QA" | "KW" | "OM" | "BH" | "AU" | "NZ";

export interface Market {
  code: CountryCode;
  name: string;
  /** Lower-case ISO code for Nominatim / search engines. */
  cc: string;
  /** Web addresses businesses there use, most common first (for guessing a missing website). */
  tlds: string[];
  currency: { code: string; symbol: string };
  /** Main time zone; big countries pick by longitude (zoneFor). */
  tz: string;
  /** Working days, 0 = Sunday … 6 = Saturday. */
  workDays: number[];
  /** Mobile number prefixes in E.164 (WhatsApp-able), when they can be told apart. */
  mobile?: RegExp;
  /** Cities offered in the search form (anything else can be typed). */
  cities: string[];
  group: "India" | "North America" | "Gulf" | "Australia & NZ";
}

const MON_FRI = [1, 2, 3, 4, 5];
const SUN_THU = [0, 1, 2, 3, 4];

export const MARKETS: Record<CountryCode, Market> = {
  IN: { code: "IN", name: "India", cc: "in", tlds: ["com", "in", "co.in"], currency: { code: "INR", symbol: "₹" }, tz: "Asia/Kolkata", workDays: [1, 2, 3, 4, 5, 6], mobile: /^\+91[6-9]\d{9}$/, cities: ["Vadodara", "Ahmedabad", "Surat", "Mumbai", "Pune", "Delhi", "Bengaluru"], group: "India" },
  US: { code: "US", name: "United States", cc: "us", tlds: ["com", "us", "co", "net"], currency: { code: "USD", symbol: "$" }, tz: "America/New_York", workDays: MON_FRI, cities: ["Houston", "Dallas", "Los Angeles", "Chicago", "Atlanta", "Miami", "New York", "Denver", "Phoenix", "Seattle"], group: "North America" },
  CA: { code: "CA", name: "Canada", cc: "ca", tlds: ["ca", "com"], currency: { code: "CAD", symbol: "C$" }, tz: "America/Toronto", workDays: MON_FRI, cities: ["Toronto", "Calgary", "Vancouver", "Montreal", "Edmonton", "Mississauga"], group: "North America" },
  AE: { code: "AE", name: "United Arab Emirates", cc: "ae", tlds: ["ae", "com"], currency: { code: "AED", symbol: "AED " }, tz: "Asia/Dubai", workDays: MON_FRI, mobile: /^\+9715\d{8}$/, cities: ["Dubai", "Abu Dhabi", "Sharjah", "Ajman", "Ras Al Khaimah"], group: "Gulf" },
  SA: { code: "SA", name: "Saudi Arabia", cc: "sa", tlds: ["com.sa", "sa", "com"], currency: { code: "SAR", symbol: "SAR " }, tz: "Asia/Riyadh", workDays: SUN_THU, mobile: /^\+9665\d{8}$/, cities: ["Riyadh", "Jeddah", "Dammam", "Al Khobar", "Jubail"], group: "Gulf" },
  QA: { code: "QA", name: "Qatar", cc: "qa", tlds: ["com.qa", "qa", "com"], currency: { code: "QAR", symbol: "QAR " }, tz: "Asia/Qatar", workDays: SUN_THU, mobile: /^\+974[3567]\d{7}$/, cities: ["Doha"], group: "Gulf" },
  KW: { code: "KW", name: "Kuwait", cc: "kw", tlds: ["com.kw", "com"], currency: { code: "KWD", symbol: "KWD " }, tz: "Asia/Kuwait", workDays: SUN_THU, mobile: /^\+965[569]\d{7}$/, cities: ["Kuwait City"], group: "Gulf" },
  OM: { code: "OM", name: "Oman", cc: "om", tlds: ["com.om", "om", "com"], currency: { code: "OMR", symbol: "OMR " }, tz: "Asia/Muscat", workDays: SUN_THU, mobile: /^\+968[79]\d{7}$/, cities: ["Muscat", "Sohar", "Salalah"], group: "Gulf" },
  BH: { code: "BH", name: "Bahrain", cc: "bh", tlds: ["com.bh", "bh", "com"], currency: { code: "BHD", symbol: "BHD " }, tz: "Asia/Bahrain", workDays: SUN_THU, mobile: /^\+973[36]\d{7}$/, cities: ["Manama"], group: "Gulf" },
  AU: { code: "AU", name: "Australia", cc: "au", tlds: ["com.au", "au", "com"], currency: { code: "AUD", symbol: "A$" }, tz: "Australia/Sydney", workDays: MON_FRI, mobile: /^\+614\d{8}$/, cities: ["Sydney", "Melbourne", "Brisbane", "Perth", "Adelaide"], group: "Australia & NZ" },
  NZ: { code: "NZ", name: "New Zealand", cc: "nz", tlds: ["co.nz", "nz", "com"], currency: { code: "NZD", symbol: "NZ$" }, tz: "Pacific/Auckland", workDays: MON_FRI, mobile: /^\+642\d{7,9}$/, cities: ["Auckland", "Wellington", "Christchurch"], group: "Australia & NZ" },
};

export const marketOf = (code?: string): Market => MARKETS[(code?.toUpperCase() as CountryCode) ?? "IN"] ?? MARKETS.IN;
export const isCountry = (c: unknown): c is CountryCode => typeof c === "string" && c.toUpperCase() in MARKETS;

/** Time zone for a place: by longitude in the countries that span several. */
export function zoneFor(country: string | undefined, lng?: number): string {
  const m = marketOf(country);
  if (lng == null || !Number.isFinite(lng)) return m.tz;
  if (m.code === "US") return lng > -87.5 ? "America/New_York" : lng > -101 ? "America/Chicago" : lng > -115 ? (lng > -114 ? "America/Denver" : "America/Phoenix") : "America/Los_Angeles";
  if (m.code === "CA") return lng > -67 ? "America/Halifax" : lng > -90 ? "America/Toronto" : lng > -102 ? "America/Winnipeg" : lng > -120 ? "America/Edmonton" : "America/Vancouver";
  if (m.code === "AU") return lng > 141 ? "Australia/Sydney" : lng > 129 ? "Australia/Adelaide" : "Australia/Perth";
  return m.tz;
}

/** Local weekday (0–6), date and minutes after midnight in a time zone. */
export function localParts(now: Date, tz: string): { date: string; weekday: number; minutes: number } {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short", hour12: false }).formatToParts(now).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, weekday: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(p.weekday), minutes: (Number(p.hour) % 24) * 60 + Number(p.minute) };
}

/** Office hours where the lead is: their working days, 9:30–17:30 local time. */
export function inOfficeHours(now: Date, country: string | undefined, lng?: number): boolean {
  const m = marketOf(country);
  const t = localParts(now, zoneFor(country, lng));
  return m.workDays.includes(t.weekday) && t.minutes >= 9 * 60 + 30 && t.minutes < 17 * 60 + 30;
}

/** A mobile (WhatsApp-able) number in its country, when that can be told from the number. */
export function mobileIn(phone?: string): boolean {
  if (!phone) return false;
  return Object.values(MARKETS).some((m) => m.mobile?.test(phone));
}

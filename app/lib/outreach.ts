import type { FollowUpStatus as AnyStatus, Lead } from "./types";
import { domainOf, isMobile } from "./util";

/**
 * Everything the screen needs to act on a lead: one-tap contact links, a ready-written first
 * message (English or Hinglish), and short labels. Pure, so it runs in the browser too.
 */

export type Lang = "en" | "hi";

/** The steps a lead goes through, in order. */
export const FOLLOW_UP = [
  { key: "new", label: "New" },
  { key: "contacted", label: "Contacted" },
  { key: "replied", label: "Replied" },
  { key: "meeting", label: "Meeting booked" },
  { key: "won", label: "Won" },
  { key: "lost", label: "Lost" },
] as const;
export type FollowUpStatus = (typeof FOLLOW_UP)[number]["key"];
/** Older saved statuses under their new names. */
export const statusOf = (l: Pick<Lead, "followUp">): FollowUpStatus => normalizeStatus(l.followUp?.status);
export function normalizeStatus(s?: AnyStatus | string): FollowUpStatus {
  if (s === "interested") return "replied";
  if (s === "not_fit") return "lost";
  return (FOLLOW_UP.find((x) => x.key === s)?.key ?? "new") as FollowUpStatus;
}
export const followUpLabel = (s?: AnyStatus | string) => FOLLOW_UP.find((x) => x.key === normalizeStatus(s))!.label;
/** Still worth chasing: not won or lost. */
export const isOpen = (l: Pick<Lead, "followUp">) => !["won", "lost"].includes(statusOf(l));

/** Your local date as YYYY-MM-DD (not UTC, so "today" is your today). */
export function localDate(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
export function addDays(days: number, from = new Date()): string {
  const d = new Date(from);
  d.setDate(d.getDate() + days);
  return localDate(d);
}
/** "Today", "Tomorrow", "Overdue · 2 Oct", "Fri 3 Oct" */
export function dueLabel(date: string, today = localDate()): string {
  if (date === today) return "Today";
  if (date === addDays(1, new Date(`${today}T12:00:00`))) return "Tomorrow";
  const d = new Date(`${date}T12:00:00`);
  const pretty = d.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });
  return date < today ? `Overdue · ${pretty}` : pretty;
}

/** Why a lead scored what it did, in a few words: "No website + 212 reviews + owner known". */
export function scoreSummary(l: Lead): string {
  const short: Record<string, (label: string) => string> = {
    no_website: () => "No website",
    social_only: (x) => x.replace(/^Uses (.*) as its website$/, "Only $1"),
    site_down: () => "Site broken",
    not_mobile: () => "Not mobile-friendly",
    very_slow: () => "Very slow",
    slow: () => "Slow",
    no_https: () => "No HTTPS",
    stale: (x) => x.replace("Not updated since", "Old since"),
    free_builder: () => "Free builder site",
    busy: () => `${l.reviews} reviews`,
    ig_active: () => "Active on Instagram",
    owner_known: () => "Owner known",
    established: (x) => x,
    agency_lapsed: () => "Agency gone quiet",
    chain: () => "Chain (−45)",
  };
  const parts = l.signals.filter((s) => short[s.key] && (s.points !== 0 || s.key === "chain")).map((s) => short[s.key](s.label));
  return parts.join(" + ") || "Nothing stands out";
}

/** "Shop 4, Race Course Rd, Alkapuri, Vadodara, Gujarat 390007" → "Race Course Rd, Alkapuri" */
export function shortAddress(address?: string, city?: string): string | undefined {
  if (!address) return undefined;
  const c = (city ?? "").toLowerCase();
  const parts = address
    .split(",")
    .map((p) => p.trim())
    .filter((p) => p && !(c && p.toLowerCase().includes(c)))
    .filter((p) => !/^(gujarat|maharashtra|india|karnataka|rajasthan|delhi|tamil nadu|telangana|west bengal|uttar pradesh|madhya pradesh|punjab|haryana|kerala)\b/i.test(p))
    .filter((p) => !/^\d{6}$/.test(p) && !/\b\d{6}\b/.test(p) && !/^(shop|office|flat|plot|unit|no\.?)\s*\d/i.test(p));
  return parts.slice(-2).join(", ") || undefined;
}

/** The number to WhatsApp: their WhatsApp link from the site, else the first mobile. */
export function whatsappNumber(l: Lead): string | undefined {
  return l.audit?.whatsapp ?? [l.phone, ...l.phones].find((p) => isMobile(p));
}

export const telLink = (p: string) => `tel:${p.replace(/[^\d+]/g, "")}`;
export const mapsLink = (l: Lead) =>
  l.mapsUrl ?? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([l.name, l.address ?? l.city].filter(Boolean).join(", "))}`;

/** The main reason to pitch, as the chips on a lead card: at most 3, most important first. */
export function issueChips(l: Lead): Array<{ label: string; kind: "bad" | "warn" | "good" | "plain" }> {
  const s = l.audit?.status;
  const out: Array<{ label: string; kind: "bad" | "warn" | "good" | "plain" }> = [];
  if (!l.pending) {
    if (s === "none" || !s) out.push({ label: "No website", kind: "bad" });
    else if (s === "social_only") out.push({ label: `Only ${socialName(l)}`, kind: "bad" });
    else if (s === "down") out.push({ label: "Website broken", kind: "bad" });
  }
  const keys = new Set(l.signals.map((x) => x.key));
  if (keys.has("not_mobile")) out.push({ label: "Not mobile-friendly", kind: "warn" });
  if (keys.has("very_slow") || keys.has("slow")) out.push({ label: `Slow on mobile${l.audit?.pageSpeed ? ` (${l.audit.pageSpeed.score})` : ""}`, kind: "warn" });
  if (keys.has("no_https")) out.push({ label: "No HTTPS", kind: "warn" });
  if (keys.has("stale")) out.push({ label: `Not updated since ${l.audit?.copyrightYear}`, kind: "warn" });
  if (keys.has("free_builder")) out.push({ label: "Free builder site", kind: "warn" });
  if (keys.has("ig_active")) out.push({ label: "Active on Instagram", kind: "good" });
  if (s === "ok" && out.length === 0 && !l.pending) out.push({ label: "Website looks fine", kind: "good" });
  return out.slice(0, 3);
}

function socialName(l: Lead): string {
  const k = Object.keys(l.audit?.socials ?? {})[0] ?? (l.social?.instagram ? "instagram" : "facebook");
  return ({ instagram: "Instagram", facebook: "Facebook", linktr: "Linktree", justdial: "Justdial" } as Record<string, string>)[k] ?? "a social page";
}

/** Who to greet: the owner if we know them ("Dr. Mehul Shah" → "Dr. Mehul"), else the business. */
function greetName(l: Lead, lang: Lang): string {
  const o = l.owner?.name?.replace(/\s+/g, " ").trim();
  if (o) {
    const parts = o.split(" ");
    const short = /^(dr\.?|mr\.?|mrs\.?|ms\.?)$/i.test(parts[0]) ? parts.slice(0, 2).join(" ") : parts[0];
    return lang === "hi" ? `${short} ji` : short;
  }
  return lang === "hi" ? "ji" : "there";
}

/** The problem, in one sentence that names the business: "I noticed Aum Dental Care doesn't have a website yet…" */
function reason(l: Lead, lang: Lang): string {
  const s = l.audit?.status;
  const site = domainOf(l.audit?.finalUrl ?? l.website);
  const kind = l.category.toLowerCase();
  const where = l.city ?? "";
  if (s === "none" || !s)
    return lang === "hi"
      ? `Maine dekha ki ${l.name} ki abhi koi website nahi hai, isliye ${where} mein ${kind} search karne wale log call se pehle aapki services dekh nahi paate.`
      : `I noticed ${l.name} doesn't have a website yet, so people searching for a ${kind}${where ? ` in ${where}` : ""} can't see your services before they call.`;
  if (s === "social_only")
    return lang === "hi"
      ? `Maine dekha ki ${l.name} ${socialName(l)} ko hi website ki tarah use kar raha hai. Apni website se Google se naye customers aur direct enquiries dono milti hain.`
      : `I noticed ${l.name} uses ${socialName(l)} as its website. A site of your own brings in customers from Google and lets them enquire directly.`;
  if (s === "down")
    return lang === "hi"
      ? `${l.name} ki website (${site}) abhi khul nahi rahi hai, toh Google se aane wale customers ko kuch nahi dikhta.`
      : `I noticed ${l.name}'s website (${site}) isn't loading right now, so customers who find you on Google see nothing.`;
  const issues = issueChips(l).filter((c) => c.kind === "warn").map((c) => c.label.toLowerCase());
  if (issues.length)
    return lang === "hi"
      ? `Maine ${l.name} ki website (${site}) dekhi: ${issues.join(", ")}. Isse phone pe aane wale customers wapas chale jaate hain.`
      : `I had a look at ${l.name}'s website (${site}): ${issues.join(", ")}. That loses customers who find you on their phone.`;
  return lang === "hi"
    ? `Maine ${l.name} ki website (${site}) dekhi, kuch chhote badlaav se zyada enquiries aa sakti hain.`
    : `I had a look at ${l.name}'s website (${site}) and a few changes could bring you more enquiries.`;
}

/** Short enough to read and send in 10 seconds. Placeholders stay visible until you set your name. */
export function firstMessage(l: Lead, lang: Lang, sender?: string): string {
  const from = sender?.trim() || (lang === "hi" ? "[aapka naam]" : "[your name]");
  if (lang === "hi")
    return `Namaste ${greetName(l, "hi")}, ${reason(l, "hi")} Hum local businesses ke liye fast, mobile-friendly websites banate hain. Kya hum aapko ek chhota sample dikha sakte hain? – ${from}`;
  return `Hi ${greetName(l, "en")}, ${reason(l, "en")} We build fast, mobile-friendly websites for local businesses. Can I show you a quick sample? – ${from}`;
}

/** WhatsApp link with your text (edited or the ready pitch). */
export function whatsappLinkWith(l: Lead, text: string): string | undefined {
  const n = whatsappNumber(l)?.replace(/\D/g, "");
  return n ? `https://wa.me/${n}?text=${encodeURIComponent(text)}` : undefined;
}

export function whatsappLink(l: Lead, lang: Lang, sender?: string): string | undefined {
  return whatsappLinkWith(l, firstMessage(l, lang, sender));
}

export function emailLink(l: Lead, sender?: string): string | undefined {
  if (!l.email) return undefined;
  const subject = `A quick idea for ${l.name}`;
  return `mailto:${l.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(firstMessage(l, "en", sender))}`;
}

/** A short nudge for a lead you've already messaged. */
export function followUpMessage(l: Lead, lang: Lang, sender?: string): string {
  const from = sender?.trim() || (lang === "hi" ? "[aapka naam]" : "[your name]");
  return lang === "hi"
    ? `Namaste ${greetName(l, "hi")}, ${l.name} ki website ke baare mein humara pichla message follow up kar rahe hain. Agar aap chahein toh hum 2-3 sample designs bhej sakte hain. – ${from}`
    : `Hi ${greetName(l, "en")}, just following up on my message about a website for ${l.name}. Happy to send 2–3 sample designs if you'd like to see them. – ${from}`;
}

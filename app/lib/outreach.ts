import type { Lead } from "./types";
import { domainOf, isMobile } from "./util";

/**
 * Everything the screen needs to act on a lead: one-tap contact links, a ready-written first
 * message (English or Hinglish), and short labels. Pure, so it runs in the browser too.
 */

export type Lang = "en" | "hi";

export const FOLLOW_UP = [
  { key: "new", label: "New" },
  { key: "contacted", label: "Contacted" },
  { key: "interested", label: "Interested" },
  { key: "won", label: "Won" },
  { key: "not_fit", label: "Not a fit" },
] as const;
export type FollowUpStatus = (typeof FOLLOW_UP)[number]["key"];
export const followUpLabel = (s?: FollowUpStatus) => FOLLOW_UP.find((x) => x.key === (s ?? "new"))!.label;

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
  return lang === "hi" ? `${l.name} team` : `${l.name} team`;
}

/** One sentence about their website, in the chosen language. */
function reason(l: Lead, lang: Lang): string {
  const s = l.audit?.status;
  const site = domainOf(l.audit?.finalUrl ?? l.website);
  const where = l.city ? (lang === "hi" ? `${l.city} mein` : `in ${l.city}`) : "";
  if (s === "none" || !s)
    return lang === "hi"
      ? `Maine dekha ki aapki abhi koi website nahi hai, isliye online search karne wale customers call karne se pehle aapki services dekh nahi paate.`
      : `I noticed you don't have a website yet, so people searching for a ${l.category.toLowerCase()} ${where} can't see your services before they call.`;
  if (s === "social_only")
    return lang === "hi"
      ? `Maine dekha ki aap ${socialName(l)} ko hi website ki tarah use kar rahe hain. Ek apni website se Google pe naye customers aur direct bookings dono milte hain.`
      : `I noticed you're using ${socialName(l)} as your website. A site of your own brings in customers from Google and lets them book or enquire directly.`;
  if (s === "down")
    return lang === "hi"
      ? `Aapki website (${site}) abhi khul nahi rahi hai, toh Google se click karne wale customers ko kuch nahi dikhta.`
      : `Your website (${site}) isn't loading right now, so customers who click it from Google see nothing.`;
  const issues = issueChips(l).filter((c) => c.kind === "warn").map((c) => c.label.toLowerCase());
  if (issues.length)
    return lang === "hi"
      ? `Maine aapki website (${site}) dekhi: ${issues.join(", ")}. Isse mobile pe aane wale customers wapas chale jaate hain.`
      : `I had a look at your website (${site}): ${issues.join(", ")}. That loses customers who find you on their phone.`;
  return lang === "hi"
    ? `Maine aapki website (${site}) dekhi, aur kuch chhote badlaav se usse zyada enquiries mil sakti hain.`
    : `I had a look at your website (${site}) and a few changes could bring you more enquiries.`;
}

/** A short, polite first message. The sender signs it; placeholders stay visible if not set. */
export function firstMessage(l: Lead, lang: Lang, sender?: string): string {
  const from = sender?.trim() || (lang === "hi" ? "[aapka naam]" : "[your name]");
  if (lang === "hi")
    return [
      `Namaste ${greetName(l, "hi")},`,
      `Maine Google pe ${l.name} dekha. ${reason(l, "hi")}`,
      `Hum ${l.city ?? "aapke shehar"} ke local businesses ke liye fast, mobile-friendly websites banate hain. Kya 5 minute baat kar sakte hain?`,
      `– ${from}`,
    ].join("\n\n");
  return [
    `Hi ${greetName(l, "en")},`,
    `I came across ${l.name} on Google. ${reason(l, "en")}`,
    `We build fast, mobile-friendly websites for local businesses${l.city ? ` in ${l.city}` : ""}. Would you be open to a quick 5-minute chat?`,
    `– ${from}`,
  ].join("\n\n");
}

export function whatsappLink(l: Lead, lang: Lang, sender?: string): string | undefined {
  const n = whatsappNumber(l)?.replace(/\D/g, "");
  return n ? `https://wa.me/${n}?text=${encodeURIComponent(firstMessage(l, lang, sender))}` : undefined;
}

export function emailLink(l: Lead, sender?: string): string | undefined {
  if (!l.email) return undefined;
  const subject = `A quick idea for ${l.name}`;
  return `mailto:${l.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(firstMessage(l, "en", sender))}`;
}

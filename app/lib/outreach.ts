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

/** You, as the message introduces you. A plain string (older saved setting) is just your name. */
export interface Sender {
  name?: string;
  /** "web developer", "digital agency", … */
  work?: string;
  city?: string;
  /** Link to your work: portfolio, Instagram, a sample site. */
  link?: string;
}
/** friendly: the full pitch · short: two lines · follow: a nudge after you've messaged once. */
export type Tone = "friendly" | "short" | "follow";
export const TONES: Array<{ key: Tone; label: string }> = [
  { key: "friendly", label: "Friendly" },
  { key: "short", label: "Short" },
  { key: "follow", label: "Follow-up" },
];

const asSender = (s?: string | Sender): Sender => (typeof s === "string" ? { name: s } : s ?? {});
const an = (w: string) => (/^[aeiou]/i.test(w) ? "an" : "a");

/** The kind of business, for the line on what a website does for them. */
function family(category: string): string {
  const c = category.toLowerCase();
  if (/dent|clinic|physio|skin|doctor|hospital/.test(c)) return "clinic";
  if (/salon|spa|beauty|parlou?r/.test(c)) return "salon";
  if (/gym|yoga|fitness/.test(c)) return "gym";
  if (/restaurant|caf|bakery|food/.test(c)) return "food";
  if (/coaching|class|institute|school|tuition/.test(c)) return "coaching";
  if (/real estate|property/.test(c)) return "realestate";
  if (/interior/.test(c)) return "interior";
  if (/\bca\b|tax|account|lawyer|advocate/.test(c)) return "pro";
  if (/hotel|homestay|guest/.test(c)) return "hotel";
  if (/furniture|retail|shop|store|cloth|boutique/.test(c)) return "shop";
  return "other";
}

const BENEFIT: Record<Lang, Record<string, string>> = {
  en: {
    clinic: "A simple site with your treatments, timings and a booking button helps new patients choose you.",
    salon: "A small site with your services, prices and a booking button lets new customers book without messaging first.",
    gym: "A site with your plans, timings and a free-trial form turns searches into walk-ins.",
    food: "A site with your menu, photos and directions brings in people deciding where to eat.",
    coaching: "A site with your courses, results and fees helps parents decide faster.",
    realestate: "A site with your current listings gets you enquiries straight from Google.",
    interior: "A site with your past projects is the first thing clients look for.",
    pro: "A simple site with your services and a contact form builds trust before the first call.",
    hotel: "A site with rooms, photos and direct booking saves you the booking-site commission.",
    shop: "A site with your range and prices brings in people who compare online first.",
    other: "A simple site with your services and a contact button brings in customers from Google.",
  },
  hi: {
    clinic: "Treatments, timings aur booking button wali ek simple website se naye patients aapko choose karte hain.",
    salon: "Services, prices aur booking button wali ek chhoti website se naye customers bina message kiye book kar sakte hain.",
    gym: "Plans, timings aur free-trial form wali website se search karne wale log walk-in karte hain.",
    food: "Menu, photos aur directions wali website se khane ki jagah dhoondhne wale log aap tak aate hain.",
    coaching: "Courses, results aur fees wali website se parents jaldi decide karte hain.",
    realestate: "Aapki listings wali website se Google se seedhe enquiries aati hain.",
    interior: "Aapke past projects wali website hi clients sabse pehle dekhte hain.",
    pro: "Services aur contact form wali simple website se pehli call se pehle hi bharosa banta hai.",
    hotel: "Rooms, photos aur direct booking wali website se booking sites ka commission bachta hai.",
    shop: "Range aur prices wali website se online compare karne wale customers aate hain.",
    other: "Services aur contact button wali simple website se Google se naye customers aate hain.",
  },
};

/** What's wrong with their website, as short phrases: "not mobile-friendly", "slow on mobile". */
function problems(l: Lead, lang: Lang): string[] {
  const keys = new Set(l.signals.map((x) => x.key));
  const yr = l.audit?.copyrightYear;
  const en: Array<[string, string]> = [["not_mobile", "not mobile-friendly"], ["very_slow", "slow on mobile"], ["slow", "slow on mobile"], ["no_https", "not secure (no HTTPS)"], ["stale", `not updated since ${yr}`], ["free_builder", "on a free builder address"]];
  const hi: Record<string, string> = { not_mobile: "phone pe theek se nahi dikhti", very_slow: "phone pe slow hai", slow: "phone pe slow hai", no_https: "secure (HTTPS) nahi hai", stale: `${yr} se update nahi hui`, free_builder: "free builder address pe hai" };
  const out = en.filter(([k]) => keys.has(k)).map(([k, t]) => (lang === "hi" ? hi[k] : t));
  return [...new Set(out)].slice(0, 3);
}

const joinAnd = (xs: string[], lang: Lang) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} ${lang === "hi" ? "aur" : "and"} ${xs[xs.length - 1]}`);

type Case = "none" | "social" | "down" | "issues" | "ok";
function caseOf(l: Lead): Case {
  const s = l.audit?.status;
  if (s === "none" || !s) return "none";
  if (s === "social_only") return "social";
  if (s === "down") return "down";
  return problems(l, "en").length ? "issues" : "ok";
}

/** A first message for this lead: it names the business, its problem and what you'd do, in your voice. */
export function firstMessage(l: Lead, lang: Lang, sender?: string | Sender, tone: Exclude<Tone, "follow"> = "friendly"): string {
  const me = asSender(sender);
  const name = me.name?.trim() || (lang === "hi" ? "[aapka naam]" : "[your name]");
  const work = me.work?.trim() || "web developer";
  const myCity = me.city?.trim();
  const link = me.link?.trim();
  const greet = greetName(l, lang);
  const c = caseOf(l);
  const site = domainOf(l.audit?.finalUrl ?? l.website);
  const kind = l.category.toLowerCase();
  const where = l.city ?? "";
  const social = socialName(l);
  const probs = joinAnd(problems(l, lang), lang);
  const good = l.rating != null && l.rating >= 4.2 && (l.reviews ?? 0) >= 20;
  const onWhat = l.sources.some((x) => x === "google" || x === "gmaps") ? "Google" : l.sources.includes("instagram") ? "Instagram" : "";

  if (lang === "hi") {
    if (tone === "short") {
      const fact = {
        none: (l.reviews ?? 0) >= 10 ? `${l.name} ke ${l.reviews} Google reviews hain par website nahi hai.` : `${l.name} ki abhi website nahi hai.`,
        social: `${l.name} abhi sirf ${social} pe hai.`,
        down: `${l.name} ki website abhi khul nahi rahi.`,
        issues: `${l.name} ki website ${probs}.`,
        ok: `Maine ${l.name} ki website dekhi.`,
      }[c];
      const fix = { none: "Hum aapke liye simple website bana sakte hain.", social: "Hum aapke liye simple website bana sakte hain.", down: "Hum ise jaldi theek kar sakte hain.", issues: "Ye jaldi theek ho sakta hai.", ok: "Isse zyada enquiries aa sakti hain." }[c];
      const ask = c === "down" ? "Dekh lein?" : "Ek chhota sample dikhayein?";
      return `Namaste ${greet}, main ${name}, ${myCity ? `${myCity} se ` : ""}${work}. ${fact} ${fix} ${ask}${link ? ` ${link}` : ""}`;
    }
    const seen = onWhat ? `maine ${onWhat} pe ${l.name} dekha` : `maine ${l.name} ke baare mein dekha`;
    const praise = good ? `, ${l.reviews} reviews aur ${l.rating!.toFixed(1)} rating, bahut badhiya hai` : "";
    const problem = {
      none: `Aapki abhi koi website nahi hai, isliye ${where ? `${where} mein ` : ""}${kind} search karne wale log call se pehle aapki services dekh nahi paate.`,
      social: `Abhi log aapko sirf ${social} pe hi dhoondh paate hain.`,
      down: `Aapki website (${site}) abhi khul nahi rahi, toh Google se click karne wale wapas chale jaate hain.`,
      issues: `Maine aapki website (${site}) dekhi: ${probs}. Aajkal log phone pe search karte hain, isliye customers chale jaate hain.`,
      ok: `Maine aapki website (${site}) dekhi, kuch chhote badlaav se zyada enquiries aa sakti hain.`,
    }[c];
    const benefit = c === "none" || c === "social" ? ` ${BENEFIT.hi[family(l.category)]}` : c === "down" ? " Hum ise jaldi theek kar sakte hain, ya nayi bana sakte hain." : c === "issues" ? " Ye jaldi theek ho jaata hai, brand badalne ki zarurat nahi." : "";
    const intro = ` Main ${name} hoon, ${myCity ? `${myCity} se ` : ""}${work}.`;
    const ask = c === "none" || c === "social" ? " Kya aap ek chhota sample dekhna chahenge?" : c === "down" ? " Chahein toh hum bata sakte hain kya problem hai." : " Kya aap dekhna chahenge ki ye kaisa dikh sakta hai?";
    return `Namaste ${greet}, ${seen}${praise}. ${problem}${benefit}${intro}${ask}${link ? ` Humara kaam: ${link}` : ""}`;
  }

  if (tone === "short") {
    const fact = {
      none: (l.reviews ?? 0) >= 10 ? `${l.name} has ${l.reviews} Google reviews but no website.` : `${l.name} doesn't have a website yet.`,
      social: `${l.name} only has ${social} right now.`,
      down: `${l.name}'s website isn't loading right now.`,
      issues: `${l.name}'s website is ${probs}.`,
      ok: `I had a look at ${l.name}'s website.`,
    }[c];
    const fix = { none: "build you a simple website", social: "build you a simple website", down: "fix it quickly", issues: "fix that quickly", ok: "help it bring in more enquiries" }[c];
    const ask = c === "down" ? "Want me to take a look?" : "Can I show you a quick sample?";
    return `Hi ${greet}, ${name} here, ${work}${myCity ? ` from ${myCity}` : ""}. ${fact} I can ${fix}. ${ask}${link ? ` ${link}` : ""}`;
  }
  const seen = onWhat ? `I came across ${l.name} on ${onWhat}` : `I came across ${l.name}`;
  const praise = good ? `. ${l.reviews} reviews and a ${l.rating!.toFixed(1)} rating is really good` : "";
  const problem = {
    none: `I noticed there's no website yet, so people searching for ${an(kind)} ${kind}${where ? ` in ${where}` : ""} can't see your services before they call.`,
    social: `Right now people can only find you on ${social}.`,
    down: `I tried opening your website (${site}) and it isn't loading, so anyone clicking it from Google hits a dead end.`,
    issues: `I had a look at your website (${site}): it's ${probs}. Most people search on their phone now, so that loses customers.`,
    ok: `I had a look at your website (${site}) and a few changes could bring you more enquiries.`,
  }[c];
  const benefit = c === "none" || c === "social" ? ` ${BENEFIT.en[family(l.category)]}` : c === "down" ? " I can get it working again, or build a fresh one." : c === "issues" ? " These are quick fixes and don't need a new brand." : "";
  const intro = ` I'm ${name}, ${an(work)} ${work}${myCity ? ` in ${myCity}` : ""}.`;
  const ask = c === "none" || c === "social" ? " Would you like to see a quick sample?" : c === "down" ? " Happy to explain what's going wrong if you like." : " Want me to show you how it could look?";
  return `Hi ${greet}, ${seen}${praise}. ${problem}${benefit}${intro}${ask}${link ? ` Some of my work: ${link}` : ""}`;
}

/** The tone to start with: a follow-up once you've messaged them, else your usual one. */
export const toneFor = (l: Lead, preferred: Exclude<Tone, "follow">): Tone => (["contacted", "replied", "meeting"].includes(statusOf(l)) ? "follow" : preferred);

/** The message for a lead in a tone. */
export function pitchText(l: Lead, lang: Lang, tone: Tone, sender?: string | Sender): string {
  return tone === "follow" ? followUpMessage(l, lang, sender) : firstMessage(l, lang, sender, tone);
}

/** WhatsApp link with your text (edited or the ready pitch). */
export function whatsappLinkWith(l: Lead, text: string): string | undefined {
  const n = whatsappNumber(l)?.replace(/\D/g, "");
  return n ? `https://wa.me/${n}?text=${encodeURIComponent(text)}` : undefined;
}

export function whatsappLink(l: Lead, lang: Lang, sender?: string | Sender): string | undefined {
  return whatsappLinkWith(l, firstMessage(l, lang, sender));
}

export function emailLink(l: Lead, sender?: string | Sender): string | undefined {
  if (!l.email) return undefined;
  const subject = `A quick idea for ${l.name}`;
  return `mailto:${l.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(firstMessage(l, "en", sender))}`;
}

/** A short nudge for a lead you've already messaged. */
export function followUpMessage(l: Lead, lang: Lang, sender?: string | Sender): string {
  const from = asSender(sender).name?.trim() || (lang === "hi" ? "[aapka naam]" : "[your name]");
  return lang === "hi"
    ? `Namaste ${greetName(l, "hi")}, ${l.name} ki website ke baare mein humara pichla message follow up kar rahe hain. Agar aap chahein toh hum 2-3 sample designs bhej sakte hain. – ${from}`
    : `Hi ${greetName(l, "en")}, just following up on my message about a website for ${l.name}. Happy to send 2–3 sample designs if you'd like to see them. – ${from}`;
}

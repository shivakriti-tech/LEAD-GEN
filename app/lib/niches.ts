import type { Lead, NicheKey, Offer, Signal, Tier } from "./types";
import { growthSignals } from "./score/growth";
import { INDUSTRIAL } from "./score/logistics";
import { CATEGORIES } from "./categories";

/**
 * More niches: services you (or a client) sell to businesses, besides websites, logistics and your
 * agency. Each niche says who it sells to, which facts make a business need it now (every point
 * comes from something we saw: the website, the map listing, the reviews), and how to say it.
 *
 *  - marketing   Digital marketing & local SEO: few or poor Google reviews, no website, no
 *                analytics or ad tags, quiet Instagram, no online booking.
 *  - solar       Rooftop solar for businesses: factories, cold storage, warehouses, hospitals,
 *                schools and hotels with big roofs and big bills; exporters whose buyers ask for green power.
 *  - accounting  CA, GST & compliance: new businesses, exporters (LUT, refunds), online sellers
 *                (marketplace TCS), traders, companies that are hiring (payroll, PF, ESI).
 *  - staffing    Hiring & staffing: companies that are hiring right now, expanding, or run shifts.
 *  - insurance   Business insurance: exporters and importers (marine cargo), factories and
 *                warehouses (fire), hospitals (liability), teams (group health).
 *
 * Businesses that sell the same thing are marked as competitors and score 0.
 */

export interface Need {
  /** For "Likely needs …" in the why-now line, reports and CSV. */
  label: string;
  /** Short, for chips. */
  chip: string;
}

type Add = (key: string, label: string, points: number, ...needs: string[]) => void;
type Chip = { label: string; kind: "bad" | "warn" | "good" | "plain" };
type Words = { en: string; hi: string };

export interface Niche {
  key: NicheKey;
  /** In the offer picker. */
  label: string;
  blurb: string;
  /** Above the search form. */
  heading: string;
  intro: string;
  /** Under "What kind of business?". */
  typesHint: string;
  /** Business types picked when you switch to this niche. */
  defaults: string[];
  needs: Record<string, Need>;
  /** In the name or description: the business sells this itself. */
  competitor: RegExp;
  /** What the competitor chip says. */
  competitorLabel: string;
  /** Your work in one line: LinkedIn notes, and the "I'm …" line when you haven't said what you do. */
  doing: string;
  /** What follow-ups are "about". */
  topic: Words;
  subject: (name: string) => string;
  /** Strong at or above the first, worth a try at or above the second. */
  tiers: [number, number];
  /** Signals that make a lead worth a message on their own. */
  reasons: string[];
  /** Growth signals add these needs. */
  growthNeeds: Partial<Record<"new_business" | "expanding" | "hiring", string[]>>;
  /** Points off for a chain or brand (head office decides). */
  chain: number;
  score: (l: Lead, add: Add, now: Date) => void;
  /** Chips for the lead card, by signal key (first three that apply, in this order). */
  chips: Array<[string, Chip | ((l: Lead) => Chip)]>;
  /** The opening observation, by signal key: the first one the lead has is used. */
  saw: Array<[string, (l: Lead) => Words]>;
  /** What you'd do, from what it likely needs. */
  offer: (needs: string[]) => Words;
  ask: Words;
}

const reviewsKnown = (l: Lead) => l.sources.some((s) => s === "google" || s === "gmaps");
/** The category key this lead was found under (labels are unique). */
const catKey = (label: string) => CATEGORIES.find((c) => c.label === label)?.key;
const FACTORY_KEYS = new Set(["manufacturer", "textile", "chemical", "pharma", "engineering", "food_proc", "furniture_mfr", "cold_storage"]);
const isFactory = (l: Lead) => FACTORY_KEYS.has(catKey(l.category) ?? "") || !!l.audit?.trade?.manufactures;
const staffOf = (l: Lead) => l.company?.employees ?? l.audit?.facts?.employees;
/** The industrial estate in the address ("GIDC Makarpura"), the way the logistics score names it. */
const estateOf = (l: Lead) => {
  const part = (l.address ?? "").split(",").map((x) => x.trim()).find((x) => INDUSTRIAL.test(x));
  return part ? part.replace(/^(plot|shed|unit)\s*(no\.?)?\s*[\w/-]+\s*/i, "").trim() || part : undefined;
};
const quote = (s: Signal) => s.label.match(/"([^"]+)"/)?.[1];
const igHandle = (l: Lead) => l.social?.instagram ?? (l.audit?.socials?.instagram ? { url: l.audit.socials.instagram } : undefined);
const daysSince = (iso: string | undefined, now: Date) => (iso ? Math.floor((now.getTime() - Date.parse(iso)) / 86_400_000) : undefined);
const BOOKS_FOR = /clinic|dent|physio|skin|vet|salon|spa|gym|yoga|restaurant|caf|hotel|coaching|class|school|driving|optician|diagnostic|car & bike service/i;
const EU_US = /\b(EU|Europe|European|Germany|France|Italy|Spain|Netherlands|Belgium|Poland|UK|United Kingdom|USA|US|United States|America)\b/i;

export const NICHES: Record<NicheKey, Niche> = {
  marketing: {
    key: "marketing",
    label: "Digital marketing & SEO",
    blurb: "Local businesses that need more customers from Google and Instagram",
    heading: "Who needs more customers from Google?",
    intro: "Pick an area and the kinds of business. We find the ones with few or poor Google reviews, no website, no ads or analytics and quiet social media, say why, and write the first message.",
    typesHint: "Clinics, salons and restaurants live on Google reviews and Maps.",
    defaults: ["dentist", "salon", "restaurant"],
    needs: {
      gbp: { label: "Google Maps & local SEO", chip: "Local SEO" },
      reviews: { label: "more Google reviews", chip: "Reviews" },
      social: { label: "social media", chip: "Social media" },
      ads: { label: "Google & Meta ads", chip: "Ads" },
      website: { label: "a website that brings enquiries", chip: "Website" },
    },
    competitor: /\b(digital marketing|seo (agency|company|services|expert)|social media (agency|marketing|management)|advertising agency|ad agency|marketing (agency|solutions|consultants?)|branding agency|performance marketing|web ?design(ers)?)\b/i,
    competitorLabel: "Marketing agency",
    doing: "I help local businesses get more customers from Google and Instagram",
    topic: { en: "getting more customers from Google", hi: "Google se zyada customers" },
    subject: (n) => `${n} on google`,
    tiers: [60, 35],
    reasons: ["no_reviews", "few_reviews", "low_rating", "no_website", "social_only", "site_down", "no_tracking", "no_instagram", "ig_quiet", "no_booking"],
    growthNeeds: { new_business: ["gbp", "reviews", "social"], expanding: ["ads", "gbp"] },
    chain: -40,
    score(l, add, now) {
      const a = l.audit;
      const st = a?.status ?? "none";
      if (reviewsKnown(l)) {
        const n = l.reviews ?? 0;
        if (!n) add("no_reviews", "No Google reviews yet", 25, "reviews", "gbp");
        else if (n < 20) add("few_reviews", `Only ${n} Google review${n === 1 ? "" : "s"}`, 20, "reviews", "gbp");
        if (l.rating != null && l.rating < 4 && n >= 10) add("low_rating", `Google rating ${l.rating.toFixed(1)}★ from ${n} reviews`, 20, "reviews", "gbp");
        else if (n >= 150 && (l.rating ?? 0) >= 4.4) add("strong_google", `Already strong on Google: ${n} reviews, ${l.rating?.toFixed(1)}★`, -10);
      }
      if (!l.pending) {
        if (st === "none") add("no_website", "No website", 20, "website", "gbp");
        else if (st === "social_only") add("social_only", "Uses a social page as its website", 15, "website");
        else if (st === "down") add("site_down", "Website doesn't load", 15, "website");
      }
      if (st === "ok") {
        const tags = a?.tech?.marketing ?? [];
        const analytics = tags.some((t) => t === "Google Analytics" || t === "Google Tag Manager");
        const ads = tags.filter((t) => t === "Meta Pixel" || t === "Google Ads");
        if (!analytics && !ads.length) add("no_tracking", "No analytics or ad tags on the website: can't see where customers come from", 15, "ads", "gbp");
        else if (ads.length) add("runs_ads", `Already advertises online (${ads.join(", ")}): has a marketing budget`, 5, "ads");
        if (a?.mobileViewport === false) add("not_mobile", "Website isn't mobile-friendly", 10, "website");
        if (a?.pageSpeed && a.pageSpeed.score < 50) add("slow", `Slow on mobile (${a.pageSpeed.score}/100)`, 5, "website");
      }
      const ig = igHandle(l);
      const api = l.social?.instagram?.checked === "api" ? l.social.instagram : undefined;
      if (!ig && !l.pending) add("no_instagram", "No Instagram found", 10, "social");
      else if (api) {
        const quiet = daysSince(api.lastPostAt, now);
        if (quiet != null && quiet > 60) add("ig_quiet", `Instagram quiet for ${quiet} days`, 10, "social");
        if (api.followers != null && api.followers < 500) add("ig_small", `Small Instagram (${api.followers} followers)`, 5, "social");
      }
      if (BOOKS_FOR.test(l.category) && !a?.facts?.booking && !l.orderLinks?.length && st === "ok") add("no_booking", "No online booking or ordering on the website", 10, "website", "ads");
      if ((l.reviews ?? 0) >= 40 && (l.rating ?? 0) >= 4) add("busy", `Busy business: ${l.reviews} reviews`, 5);
    },
    chips: [
      ["competitor", { label: "Marketing agency", kind: "bad" }],
      ["no_reviews", { label: "No Google reviews", kind: "bad" }],
      ["few_reviews", (l) => ({ label: `${l.reviews} reviews`, kind: "warn" })],
      ["low_rating", (l) => ({ label: `${l.rating?.toFixed(1)}★ rating`, kind: "bad" })],
      ["no_website", { label: "No website", kind: "bad" }],
      ["site_down", { label: "Website broken", kind: "bad" }],
      ["no_tracking", { label: "No analytics or ads", kind: "warn" }],
      ["ig_quiet", { label: "Instagram quiet", kind: "warn" }],
      ["no_instagram", { label: "No Instagram", kind: "warn" }],
      ["no_booking", { label: "No online booking", kind: "warn" }],
      ["runs_ads", { label: "Runs ads", kind: "good" }],
      ["strong_google", { label: "Strong on Google", kind: "good" }],
    ],
    saw: [
      ["low_rating", (l) => ({ en: `I saw ${l.name} on Google: ${l.rating!.toFixed(1)}★ from ${l.reviews} reviews, which puts people off before they call.`, hi: `Maine Google pe ${l.name} dekha: ${l.reviews} reviews mein ${l.rating!.toFixed(1)}★ rating hai, isse log call karne se pehle hi ruk jaate hain.` })],
      ["no_reviews", (l) => ({ en: `I searched for ${l.category.toLowerCase()}s nearby and ${l.name} has no Google reviews yet, so it shows up below places that do.`, hi: `Maine paas ke ${l.category.toLowerCase()} search kiye, ${l.name} ke abhi Google reviews nahi hain, isliye ye neeche dikhta hai.` })],
      ["few_reviews", (l) => ({ en: `I searched for ${l.category.toLowerCase()}s nearby: ${l.name} has only ${l.reviews} Google reviews, so others show up first.`, hi: `Maine paas ke ${l.category.toLowerCase()} search kiye: ${l.name} ke sirf ${l.reviews} Google reviews hain, isliye doosre pehle dikhte hain.` })],
      ["no_website", (l) => ({ en: `${l.name} has no website, so people who find you on Google have nowhere to check you out.`, hi: `${l.name} ki website nahi hai, toh Google pe dhoondhne wale aapke baare mein zyada dekh nahi paate.` })],
      ["no_tracking", (l) => ({ en: `I looked at ${l.name}'s website: there's no analytics or ad tracking on it, so there's no way to see which visits turn into customers.`, hi: `Maine ${l.name} ki website dekhi: us pe analytics ya ad tracking nahi hai, toh pata nahi chalta kaunse visitors customer bante hain.` })],
      ["ig_quiet", (l) => ({ en: `${l.name}'s Instagram hasn't posted in a while, and that's where people check you out first.`, hi: `${l.name} ka Instagram kaafi samay se quiet hai, aur log sabse pehle wahi dekhte hain.` })],
      ["no_booking", (l) => ({ en: `${l.name}'s website has no way to book or order online, so visitors have to call or leave.`, hi: `${l.name} ki website pe online booking ya order ka option nahi hai, toh visitors ko call karna padta hai ya wo chale jaate hain.` })],
    ],
    offer: (needs) =>
      needs.includes("reviews") || needs.includes("gbp")
        ? { en: "We help local businesses get more Google reviews and show up higher on Maps, so more people call you first.", hi: "Hum local businesses ko zyada Google reviews aur Maps pe upar aane mein madad karte hain, taaki zyada log pehle aapko call karein." }
        : needs.includes("ads")
        ? { en: "We set up Google and Meta ads with tracking, so you see exactly which spend brings customers.", hi: "Hum tracking ke saath Google aur Meta ads set up karte hain, taaki pata chale kaunsa kharcha customer laata hai." }
        : { en: "We run social media and local marketing for businesses like yours.", hi: "Hum aap jaise businesses ke liye social media aur local marketing chalate hain." },
    ask: { en: "Can I send you a free 1-page check of your Google listing?", hi: "Kya main aapki Google listing ka free 1-page check bhej doon?" },
  },

  solar: {
    key: "solar",
    label: "Rooftop solar",
    blurb: "Factories, cold storage, hospitals, schools and hotels with big roofs and bills",
    heading: "Who's paying the most for power?",
    intro: "Pick an area and the kinds of business. We find factories, cold storage, warehouses, hospitals, schools and hotels with big roofs and big power bills, skip the ones already on solar, and write the first message.",
    typesHint: "Factories, cold storage and hospitals run all day: the biggest bills.",
    defaults: ["manufacturer", "cold_storage", "hospital"],
    needs: {
      rooftop: { label: "rooftop solar", chip: "Rooftop solar" },
      ppa: { label: "solar with no upfront cost (PPA / RESCO)", chip: "No-cost PPA" },
      battery: { label: "battery backup", chip: "Battery backup" },
    },
    competitor: /\b(solar|renewables?|photovoltaic|green energy|\bEPC\b|power solutions)\b/i,
    competitorLabel: "Solar company",
    doing: "I help factories and institutions cut their power bills with rooftop solar",
    topic: { en: "rooftop solar", hi: "rooftop solar" },
    subject: (n) => `${n} power bill`,
    tiers: [60, 35],
    reasons: ["factory", "cold_chain", "institution", "big_roof", "exporter_green", "iso14001"],
    growthNeeds: { expanding: ["rooftop"], new_business: ["rooftop", "ppa"] },
    chain: -15,
    score(l, add) {
      const f = l.audit?.facts;
      const k = catKey(l.category);
      if (k === "cold_storage" || /cold|freez|ice plant/i.test(f?.heavyPower ?? "")) add("cold_chain", `Cold storage: power runs day and night${f?.heavyPower ? ` ("${f.heavyPower}")` : ""}`, 30, "rooftop", "battery");
      else if (isFactory(l)) add("factory", `Factory: machines run all day${f?.heavyPower ? ` ("${f.heavyPower}")` : ""}`, 25, "rooftop", "ppa");
      if (k === "warehouse") add("big_roof", "Warehouse: a large flat roof", 20, "rooftop", "ppa");
      if (k === "hospital") add("institution", "Hospital: runs 24×7 with a high daytime load", 25, "rooftop", "battery");
      else if (k === "school") add("institution", "School or college: big roof and daytime use", 20, "rooftop", "ppa");
      else if (k === "hotel") add("institution", "Hotel: air-conditioning and hot water all day", 15, "rooftop");
      const estate = estateOf(l);
      if (estate) add("industrial", `In an industrial area (${estate})`, 10, "rooftop");
      if (l.openHours && Object.values(l.openHours).some((h) => /24 hours|open 24|24\s?x\s?7/i.test(h))) add("open_24", "Open 24 hours", 10, "battery");
      const t = l.audit?.trade;
      if (t?.exports) {
        const green = t.countries?.some((c) => EU_US.test(c));
        add("exporter_green", green ? `Exports to ${t.countries!.filter((c) => EU_US.test(c)).slice(0, 2).join(" and ")}: buyers there ask for green power and carbon figures` : "Exporter: overseas buyers increasingly ask for green power", green ? 15 : 5, "rooftop", "ppa");
      }
      if (f?.certs?.includes("ISO 14001")) add("iso14001", "ISO 14001 (environment) certified: has green targets", 10, "rooftop");
      const staff = staffOf(l);
      if (staff && staff >= 50) add("size", `About ${staff} staff: a big site`, 10, "ppa");
      if (f?.solar) add("has_solar", `Already has solar ("${f.solar}")`, -30, "battery");
    },
    chips: [
      ["competitor", { label: "Solar company", kind: "bad" }],
      ["has_solar", { label: "Already on solar", kind: "warn" }],
      ["cold_chain", { label: "Cold storage", kind: "good" }],
      ["factory", { label: "Factory", kind: "good" }],
      ["institution", (l) => ({ label: catKey(l.category) === "hospital" ? "Hospital" : catKey(l.category) === "school" ? "School / college" : "Hotel", kind: "good" })],
      ["big_roof", { label: "Big roof", kind: "good" }],
      ["exporter_green", { label: "Exporter", kind: "good" }],
      ["industrial", { label: "Industrial area", kind: "plain" }],
      ["open_24", { label: "Open 24 hours", kind: "plain" }],
    ],
    saw: [
      ["cold_chain", (l) => ({ en: `I came across ${l.name}: cold storage runs day and night, so power is probably your biggest bill.`, hi: `Maine ${l.name} dekha: cold storage din-raat chalta hai, toh bijli ka bill sabse bada kharcha hoga.` })],
      ["exporter_green", (l) => ({ en: `I saw ${l.name} exports${l.audit?.trade?.countries?.length ? ` to ${l.audit.trade.countries.slice(0, 2).join(" and ")}` : ""}: buyers there are starting to ask suppliers for green power.`, hi: `Maine dekha ${l.name} export karta hai${l.audit?.trade?.countries?.length ? ` (${l.audit.trade.countries.slice(0, 2).join(", ")})` : ""}: wahan ke buyers ab suppliers se green power maangne lage hain.` })],
      ["factory", (l) => ({ en: `I came across ${l.name}${estateOf(l) ? ` in ${estateOf(l)}` : ""}: with machines running all day, power must be one of your biggest costs.`, hi: `Maine ${l.name}${estateOf(l) ? ` (${estateOf(l)})` : ""} dekha: machines poore din chalti hain, toh bijli sabse bade kharchon mein hogi.` })],
      ["institution", (l) => ({ en: `I came across ${l.name}: a ${l.category.split(" ")[0].toLowerCase()} uses most of its power in the daytime, exactly when solar produces it.`, hi: `Maine ${l.name} dekha: ${l.category.split(" ")[0].toLowerCase()} mein zyada bijli din mein lagti hai, aur solar bhi din mein hi banta hai.` })],
      ["big_roof", (l) => ({ en: `I came across ${l.name}: a roof that size can make a big share of your own power.`, hi: `Maine ${l.name} dekha: itni badi chhat pe aapki kaafi bijli khud ban sakti hai.` })],
    ],
    offer: (needs) =>
      needs.includes("ppa")
        ? { en: "We install rooftop solar for businesses, including plans with no upfront cost where you only pay for the power, usually below your grid rate.", hi: "Hum businesses ke liye rooftop solar lagate hain, bina upfront kharche wale plan bhi, jisme aap sirf bijli ka paisa dete hain, aksar grid rate se kam." }
        : { en: "We install rooftop solar for businesses; most recover the cost in 3 to 5 years.", hi: "Hum businesses ke liye rooftop solar lagate hain; zyadatar ka kharcha 3 se 5 saal mein wapas aa jaata hai." },
    ask: { en: "If you share one recent power bill, I'll send a free savings estimate.", hi: "Ek recent bijli ka bill bhej dein, toh main free savings estimate bhej doon." },
  },

  accounting: {
    key: "accounting",
    label: "CA, GST & compliance",
    blurb: "New businesses, exporters, online sellers and traders with paperwork every month",
    heading: "Who has the most GST and compliance work?",
    intro: "Pick an area and the kinds of business. We find new businesses, exporters, online sellers, traders and companies that are hiring, say what filings they likely need, and write the first message.",
    typesHint: "Traders, exporters and online sellers file the most every month.",
    defaults: ["wholesaler", "exporter", "online_seller"],
    needs: {
      gst: { label: "GST filing", chip: "GST" },
      books: { label: "bookkeeping", chip: "Bookkeeping" },
      export: { label: "export compliance (LUT, GST refunds)", chip: "Export compliance" },
      payroll: { label: "payroll, PF & ESI", chip: "Payroll" },
      company: { label: "company & ROC filings", chip: "ROC filings" },
      tax: { label: "income tax & audit", chip: "Tax & audit" },
    },
    competitor: /\b(chartered accountants?|CA firm|tax (consultants?|advisors?)|accounting (services|firm)|accountants?|bookkeeping|audit(ors| firm)|GST (consultants?|practitioner)|company secretar(y|ies))\b|(&|\band) associates\b/i,
    competitorLabel: "CA / accounting firm",
    doing: "I handle GST, accounts and compliance for growing businesses",
    topic: { en: "GST and compliance", hi: "GST aur compliance" },
    subject: (n) => `${n} gst filings`,
    tiers: [55, 30],
    reasons: ["new_business", "exports", "sells_online", "trader", "multi_state", "hiring", "locations"],
    growthNeeds: { new_business: ["gst", "books", "company"], expanding: ["gst", "company"], hiring: ["payroll"] },
    chain: -20,
    score(l, add) {
      const t = l.audit?.trade;
      const tech = l.audit?.tech;
      const k = catKey(l.category);
      if (t?.exports) add("exports", "Exports: LUT filing and GST refunds on exports every year", 20, "export", "gst");
      if (t?.imports) add("imports", "Imports: IGST credit and customs duty to reconcile", 10, "gst", "export");
      if (t?.iec) add("iec", "Has an import-export code (IEC)", 5, "export");
      if (t?.sellsOnline || tech?.marketplaces?.length) add("sells_online", `Sells online${tech?.marketplaces?.length ? ` (${tech.marketplaces.slice(0, 2).join(", ")})` : ""}: marketplace TCS and GST to reconcile every month`, 20, "gst", "books");
      if (k === "wholesaler" || k === "distributor") add("trader", "Trader: many invoices and a high GST volume", 15, "gst", "books");
      if (t?.panIndia) add("multi_state", "Supplies across India: e-way bills and GST in several states", 10, "gst");
      if ((tech?.locations ?? 0) >= 2) add("locations", `${tech!.locations} locations: GST and books for each`, 10, "gst", "books");
      if (isFactory(l)) add("factory", "Manufacturer: stock, costing and audits", 10, "books", "tax");
      const staff = staffOf(l);
      if (staff && staff >= 10 && staff <= 1000) add("size", `About ${staff} staff: payroll, PF and ESI every month`, 10, "payroll", "tax");
      if (tech?.erp?.includes("Tally")) add("tally", "Keeps books in Tally", 5, "books", "tax");
    },
    chips: [
      ["competitor", { label: "CA / accounting firm", kind: "bad" }],
      ["new_business", { label: "New business", kind: "good" }],
      ["exports", { label: "Exporter", kind: "good" }],
      ["sells_online", { label: "Sells online", kind: "good" }],
      ["trader", { label: "Trader", kind: "good" }],
      ["hiring", { label: "Hiring", kind: "good" }],
      ["multi_state", { label: "Pan-India", kind: "plain" }],
      ["imports", { label: "Importer", kind: "plain" }],
      ["factory", { label: "Factory", kind: "plain" }],
    ],
    saw: [
      ["new_business", (l) => ({ en: `Congratulations on starting ${l.name}: the first year is when GST, books and company filings pile up.`, hi: `${l.name} shuru karne ke liye badhai: pehle saal mein hi GST, books aur company filings sabse zyada hoti hain.` })],
      ["exports", (l) => ({ en: `I saw ${l.name} exports${l.audit?.trade?.countries?.length ? ` to ${l.audit.trade.countries.slice(0, 2).join(" and ")}` : ""}: LUT renewals and GST refunds on exports are easy to leave money on.`, hi: `Maine dekha ${l.name} export karta hai: LUT renewal aur export GST refund mein aksar paisa atka reh jaata hai.` })],
      ["sells_online", (l) => ({ en: `I saw ${l.name} sells online: marketplace TCS and GST returns take hours to match every month.`, hi: `Maine dekha ${l.name} online bechta hai: marketplace TCS aur GST returns milaane mein har mahine ghante lag jaate hain.` })],
      ["trader", (l) => ({ en: `I came across ${l.name}: with that many invoices, GST matching can eat a lot of your team's time.`, hi: `Maine ${l.name} dekha: itne invoices ke saath GST matching mein team ka kaafi samay jaata hai.` })],
      ["hiring", (l) => ({ en: `I saw ${l.name} is hiring: payroll, PF and ESI get heavier with every new person.`, hi: `Maine dekha ${l.name} hiring kar raha hai: har naye bande ke saath payroll, PF aur ESI ka kaam badhta hai.` })],
    ],
    offer: (needs) =>
      needs.includes("export")
        ? { en: "We handle GST, LUT and export refunds for exporters, so refunds come in on time.", hi: "Hum exporters ke GST, LUT aur export refunds sambhalte hain, taaki refund time pe aaye." }
        : needs.includes("payroll")
        ? { en: "We handle payroll, PF, ESI and GST for growing teams, every month, on time.", hi: "Hum badhti teams ke payroll, PF, ESI aur GST har mahine time pe sambhalte hain." }
        : { en: "We handle GST, accounts and compliance for businesses like yours, every month, on time.", hi: "Hum aap jaise businesses ke GST, accounts aur compliance har mahine time pe sambhalte hain." },
    ask: { en: "Shall I do a free check of your last few GST returns for missed credit?", hi: "Kya main aapke pichle GST returns ka free check kar doon, koi credit chhoot toh nahi gaya?" },
  },

  staffing: {
    key: "staffing",
    label: "Hiring & staffing",
    blurb: "Companies hiring now, expanding, or running shifts",
    heading: "Who's hiring right now?",
    intro: "Pick an area and the kinds of business. We find companies whose websites show open roles, new branches or shift work, quote what we saw, and write the first message.",
    typesHint: "Factories, hospitals and hotels hire all year; IT firms hire in waves.",
    defaults: ["manufacturer", "hospital", "it_company"],
    needs: {
      recruit: { label: "hiring help", chip: "Recruiting" },
      bulk: { label: "bulk / shift-floor hiring", chip: "Bulk hiring" },
      temp: { label: "contract & temp staff", chip: "Contract staff" },
      payroll: { label: "payroll outsourcing", chip: "Payroll" },
    },
    competitor: /\b(placements?|recruit(ment|ers|ing)|staffing|manpower|HR (solutions|services|consult\w*)|job (consultancy|agency|portal)|executive search|talent (acquisition|solutions)|outsourcing services)\b/i,
    competitorLabel: "Staffing agency",
    doing: "I help companies fill roles fast, from shift-floor staff to managers",
    topic: { en: "hiring", hi: "hiring" },
    subject: (n) => `${n} open roles`,
    tiers: [55, 30],
    reasons: ["hiring", "manual_roles", "expanding", "new_business", "shift_work"],
    growthNeeds: { hiring: ["recruit"], expanding: ["recruit", "bulk"], new_business: ["recruit"] },
    chain: -10,
    score(l, add) {
      const k = catKey(l.category);
      const roles = l.audit?.tech?.manualRoles;
      if (roles?.length) add("manual_roles", `Hiring for ${roles.slice(0, 2).join(", ")}`, 15, "recruit", "temp");
      if (isFactory(l) || k === "warehouse" || k === "hotel" || k === "restaurant" || k === "hospital") add("shift_work", `${k === "hospital" ? "Hospital" : k === "hotel" ? "Hotel" : k === "restaurant" ? "Restaurant" : k === "warehouse" ? "Warehouse" : "Factory"}: shift and floor staff all year`, 10, "bulk", "temp");
      const staff = staffOf(l);
      if (staff && staff >= 50) add("size", `About ${staff} staff`, 10, "payroll", "bulk");
      else if (staff && staff >= 20) add("size", `About ${staff} staff`, 5, "payroll");
      if ((l.audit?.tech?.locations ?? 0) >= 3) add("locations", `${l.audit!.tech!.locations} locations to staff`, 10, "bulk");
    },
    chips: [
      ["competitor", { label: "Staffing agency", kind: "bad" }],
      ["hiring", { label: "Hiring now", kind: "good" }],
      ["expanding", { label: "Expanding", kind: "good" }],
      ["manual_roles", { label: "Office roles open", kind: "good" }],
      ["new_business", { label: "New business", kind: "good" }],
      ["shift_work", { label: "Shift staff", kind: "plain" }],
      ["locations", { label: "Several locations", kind: "plain" }],
    ],
    saw: [
      ["hiring", (l) => {
        const q = quote(l.signals.find((s) => s.key === "hiring")!);
        return { en: `I saw ${l.name} is hiring${q ? ` ("${q}" on your website)` : ""}.`, hi: `Maine dekha ${l.name} hiring kar raha hai${q ? ` (website pe "${q}")` : ""}.` };
      }],
      ["expanding", (l) => {
        const q = quote(l.signals.find((s) => s.key === "expanding")!);
        return { en: `I saw ${l.name} is expanding${q ? ` ("${q}")` : ""}: that usually means a lot of hiring at once.`, hi: `Maine dekha ${l.name} expand kar raha hai${q ? ` ("${q}")` : ""}: iska matlab ek saath kaafi hiring.` };
      }],
      ["manual_roles", (l) => ({ en: `I saw ${l.name} is looking for ${l.audit!.tech!.manualRoles!.slice(0, 2).join(" and ")} staff.`, hi: `Maine dekha ${l.name} ko ${l.audit!.tech!.manualRoles!.slice(0, 2).join(" aur ")} staff chahiye.` })],
      ["new_business", (l) => ({ en: `Congratulations on starting ${l.name}: building the first team is the hardest hiring there is.`, hi: `${l.name} shuru karne ke liye badhai: pehli team banana sabse mushkil hiring hoti hai.` })],
      ["shift_work", (l) => ({ en: `I came across ${l.name}: keeping shifts fully staffed is a constant job.`, hi: `Maine ${l.name} dekha: shifts ke liye staff poora rakhna roz ka kaam hai.` })],
    ],
    offer: (needs) =>
      needs.includes("bulk") || needs.includes("temp")
        ? { en: "We supply screened shift and contract staff, and can fill several roles within a week.", hi: "Hum screened shift aur contract staff dete hain, aur ek hafte mein kai roles bhar sakte hain." }
        : { en: "We find and screen candidates for you, and you only pay when someone joins.", hi: "Hum aapke liye candidates dhoondh ke screen karte hain, aur paisa tabhi jab koi join kare." },
    ask: { en: "Which role is hardest to fill right now? I can send 3 matching profiles this week.", hi: "Abhi kaunsa role bharna sabse mushkil hai? Is hafte 3 matching profiles bhej sakta hoon." },
  },

  insurance: {
    key: "insurance",
    label: "Business insurance",
    blurb: "Exporters, factories, warehouses and hospitals that need the right cover",
    heading: "Who needs better business cover?",
    intro: "Pick an area and the kinds of business. We find exporters and importers (cargo), factories and warehouses (fire and stock), hospitals (liability) and growing teams (group health), say which cover fits, and write the first message.",
    typesHint: "Exporters ship every month; factories and warehouses hold the most stock.",
    defaults: ["exporter", "manufacturer", "warehouse"],
    needs: {
      marine: { label: "marine cargo insurance", chip: "Marine cargo" },
      fire: { label: "fire & property insurance", chip: "Fire & property" },
      health: { label: "group health insurance", chip: "Group health" },
      liability: { label: "liability insurance", chip: "Liability" },
    },
    competitor: /\b(insurance|insurers?|assurance|insurance brok\w*|broking|policy (bazaar|advisor)|LIC (agent|advisor)|general insurance)\b/i,
    competitorLabel: "Insurance company",
    doing: "I help businesses get the right fire, cargo and staff insurance at a fair price",
    topic: { en: "business insurance", hi: "business insurance" },
    subject: (n) => `${n} insurance renewal`,
    tiers: [55, 30],
    reasons: ["ships_abroad", "factory", "stock_held", "hospital", "team", "expanding", "new_business"],
    growthNeeds: { expanding: ["fire"], new_business: ["fire", "health"], hiring: ["health"] },
    chain: -15,
    score(l, add) {
      const t = l.audit?.trade;
      const f = l.audit?.facts;
      const k = catKey(l.category);
      if (t?.exports || t?.imports || k === "exporter" || k === "importer") add("ships_abroad", `${t?.exports || k === "exporter" ? "Exports" : "Imports"}${t?.countries?.length ? ` (${t.countries.slice(0, 2).join(", ")})` : ""}: every shipment needs cargo cover`, 25, "marine");
      if (isFactory(l)) add("factory", "Factory with stock and machines: fire & property cover", 20, "fire");
      if (k === "warehouse" || k === "cold_storage") add("stock_held", "Holds stock, often for others: fire and goods-in-custody cover", 20, "fire", "liability");
      if (k === "chemical" || f?.hazardous) add("hazardous", "Handles chemicals or flammable goods: cover must be exactly right", 10, "fire", "liability");
      if (k === "hospital") add("hospital", "Hospital: medical liability and property cover", 20, "liability", "fire");
      else if (k === "school") add("institution", "School or college: property and student cover", 10, "fire", "liability");
      const staff = staffOf(l);
      if (staff && staff >= 10) add("team", `About ${staff} staff: group health cover helps keep them`, 15, "health");
      if (t?.b2b?.length) add("b2b", `Sells on ${t.b2b[0]}: ships to many buyers`, 5, "marine");
    },
    chips: [
      ["competitor", { label: "Insurance company", kind: "bad" }],
      ["ships_abroad", (l) => ({ label: l.audit?.trade?.imports && !l.audit?.trade?.exports ? "Importer" : "Exporter", kind: "good" })],
      ["factory", { label: "Factory", kind: "good" }],
      ["stock_held", { label: "Holds stock", kind: "good" }],
      ["hospital", { label: "Hospital", kind: "good" }],
      ["team", { label: "Growing team", kind: "good" }],
      ["hazardous", { label: "Hazardous goods", kind: "warn" }],
      ["expanding", { label: "Expanding", kind: "good" }],
    ],
    saw: [
      ["ships_abroad", (l) => ({ en: `I saw ${l.name} ${l.audit?.trade?.imports && !l.audit?.trade?.exports ? "imports" : "exports"}${l.audit?.trade?.countries?.length ? ` (${l.audit.trade.countries.slice(0, 2).join(", ")})` : ""}: one damaged container without the right cargo cover can wipe out a year's margin.`, hi: `Maine dekha ${l.name} ${l.audit?.trade?.imports && !l.audit?.trade?.exports ? "import" : "export"} karta hai: sahi cargo cover ke bina ek kharab container saal bhar ka margin le ja sakta hai.` })],
      ["stock_held", (l) => ({ en: `I came across ${l.name}: with stock held on site, the fire cover's sum insured needs to keep up with what's actually there.`, hi: `Maine ${l.name} dekha: godown mein stock hai, toh fire cover ka sum insured asli stock ke barabar hona chahiye.` })],
      ["factory", (l) => ({ en: `I came across ${l.name}${estateOf(l) ? ` in ${estateOf(l)}` : ""}: many factories find their fire cover hasn't kept up with new machines and stock.`, hi: `Maine ${l.name}${estateOf(l) ? ` (${estateOf(l)})` : ""} dekha: kai factories ka fire cover nayi machines aur stock ke hisaab se update nahi hota.` })],
      ["hospital", (l) => ({ en: `I came across ${l.name}: hospitals need liability and property cover that matches today's equipment.`, hi: `Maine ${l.name} dekha: hospital ko aaj ke equipment ke hisaab se liability aur property cover chahiye.` })],
      ["team", (l) => ({ en: `I saw ${l.name} has a growing team: group health cover is one of the cheapest ways to keep good people.`, hi: `Maine dekha ${l.name} ki team badh rahi hai: group health cover acche logon ko rokne ka sabse sasta tareeka hai.` })],
    ],
    offer: (needs) =>
      needs.includes("marine")
        ? { en: "We arrange marine cargo and business insurance from several insurers and compare them for you.", hi: "Hum kai insurers se marine cargo aur business insurance compare karke dilwate hain." }
        : needs.includes("health") && needs.length === 1
        ? { en: "We set up group health cover for teams, compared across insurers.", hi: "Hum teams ke liye group health cover, alag insurers compare karke, set up karte hain." }
        : { en: "We review business insurance (fire, stock, liability, staff health) and compare quotes from several insurers.", hi: "Hum business insurance (fire, stock, liability, staff health) review karke kai insurers ke quotes compare karte hain." },
    ask: { en: "When is your next renewal? I can compare it against 3 insurers for free.", hi: "Aapka agla renewal kab hai? Main free mein 3 insurers se compare kar doon." },
  },
};

export const NICHE_KEYS = Object.keys(NICHES) as NicheKey[];
export const isNiche = (o?: Offer | string): o is NicheKey => !!o && o in NICHES;

const join = (xs: string[]) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);
const lower = (s: string) => s.replace(/:.*$/, "").replace(/^./, (c) => c.toLowerCase());

/** Score a lead for a niche: the signals with their evidence, the tier, the why-now line and what it likely needs. */
export function scoreNiche(lead: Lead, key: NicheKey, now = new Date()): { signals: Signal[]; score: number; tier: Tier; whyNow: string; pitchFor: Extract<NonNullable<Lead["pitchFor"]>, { kind: "niche" }> } {
  const n = NICHES[key];
  const s: Signal[] = [];
  const needs = new Set<string>();
  const add: Add = (k, label, points, ...forWhat) => {
    s.push({ key: k, label, points });
    for (const x of forWhat) if (n.needs[x]) needs.add(x);
  };
  const competitor = n.competitor.test(`${lead.name} ${lead.about ?? ""}`);
  if (competitor) add("competitor", `${n.competitorLabel} itself (a competitor, not a customer)`, -70);
  n.score(lead, add, now);
  if (!competitor && !lead.chain)
    for (const g of growthSignals(lead, key, now)) {
      s.push(g);
      for (const x of n.growthNeeds[g.key as "new_business" | "expanding" | "hiring"] ?? []) needs.add(x);
    }
  if (lead.chain) add("chain", `Chain or brand (${lead.chain.reason}): head office decides`, n.chain);
  if (lead.phone || lead.phones.length || lead.audit?.whatsapp) add("has_phone", "Has a phone number", 5);
  if (lead.email || lead.emails.length || lead.audit?.emails.length) add("has_email", "Has an email", 5);
  const owner = lead.owner?.name ?? lead.audit?.ownerName;
  if (owner) add("owner_known", `Owner: ${owner}`, 5);
  if (!needs.size && !competitor) needs.add(Object.keys(n.needs)[0]);

  const score = Math.max(0, Math.min(100, s.reduce((t, x) => t + x.points, 0)));
  const tier: Tier = score >= n.tiers[0] ? "hot" : score >= n.tiers[1] ? "warm" : "cold";
  const list = Object.keys(n.needs).filter((x) => needs.has(x));
  return { signals: s, score, tier, whyNow: whyNow(lead, n, s, list, competitor), pitchFor: { kind: "niche", niche: key, needs: list } };
}

function whyNow(lead: Lead, n: Niche, s: Signal[], needs: string[], competitor: boolean): string {
  if (competitor) return `Looks like a ${n.competitorLabel.toLowerCase()} itself: a competitor, not a customer.`;
  const where = lead.city ? ` in ${lead.city}` : "";
  const order = [...n.reasons, ...s.map((x) => x.key)];
  const reasons = [...new Set(order)]
    .map((k) => s.find((x) => x.key === k && x.points > 0 && !["has_phone", "has_email", "owner_known", "busy"].includes(x.key)))
    .filter((x): x is Signal => !!x)
    .slice(0, 2)
    .map((x) => lower(x.label));
  const head = `${lead.category}${where}${reasons.length ? `: ${join(reasons)}` : ""}.`;
  const neg = s.find((x) => x.points < 0 && x.key !== "competitor");
  const caveat = neg ? ` ${neg.label.replace(/:.*$/, "")}.` : "";
  return `${head}${caveat}${needs.length ? ` Likely needs ${join(needs.map((x) => n.needs[x].label))}.` : ""}`;
}

/** Chips for a niche lead's card: at most 3, most important first. */
export function nicheChips(l: Lead): Chip[] {
  if (l.pitchFor?.kind !== "niche") return [];
  const n = NICHES[l.pitchFor.niche];
  const keys = new Set(l.signals.map((x) => x.key));
  return n.chips.filter(([k]) => keys.has(k)).slice(0, 3).map(([, c]) => (typeof c === "function" ? c(l) : c));
}

/** The labels of what a niche lead likely needs. */
export const nicheNeedLabels = (p: Extract<NonNullable<Lead["pitchFor"]>, { kind: "niche" }>) => p.needs.map((x) => NICHES[p.niche]?.needs[x]?.label ?? x);

/** Signals that make a niche lead worth a message on their own (the "clear reason" filter). */
export const hasNicheReason = (l: Pick<Lead, "signals" | "pitchFor">) => l.pitchFor?.kind === "niche" && l.signals.some((x) => NICHES[(l.pitchFor as { niche: NicheKey }).niche].reasons.includes(x.key) && x.points > 0);

/** The opening observation for a niche message, in the lead's language. */
export function nicheSaw(l: Lead, lang: "en" | "hi"): string {
  if (l.pitchFor?.kind !== "niche") return "";
  const n = NICHES[l.pitchFor.niche];
  const keys = new Set(l.signals.map((x) => x.key));
  const hit = n.saw.find(([k]) => keys.has(k));
  if (hit) return hit[1](l)[lang];
  return lang === "hi" ? `Maine ${l.name} ke baare mein dekha.` : `I came across ${l.name}${l.city ? ` in ${l.city}` : ""}.`;
}

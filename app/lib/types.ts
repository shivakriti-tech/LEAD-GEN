import type { EmailInfo } from "./enrich/email";

export type SourceId = "google" | "osm" | "apollo" | "instagram" | "facebook" | "web" | "gmaps";

/** Where you are with a lead. "interested" and "not_fit" are older names for "replied" and "lost". */
export type FollowUpStatus = "new" | "contacted" | "replied" | "meeting" | "won" | "lost" | "interested" | "not_fit";
export interface FollowUp {
  status: FollowUpStatus;
  note?: string;
  /** Date to get back to them, YYYY-MM-DD (your local date). */
  followUpOn?: string;
  /** When they were first moved past "New": what "contacted this week" counts. */
  contactedAt?: string;
  updatedAt: string;
  /** Each status change with its time (newest last), for the Home charts. */
  history?: Array<{ status: FollowUpStatus; at: string }>;
  /** Deal value in rupees, when you win it. */
  value?: number;
  /** Every message you sent them, oldest first: step 0 is the first message, 1 and 2 the follow-ups. */
  touches?: Touch[];
  /** When a reply was noticed in your inbox (email replies are found automatically). */
  repliedAt?: string;
  /** They agreed to WhatsApp messages from the client (replied on WhatsApp, or said yes): the WhatsApp API may message them. */
  optedIn?: { at: string; via: string };
  /** They asked not to be contacted (STOP, unsubscribe, "not interested, don't message"): every channel stops. */
  optedOut?: { at: string; via: string };
}

export type TouchChannel = "whatsapp" | "email" | "call" | "linkedin";
export interface Touch {
  channel: TouchChannel;
  step: number;
  at: string;
  /** Email only: its Message-ID (follow-ups reply in the same thread) and subject. */
  messageId?: string;
  subject?: string;
  to?: string;
}

/** One business as a source returns it, before merging. */
export interface RawPlace {
  source: SourceId;
  sourceId: string; // Google place id, OSM "node/123", …
  name: string;
  category: string; // our preset label, e.g. "Dentist"
  address?: string;
  city?: string;
  lat?: number;
  lng?: number;
  phone?: string;
  website?: string;
  email?: string;
  rating?: number;
  reviews?: number;
  businessStatus?: "OPERATIONAL" | "CLOSED_TEMPORARILY" | "CLOSED_PERMANENTLY";
  mapsUrl?: string;
  brand?: string; // OSM brand / operator tag: a sign of a chain
  // Extra details some sources give (the Google Maps scraper has most of them)
  owner?: string; // owner / listing manager name
  priceRange?: string; // "₹200–400", "₹₹"
  orderLinks?: OrderLink[]; // "Order online" / "Reserve a table" buttons on Google Maps
  photos?: number;
  openHours?: Record<string, string>;
  about?: string; // short business description
}

/** A booking/ordering link, e.g. Zomato, Swiggy, Practo, the business's own site. */
export interface OrderLink {
  source: string; // domain, e.g. "zomato.com"
  url: string;
}

export type WebsiteStatus =
  | "none" // no website at all
  | "social_only" // Instagram / Facebook / Linktree / Justdial as "website"
  | "down" // could not load
  | "ok";

export interface WebsiteAudit {
  checkedUrl?: string;
  finalUrl?: string;
  status: WebsiteStatus;
  httpStatus?: number;
  https?: boolean;
  mobileViewport?: boolean;
  copyrightYear?: number;
  builder?: string; // "Wix free site", "Blogspot", "WordPress", …
  freeSubdomain?: boolean;
  emails: string[];
  phones: string[];
  whatsapp?: string;
  socials: Record<string, string>;
  pageSpeed?: { score: number; lcp?: string };
  error?: string;
  foundedYear?: number; // "since 2009", JSON-LD foundingDate
  designedBy?: string; // agency credit in the footer, e.g. "Designed by XYZ Web"
  /** What the site says about moving goods: exports, imports, selling online, pan-India supply. */
  trade?: TradeHints;
  /** Growth clues on the site: the words that showed it (e.g. "current openings", "new branch"). */
  growth?: GrowthHints;
  /** How the site is built and run: store platform, tools, ERP, customer portal (agency searches). */
  tech?: TechHints;
  /** When the website's domain was registered (from public RDAP records), YYYY-MM-DD. */
  domainSince?: string;
  ownerName?: string; // schema.org founder/owner on the site
}

export interface TechHints {
  /** Store platform: "Shopify", "WooCommerce", "Magento 1", "Magento 2", "BigCommerce", "Wix", "Squarespace", … */
  platform?: string;
  /** A free default theme (Shopify Dawn, Debut…): the store was never customised. */
  defaultTheme?: string;
  /** Has a cart / checkout on its own site. */
  store?: boolean;
  /** Sells on marketplaces (Amazon, Etsy, eBay, Walmart, Noon…). */
  marketplaces?: string[];
  /** Email, CRM, chat and helpdesk tools found in the page (Klaviyo, HubSpot, Intercom…). */
  tools?: string[];
  /** ERP named on the site (SAP, Oracle, NetSuite, Odoo, Dynamics…). */
  erp?: string[];
  /** Customer login / portal. */
  portal?: boolean;
  /** Shipment or order tracking on the site. */
  tracking?: boolean;
  /** Quote / enquiry by a plain form or email only. */
  quoteForm?: boolean;
  /** Job roles that show manual work (data entry, dispatcher, admin assistant…). */
  manualRoles?: string[];
  /** "12 locations", "offices in 5 countries". */
  locations?: number;
}

export interface GrowthHints {
  hiring?: string;
  opened?: string;
  expanding?: string;
}

export interface TradeHints {
  exports?: boolean;
  imports?: boolean;
  /** Import Export Code mentioned. */
  iec?: boolean;
  /** Countries named on the site, e.g. ["UAE", "USA"]. */
  countries?: string[];
  panIndia?: boolean;
  /** Cart/checkout, or links to Amazon, Flipkart, Meesho. */
  sellsOnline?: boolean;
  /** Listings on IndiaMart, TradeIndia, ExportersIndia, Alibaba. */
  b2b?: string[];
  manufactures?: boolean;
  dealers?: boolean;
}

/** Logistics services your client offers. */
/** freight = by road (trucks), forwarding = export handling, sea = sea / ocean freight. */
export type LogisticsService = "customs" | "documentation" | "dgft" | "icegate" | "sea" | "freight" | "imports" | "forwarding" | "courier" | "warehousing";
/** Your own agency's services (international track): what a lead may need built. */
export type AgencyService = "website" | "ecommerce" | "crm_erp" | "ai_automation";
/** What you're finding leads for. */
export type Offer = "website_development" | "logistics" | "agency";

export interface Signal {
  key: string;
  label: string;
  points: number;
}

export type Tier = "hot" | "warm" | "cold";

export interface Lead {
  /** Country the lead is in (ISO code); older leads: India. */
  country?: string;
  id: string;
  name: string;
  category: string;
  address?: string;
  city?: string;
  lat?: number;
  lng?: number;
  phone?: string; // normalised +91…
  phones: string[];
  email?: string;
  emails: string[];
  website?: string;
  sources: SourceId[];
  placeId?: string;
  osmId?: string;
  mapsUrl?: string;
  rating?: number;
  reviews?: number;
  businessStatus?: RawPlace["businessStatus"];
  audit?: WebsiteAudit;
  company?: { employees?: number; linkedin?: string; foundedYear?: number };
  /** Owner or decision-maker, and where we learned it. */
  owner?: { name: string; via: "google_maps" | "website" };
  priceRange?: string;
  orderLinks?: OrderLink[];
  photos?: number;
  openHours?: Record<string, string>;
  about?: string;
  /** Every email we have, most useful first, with whether its domain can receive mail. */
  emailInfo?: EmailInfo[];
  /** Social profiles: from a source, the business's website, or web search. Details only via Meta's official API. */
  social?: {
    instagram?: { handle: string; url: string; name?: string; bio?: string; website?: string; followers?: number; posts?: number; lastPostAt?: string; checked: "api" | "link_only" | "not_business" };
    facebook?: { page: string; url: string; fans?: number; website?: string };
  };
  brand?: string;
  /** Same name found at several places in this search, or tagged as a brand: head office decides, not the outlet. */
  chain?: { outlets: number; reason: string };
  /** How we know about the website, and what we checked before saying there is none. */
  websiteCheck?: {
    via: "source" | "domain_guess" | "web_search" | "instagram_bio" | "none_found";
    evidence?: string; // e.g. "business name + phone number found on the page"
    tried: string[]; // human-readable list of checks
  };
  signals: Signal[];
  score: number;
  tier: Tier;
  whyNow: string;
  /** Still being checked (website, contacts); the score may change. */
  pending?: boolean;
  /** What you've done with this lead, and your note. Set from the screen, kept with the search. */
  followUp?: FollowUp;
  /** When this business's details were last checked (website, contacts). */
  checkedAt?: string;
  /** Came from the saved directory (found by an earlier search or the prefill). */
  saved?: boolean;
  /** What changed since it was last checked, e.g. "Now has a website". */
  changes?: string[];
  /** Set when the search was for a logistics client: what this business likely needs. */
  pitchFor?: { kind: "logistics"; client?: string; needs: LogisticsService[] } | { kind: "agency"; client?: string; needs: AgencyService[]; track: "store" | "company" };
}

export interface SearchParams {
  sells: Offer;
  /** For a logistics search: your client and what they offer. */
  client?: { name?: string; services: LogisticsService[] };
  /** The client (Business Brain) the search is for; its name is in client.name. */
  clientId?: string;
  /** For an agency search: the services you sell (default: all four). */
  agency?: { services: AgencyService[] };
  /** Country to search in (ISO code, default IN). */
  country?: import("./markets").CountryCode;
  categories: string[]; // preset keys
  city: string;
  area?: string;
  perCategory: number; // max leads per category per source
  sources: { google: boolean; osm: boolean; apollo: boolean; instagram: boolean; facebook: boolean; web: boolean; gmaps: boolean };
  pageSpeed: boolean;
  /** Look for a website ourselves before saying "no website". */
  verifyWebsites: boolean;
  /** Also use a web search (DuckDuckGo, or Brave with a key) when guessing fails. */
  webSearch: boolean;
  /** Don't use saved data; search everything live. */
  fresh?: boolean;
  /** Filters to start the results with (nothing is thrown away: you can turn them off). */
  keep?: KeepOnly;
}

export interface KeepOnly {
  skipChains: boolean;
  needPhone: boolean;
  /** Hide businesses you've already contacted, in this or any search. */
  notContacted: boolean;
  /** 4★ and above (businesses without a rating stay). */
  goodRating: boolean;
}

export interface SearchRecord {
  id: string;
  createdAt: string;
  params: SearchParams;
  status: "running" | "done" | "failed" | "stopped";
  counts: { found: number; afterDedupe: number; hot: number; warm: number; cold: number };
  error?: string;
}

/** Streamed to the browser while a search runs. */
export type ProgressEvent =
  | { type: "start"; searchId: string }
  | { type: "log"; level: "info" | "warn" | "error"; message: string }
  | { type: "stage"; stage: "search" | "dedupe" | "verify" | "enrich" | "social" | "speed" | "score" | "save"; done: number; total: number }
  | { type: "leads"; leads: Lead[] } // every business, before checking: show them right away
  | { type: "lead"; lead: Lead } // one business finished checking: replace it in the list
  | { type: "done"; search: SearchRecord; leads: Lead[] };

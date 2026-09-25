import type { EmailInfo } from "./enrich/email";

export type SourceId = "google" | "osm" | "apollo" | "instagram" | "facebook" | "web" | "gmaps";

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
  ownerName?: string; // schema.org founder/owner on the site
}

export interface Signal {
  key: string;
  label: string;
  points: number;
}

export type Tier = "hot" | "warm" | "cold";

export interface Lead {
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
}

export interface SearchParams {
  sells: "website_development";
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
}

export interface SearchRecord {
  id: string;
  createdAt: string;
  params: SearchParams;
  status: "running" | "done" | "failed";
  counts: { found: number; afterDedupe: number; hot: number; warm: number; cold: number };
  error?: string;
}

/** Streamed to the browser while a search runs. */
export type ProgressEvent =
  | { type: "start"; searchId: string }
  | { type: "log"; level: "info" | "warn" | "error"; message: string }
  | { type: "stage"; stage: "search" | "dedupe" | "verify" | "enrich" | "social" | "speed" | "score" | "save"; done: number; total: number }
  | { type: "done"; search: SearchRecord; leads: Lead[] };

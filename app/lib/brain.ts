import { z } from "zod";
import { ALL_SERVICES } from "./score/logistics";
import type { LogisticsService } from "./types";

/**
 * The Business Brain: everything the app knows about one client (the business you find leads for).
 * What they sell and for how much, who they want as customers, why people pick them, and the rules
 * their messages must follow. Searches, messages and reports read it; the AI agent (Module 5) will too.
 *
 * Filled from the client's own website (lib/brainAnalyze.ts), then reviewed and edited by you.
 */

const text = (max: number) => z.string().trim().max(max);
const list = (maxItems: number, maxLen = 200) => z.array(text(maxLen)).max(maxItems).transform((xs) => xs.filter(Boolean));

export const ServiceSchema = z.object({
  name: text(120).min(1),
  description: text(400).optional(),
  /** As the client says it: "₹9,999", "from ₹15,000 / month", "on request". */
  price: text(120).optional(),
  /** For logistics clients: which of the app's services this is (drives lead needs and messages). */
  logistics: z.enum(ALL_SERVICES as [LogisticsService, ...LogisticsService[]]).optional(),
});

export const BrainSchema = z.object({
  name: text(120).min(1, "Give the client a name"),
  website: text(300).optional(),
  city: text(80).optional(),
  phone: text(40).optional(),
  email: text(160).optional(),
  /** Which kind of leads to find for them. */
  offer: z.enum(["website_development", "logistics"]),
  /** One line: what they do. */
  summary: text(400).optional(),
  services: z.array(ServiceSchema).max(60).default([]),
  audience: z
    .object({
      /** Business-type keys from lib/categories.ts. */
      categories: list(30, 40).default([]),
      areas: list(30, 80).default([]),
      notes: text(600).optional(),
    })
    .default({ categories: [], areas: [] }),
  /** Why customers pick them: "Delivered 300+ websites", "Own customs broker licence". */
  usps: list(12).default([]),
  /** Proof: clients, years, certifications, reviews. */
  proof: list(12).default([]),
  rules: z
    .object({
      dos: list(20, 300).default([]),
      donts: list(20, 300).default([]),
      /** Words or phrases no message may contain ("cheapest", "guaranteed"). */
      bannedPhrases: list(30, 80).default([]),
    })
    .default({ dos: [], donts: [], bannedPhrases: [] }),
  pitch: z
    .object({
      /** A short price line messages may use: "Websites from ₹9,999". */
      priceHook: text(120).optional(),
      /** Put the price hook in first messages. */
      mentionPrice: z.boolean().default(false),
      /** The one-line reason to pick them, used in messages. */
      usp: text(200).optional(),
    })
    .default({ mentionPrice: false }),
  /** Who messages are signed by. */
  sender: z.object({ name: text(80).optional(), phone: text(40).optional(), link: text(300).optional() }).default({}),
  analysis: z
    .object({
      at: z.string(),
      by: z.enum(["gpt", "gemini", "claude", "rules"]),
      pages: z.array(z.string()).max(20),
      notes: z.array(z.string()).max(20).optional(),
    })
    .optional(),
});

export type BrainInput = z.input<typeof BrainSchema>;
export type ClientBrain = z.output<typeof BrainSchema> & { id: string; createdAt: string; updatedAt: string };
export type Service = z.output<typeof ServiceSchema>;

/** Check a brain sent by the browser. Returns the cleaned brain or the first problem, in words. */
export function parseBrain(input: unknown): { ok: true; brain: z.output<typeof BrainSchema> } | { ok: false; error: string } {
  const r = BrainSchema.safeParse(input);
  if (r.success) return { ok: true, brain: r.data };
  const i = r.error.issues[0];
  return { ok: false, error: `${i.path.join(".") || "brain"}: ${i.message}` };
}

/** A lowest price in rupees from price text: "from ₹15,000 / month" → 15000, "Rs. 9,999" → 9999. */
export function priceFrom(price?: string): number | undefined {
  const m = price?.replace(/,/g, "").match(/(?:₹|rs\.?|inr)\s*(\d+(?:\.\d+)?)\s*(k|l|lakh|lac)?/i);
  if (!m) return undefined;
  const n = Number(m[1]) * (/^k$/i.test(m[2] ?? "") ? 1000 : /^(l|lakh|lac)$/i.test(m[2] ?? "") ? 100_000 : 1);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : undefined;
}

/** Which of the client's services a message can name for a logistics lead, in the app's service keys. */
export const brainServices = (b: Pick<ClientBrain, "services">): LogisticsService[] => [...new Set(b.services.map((s) => s.logistics).filter((x): x is LogisticsService => !!x))];

/** Banned phrases found in a message (case-insensitive, whole words where the phrase starts/ends with a letter). */
export function bannedIn(message: string, banned: string[]): string[] {
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return banned.filter((p) => {
    const t = p.trim();
    if (!t) return false;
    const re = new RegExp(`${/^\w/.test(t) ? "\\b" : ""}${esc(t)}${/\w$/.test(t) ? "\\b" : ""}`, "i");
    return re.test(message);
  });
}

/** "Basic website - ₹9,999" / "SEO: from ₹5,000 per month" → rows */
export function parsePriceList(text: string): Array<{ name: string; price?: string }> {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const m = line.match(/^(.*?)\s*(?:[-–—:|\t]|\.{2,})\s*((?:from|starting|starts at|only|@)?\s*(?:₹|rs\.?|inr)\s?.*|on request|free|call.*)$/i);
      return m ? { name: m[1].trim(), price: m[2].trim() } : { name: line };
    })
    .filter((x) => x.name.length > 0)
    .slice(0, 40);
}

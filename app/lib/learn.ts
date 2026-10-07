import type { Lead, Offer, Signal, Tier } from "./types";
import type { Store } from "./store";
import { statusOf } from "./outreach";
import { isNiche, NICHES } from "./niches";

/**
 * Learning from your own results. The points in lib/score are educated guesses; once you've
 * messaged enough leads, your replies say which reasons actually work in your market. For each
 * signal (no website, few reviews, exporter…) we compare how often leads with it replied against
 * your overall reply rate, and nudge new leads' scores by at most ±15 points, with the evidence on
 * the lead ("Your results: leads with no website replied 2.1× as often, 9 of 30").
 *
 * Careful by design: nothing changes until 30 leads of this kind were messaged, a signal needs 8
 * messaged leads of its own, and each rate is pulled towards your average (a prior worth 10 leads)
 * so a lucky streak doesn't swing scores. LEARN_FROM_RESULTS=off turns it off.
 */

export const MIN_CONTACTED = 30;
export const MIN_PER_SIGNAL = 8;
const PRIOR = 10;
const MAX_POINTS = 15;
const REPLIED = new Set(["replied", "meeting", "won"]);
/** Contact details aren't a reason to pitch: they'd only teach "leads we could reach replied". */
const SKIP = new Set(["has_phone", "has_email", "owner_known", "learned"]);

export interface SignalStat {
  key: string;
  contacted: number;
  replied: number;
  /** Smoothed reply rate for leads with this signal. */
  rate: number;
  /** rate ÷ your overall reply rate. */
  lift: number;
}
export interface Learned {
  contacted: number;
  replied: number;
  /** Your overall reply rate. */
  base: number;
  signals: Record<string, SignalStat>;
}

const messaged = (l: Lead) => statusOf(l) !== "new" || (l.followUp?.touches?.length ?? 0) > 0;
const repliedTo = (l: Lead) => REPLIED.has(statusOf(l)) || !!l.followUp?.repliedAt;

/** Reply rates per signal from leads you've messaged. The same business in several searches counts once. */
export function learnFrom(leads: Lead[]): Learned {
  const seen = new Set<string>();
  const sent: Lead[] = [];
  for (const l of leads) {
    if (l.pending || !messaged(l)) continue;
    const k = l.placeId ?? l.phone ?? `${l.name.toLowerCase()}|${l.city ?? ""}`;
    if (seen.has(k)) continue;
    seen.add(k);
    sent.push(l);
  }
  const replied = sent.filter(repliedTo).length;
  const base = sent.length ? replied / sent.length : 0;
  const by = new Map<string, { contacted: number; replied: number }>();
  for (const l of sent) {
    const r = repliedTo(l);
    for (const key of new Set(l.signals.filter((s) => s.points > 0 && !SKIP.has(s.key)).map((s) => s.key))) {
      const e = by.get(key) ?? { contacted: 0, replied: 0 };
      e.contacted++;
      if (r) e.replied++;
      by.set(key, e);
    }
  }
  const signals: Record<string, SignalStat> = {};
  for (const [key, e] of by) {
    const rate = (e.replied + base * PRIOR) / (e.contacted + PRIOR);
    signals[key] = { key, ...e, rate, lift: base > 0 ? rate / base : 1 };
  }
  return { contacted: sent.length, replied, base, signals };
}

const words = (key: string) => key.replace(/_/g, " ");

/** The nudge for one lead, as a signal with its evidence, or undefined when there isn't enough to go on. */
export function learnedSignal(signals: Signal[], learned?: Learned): Signal | undefined {
  if (!learned || learned.contacted < MIN_CONTACTED || learned.base <= 0) return undefined;
  // a competitor stays at 0 whatever else it shares with good leads
  if (signals.some((s) => s.key === "competitor")) return undefined;
  let sum = 0;
  let best: { st: SignalStat; w: number } | undefined;
  for (const s of signals) {
    if (s.points <= 0 || SKIP.has(s.key)) continue;
    const st = learned.signals[s.key];
    if (!st || st.contacted < MIN_PER_SIGNAL) continue;
    const w = Math.log(st.lift);
    sum += w;
    if (!best || Math.abs(w) > Math.abs(best.w)) best = { st, w };
  }
  const points = Math.round(Math.max(-MAX_POINTS, Math.min(MAX_POINTS, sum * 10)));
  if (!best || Math.abs(points) < 3) return undefined;
  const { st } = best;
  const label =
    st.lift >= 1
      ? `Your results: leads with ${words(st.key)} replied ${st.lift.toFixed(1)}× as often (${st.replied} of ${st.contacted})`
      : `Your results: leads with ${words(st.key)} replied less often than average (${st.replied} of ${st.contacted})`;
  return { key: "learned", label, points };
}

/** Strong / worth a try / skip, at each offer's own thresholds. */
export function tierFor(offer: Offer, score: number): Tier {
  const [hot, warm] = offer === "website_development" ? [65, 40] : isNiche(offer) ? NICHES[offer].tiers : [60, 30];
  return score >= hot ? "hot" : score >= warm ? "warm" : "cold";
}

/** A scored lead with the nudge from your results added (unchanged when there's nothing to learn yet). */
export function withLearned<T extends { signals: Signal[]; score: number; tier: Tier }>(r: T, offer: Offer, learned?: Learned): T {
  const extra = learnedSignal(r.signals, learned);
  if (!extra) return r;
  const score = Math.max(0, Math.min(100, r.score + extra.points));
  return { ...r, signals: [...r.signals, extra], score, tier: tierFor(offer, score) };
}

const memo = new Map<string, { at: number; v: Learned }>();

/** What your saved searches of this kind say. Remembered for 10 minutes. */
export async function learnFromStore(store: Store, offer: Offer, env: Record<string, string | undefined> = process.env): Promise<Learned | undefined> {
  if (/^(off|0|false|no)$/i.test(env.LEARN_FROM_RESULTS ?? "")) return undefined;
  const hit = memo.get(offer);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.v;
  const searches = (await store.listSearches()).filter((s) => (s.params.sells ?? "website_development") === offer).slice(0, 200);
  const leads: Lead[] = [];
  for (const s of searches) leads.push(...((await store.getSearch(s.id))?.leads ?? []));
  const v = learnFrom(leads);
  memo.set(offer, { at: Date.now(), v });
  return v;
}

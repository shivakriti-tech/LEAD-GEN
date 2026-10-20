import type { Lead, Offer, Signal, Tier } from "./types";
import type { Store } from "./store";
import { statusOf } from "./outreach";
import { isNiche, NICHES } from "./niches";

/**
 * Learning from your own results, the way Apollo's AI scores learn from a team's own deals. The
 * points in lib/score are educated guesses; once you've messaged enough leads, your replies say
 * which reasons actually work in your market.
 *
 * A small logistic regression is trained on the leads you messaged: did they reply, given their
 * reasons (no website, few reviews, exporter…) and their business type. Unlike adding up each
 * reason's reply rate, it doesn't count the same thing twice when two reasons usually come
 * together, and a business type that replies well (dentists vs cafés) counts too. New leads are
 * nudged by at most ±15 points, with the evidence on the lead ("Your results: leads with no
 * website replied 2.1× as often, 9 of 30").
 *
 * Careful by design:
 *  - nothing changes until 30 leads of this kind were messaged, and a reason or type needs 8 leads
 *    with it and 8 without before it counts;
 *  - every weight is pulled towards zero (a prior worth about a dozen leads), so a lucky streak
 *    doesn't swing scores;
 *  - recent results count more (half weight after 6 months): markets and messages change;
 *  - a lead messaged in the last 3 days that hasn't replied yet isn't counted as "no reply";
 *  - with enough recent results, the model is first trained on older leads and tested on your
 *    newest ones. If it can't tell who replies from who doesn't, it isn't used.
 * LEARN_FROM_RESULTS=off turns it off.
 */

export const MIN_CONTACTED = 30;
export const MIN_PER_SIGNAL = 8;
const PRIOR = 10;
const MAX_POINTS = 15;
/** Weight penalty (L2): each weight starts from "no effect" and needs evidence to move. */
const LAMBDA = 1.5;
const HALF_LIFE_DAYS = 180;
const PENDING_DAYS = 3;
/** On a test against your newest leads, below this the model isn't better than a coin flip. */
const MIN_AUC = 0.55;
const MAX_FEATURES = 120;
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

export interface Model {
  /** "s:no_website" for a reason, "c:dentist" for a business type. */
  features: string[];
  weights: number[];
  bias: number;
  /** Log-odds of your (recency-weighted) reply rate: the "average lead" the nudge is measured from. */
  baseLogit: number;
  /** Tested on your newest leads after training on the older ones (left out when there were too few). */
  test?: { leads: number; replied: number; auc: number; scoreAuc?: number };
  /** False when the test says it can't tell repliers apart: then it changes nothing. */
  useful: boolean;
}

export interface Learned {
  contacted: number;
  replied: number;
  /** Your overall reply rate. */
  base: number;
  signals: Record<string, SignalStat>;
  /** Reply rates per business type, like `signals`. */
  categories?: Record<string, SignalStat>;
  model?: Model;
}

const messaged = (l: Lead) => statusOf(l) !== "new" || (l.followUp?.touches?.length ?? 0) > 0;
const repliedTo = (l: Lead) => REPLIED.has(statusOf(l)) || !!l.followUp?.repliedAt;
const catKey = (c?: string) => (c ?? "").trim().toLowerCase();
/** When you first messaged them, as best we know. */
function contactedAt(l: Lead): number | undefined {
  const f = l.followUp;
  const t = f?.contactedAt ?? f?.touches?.[0]?.at ?? f?.history?.find((h) => h.status !== "new")?.at ?? f?.updatedAt;
  const ms = t ? Date.parse(t) : NaN;
  return Number.isFinite(ms) ? ms : undefined;
}
/** The features one lead has: its reasons (not contact details) and its business type. */
function featuresOf(signals: Signal[], category?: string): string[] {
  const f = new Set(signals.filter((s) => !SKIP.has(s.key)).map((s) => `s:${s.key}`));
  if (catKey(category)) f.add(`c:${catKey(category)}`);
  return [...f];
}

interface Row {
  x: string[];
  y: 0 | 1;
  w: number;
  at: number;
  /** The written score without any earlier learned nudge, to compare against on the test. */
  score: number;
}

/** Reply rates per signal and a trained model from leads you've messaged. The same business in several searches counts once. */
export function learnFrom(leads: Lead[], now = new Date()): Learned {
  const seen = new Set<string>();
  const rows: Row[] = [];
  const sent: Lead[] = [];
  for (const l of leads) {
    if (l.pending || !messaged(l)) continue;
    const k = l.placeId ?? l.phone ?? `${l.name.toLowerCase()}|${l.city ?? ""}`;
    if (seen.has(k)) continue;
    const y = repliedTo(l) ? 1 : 0;
    const at = contactedAt(l) ?? now.getTime();
    const age = (now.getTime() - at) / 86_400_000;
    // too soon to say they won't reply
    if (!y && age < PENDING_DAYS) continue;
    seen.add(k);
    sent.push(l);
    const learnedPts = l.signals.find((s) => s.key === "learned")?.points ?? 0;
    rows.push({ x: featuresOf(l.signals, l.category), y, w: Math.max(0.2, 0.5 ** (Math.max(0, age) / HALF_LIFE_DAYS)), at, score: l.score - learnedPts });
  }
  const replied = rows.filter((r) => r.y).length;
  const base = rows.length ? replied / rows.length : 0;

  // plain reply rates, for the evidence shown on a lead
  const tally = (pick: (l: Lead) => string[]) => {
    const by = new Map<string, { contacted: number; replied: number }>();
    sent.forEach((l, i) => {
      for (const key of new Set(pick(l))) {
        const e = by.get(key) ?? { contacted: 0, replied: 0 };
        e.contacted++;
        if (rows[i].y) e.replied++;
        by.set(key, e);
      }
    });
    const out: Record<string, SignalStat> = {};
    for (const [key, e] of by) {
      const rate = (e.replied + base * PRIOR) / (e.contacted + PRIOR);
      out[key] = { key, ...e, rate, lift: base > 0 ? rate / base : 1 };
    }
    return out;
  };
  const signals = tally((l) => l.signals.filter((s) => !SKIP.has(s.key)).map((s) => s.key));
  const categories = tally((l) => (catKey(l.category) ? [catKey(l.category)] : []));

  const learned: Learned = { contacted: rows.length, replied, base, signals, categories };
  if (rows.length >= MIN_CONTACTED && replied > 0 && replied < rows.length) learned.model = trainChecked(rows);
  return learned;
}

/** Train on everything, after testing the same recipe on the newest quarter of your leads. */
function trainChecked(rows: Row[]): Model {
  const model = train(rows);
  const byTime = [...rows].sort((a, b) => a.at - b.at);
  const cut = Math.floor(byTime.length * 0.75);
  const older = byTime.slice(0, cut), newer = byTime.slice(cut);
  const pos = newer.filter((r) => r.y).length;
  const oldPos = older.filter((r) => r.y).length;
  if (older.length >= MIN_CONTACTED && oldPos > 0 && oldPos < older.length && pos >= 5 && newer.length - pos >= 5) {
    const m = train(older);
    const auc = aucOf(newer.map((r) => ({ y: r.y, s: logitOf(m, r.x) })));
    const scoreAuc = aucOf(newer.map((r) => ({ y: r.y, s: r.score })));
    model.test = { leads: newer.length, replied: pos, auc, scoreAuc };
    model.useful = auc >= MIN_AUC;
  }
  return model;
}

/** Weighted logistic regression with an L2 penalty, by Newton's method (small data: exact and quick). */
function train(rows: Row[]): Model {
  // features seen often enough, with enough leads without them to compare against
  const count = new Map<string, number>();
  for (const r of rows) for (const f of r.x) count.set(f, (count.get(f) ?? 0) + 1);
  const features = [...count.entries()]
    .filter(([, n]) => n >= MIN_PER_SIGNAL && rows.length - n >= MIN_PER_SIGNAL)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, MAX_FEATURES)
    .map(([f]) => f);
  const index = new Map(features.map((f, i) => [f, i + 1]));
  const d = features.length + 1; // [bias, ...weights]
  const X = rows.map((r) => r.x.map((f) => index.get(f)).filter((i): i is number => i != null));
  const W = rows.reduce((t, r) => t + r.w, 0);
  const yw = rows.reduce((t, r) => t + r.w * r.y, 0);
  const p0 = Math.min(1 - 1e-6, Math.max(1e-6, yw / W));
  const beta = new Array<number>(d).fill(0);
  beta[0] = Math.log(p0 / (1 - p0));
  for (let iter = 0; iter < 50; iter++) {
    const g = new Array<number>(d).fill(0);
    const H = Array.from({ length: d }, () => new Array<number>(d).fill(0));
    rows.forEach((r, n) => {
      const idx = [0, ...X[n]];
      const z = idx.reduce((t, i) => t + beta[i], 0);
      const p = 1 / (1 + Math.exp(-z));
      const e = r.w * (p - r.y), h = r.w * p * (1 - p);
      for (const i of idx) {
        g[i] += e;
        for (const j of idx) H[i][j] += h;
      }
    });
    for (let i = 0; i < d; i++) {
      const lam = i === 0 ? 1e-4 : LAMBDA;
      g[i] += lam * beta[i];
      H[i][i] += lam;
    }
    const step = solve(H, g);
    if (!step) break;
    let max = 0;
    for (let i = 0; i < d; i++) {
      beta[i] -= step[i];
      max = Math.max(max, Math.abs(step[i]));
    }
    if (max < 1e-7) break;
  }
  return { features, weights: beta.slice(1), bias: beta[0], baseLogit: Math.log(p0 / (1 - p0)), useful: true };
}

/** Solve A·x = b (A symmetric positive definite here), by Gaussian elimination with pivoting. */
function solve(A: number[][], b: number[]): number[] | undefined {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-12) return undefined;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = c + 1; r < n; r++) {
      const f = M[r][c] / M[c][c];
      if (f) for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = M[r][n];
    for (let k = r + 1; k < n; k++) s -= M[r][k] * x[k];
    x[r] = s / M[r][r];
  }
  return x;
}

function logitOf(m: Model, x: string[]): number {
  const has = new Set(x);
  return m.features.reduce((t, f, i) => t + (has.has(f) ? m.weights[i] : 0), m.bias);
}

/** How often a replier is ranked above a non-replier (0.5 = a coin flip, 1 = always). */
export function aucOf(xs: Array<{ y: number; s: number }>): number {
  const pos = xs.filter((x) => x.y).map((x) => x.s), neg = xs.filter((x) => !x.y).map((x) => x.s);
  if (!pos.length || !neg.length) return 0.5;
  let wins = 0;
  for (const p of pos) for (const n of neg) wins += p > n ? 1 : p === n ? 0.5 : 0;
  return wins / (pos.length * neg.length);
}

const words = (key: string) => key.replace(/_/g, " ");

/**
 * The nudge for one lead, as a signal with its evidence, or undefined when there isn't enough to
 * go on. `category` is the lead's business type (it counts once the model has seen enough of it).
 */
export function learnedSignal(signals: Signal[], learned?: Learned, category?: string): Signal | undefined {
  const m = learned?.model;
  if (!learned || !m || !m.useful || learned.contacted < MIN_CONTACTED || learned.base <= 0) return undefined;
  // a competitor stays at 0 whatever else it shares with good leads
  if (signals.some((s) => s.key === "competitor")) return undefined;
  const x = featuresOf(signals, category);
  const mine = m.features.map((f, i) => ({ f, w: m.weights[i] })).filter((e) => x.includes(e.f));
  // only leads that share something the model learned about get nudged
  if (!mine.length) return undefined;
  const points = Math.round(Math.max(-MAX_POINTS, Math.min(MAX_POINTS, 10 * (logitOf(m, x) - m.baseLogit))));
  if (Math.abs(points) < 3) return undefined;
  // the evidence: the strongest learned reason pulling the same way, whose plain reply rate agrees
  const statOf = (f: string) => (f.startsWith("s:") ? learned.signals[f.slice(2)] : learned.categories?.[f.slice(2)]);
  const best = mine
    .filter((e) => Math.sign(e.w) === Math.sign(points))
    .map((e) => ({ ...e, st: statOf(e.f) }))
    .filter((e) => e.st && (e.st.lift >= 1) === (points > 0))
    .sort((a, b) => Math.abs(b.w) - Math.abs(a.w))[0];
  if (!best?.st) return { key: "learned", label: `Your results: leads like this replied ${points > 0 ? "more" : "less"} often than your average`, points };
  const { st } = best;
  const who = best.f.startsWith("c:") ? `${st.key} leads` : `leads with ${words(st.key)}`;
  const label =
    points > 0
      ? `Your results: ${who} replied ${st.lift.toFixed(1)}× as often (${st.replied} of ${st.contacted})`
      : `Your results: ${who} replied less often than average (${st.replied} of ${st.contacted})`;
  return { key: "learned", label, points };
}

/** One line for the search log: what the scores learned, and how well that holds up. */
export function learnedSummary(learned?: Learned): string | undefined {
  if (!learned || !learned.contacted) return undefined;
  const pct = (x: number) => `${Math.round(x * 100)}%`;
  if (learned.contacted < MIN_CONTACTED) return `Scores will start learning from your replies after ${MIN_CONTACTED} messaged leads of this kind (${learned.contacted} so far).`;
  if (!learned.model) return `Scores will start learning once the leads you messaged show both replies and silence (${learned.replied} of ${learned.contacted} replied so far).`;
  const m = learned.model;
  const t = m.test;
  const head = `Scores learn from ${learned.contacted} leads you messaged before (${pct(learned.base)} replied)`;
  if (!t) return `${head}.`;
  const vs = t.scoreAuc != null ? ` (written scores alone: ${pct(t.scoreAuc)})` : "";
  return m.useful
    ? `${head}. Tested on your ${t.leads} newest: they put a lead that replied above one that didn't ${pct(t.auc)} of the time${vs}.`
    : `${head}, but on your ${t.leads} newest they couldn't yet tell who replies (${pct(t.auc)}, a coin flip is 50%), so scores stay as written.`;
}

/** Strong / worth a try / skip, at each offer's own thresholds. */
export function tierFor(offer: Offer, score: number): Tier {
  const [hot, warm] = offer === "website_development" ? [65, 40] : isNiche(offer) ? NICHES[offer].tiers : [60, 30];
  return score >= hot ? "hot" : score >= warm ? "warm" : "cold";
}

/** A scored lead with the nudge from your results added (unchanged when there's nothing to learn yet). */
export function withLearned<T extends { signals: Signal[]; score: number; tier: Tier }>(r: T, offer: Offer, learned?: Learned, category?: string): T {
  const extra = learnedSignal(r.signals, learned, category);
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

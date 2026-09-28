"use client";

import { CATEGORIES } from "@/lib/categories";
import type { CategoryStat } from "@/lib/followups";
import type { KeepOnly, SearchParams, SearchRecord } from "@/lib/types";
import { IconCheck, IconSettings } from "./icons";

export type Sources = SearchParams["sources"];
export interface FormState {
  cats: string[];
  city: string;
  area: string;
  perCategory: number;
  sources: Sources;
  pageSpeed: boolean;
  verifyWebsites: boolean;
  webSearch: boolean;
  apolloKey: string;
  keep: KeepOnly;
}
export const DEFAULT_KEEP: KeepOnly = { skipChains: true, needPhone: false, notContacted: true, goodRating: false };
export const DEFAULT_FORM: FormState = {
  cats: ["dentist", "salon", "cafe"],
  city: "",
  area: "",
  perCategory: 20,
  sources: { google: true, osm: true, apollo: false, instagram: true, facebook: false, web: true, gmaps: true },
  pageSpeed: false,
  verifyWebsites: true,
  webSearch: true,
  apolloKey: "",
  keep: DEFAULT_KEEP,
};

export type Config = {
  google: boolean;
  pageSpeedKey: boolean;
  apollo: boolean;
  store: "local" | "supabase";
  contact: boolean;
  meta: boolean;
  fbPageSearch: boolean;
  searchProviders: string[];
  gmapsScraper: boolean;
  searchUsage?: Array<{ id: string; label: string; exact: boolean; today: number; month: number; limit: { n: number; per: "day" | "month" } | null }>;
};

/** Why each type is worth a website pitch, in a few words. */
const HINT: Record<string, string> = {
  dentist: "Patients check before they book",
  skin: "Before-and-after photos sell",
  physio: "Patients compare nearby options",
  clinic: "Local trust matters",
  salon: "Book by appointment",
  gym: "Memberships and free trials",
  restaurant: "Menus and table booking",
  cafe: "Menus, photos, orders",
  coaching: "Parents search online",
  realestate: "Listings need a site",
  interior: "Their portfolio is everything",
  ca: "Clients check credentials",
  lawyer: "Clients check credentials",
  hotel: "Direct bookings save commission",
  furniture: "Big purchases, long browsing",
  retail: "Often Instagram-only",
};

const KEEP: Array<{ key: keyof KeepOnly; label: string; why: string }> = [
  { key: "notContacted", label: "Hide ones I've already messaged", why: "Checks all your searches by phone number and Google listing." },
  { key: "skipChains", label: "Skip big chains", why: "Their website is decided by head office." },
  { key: "needPhone", label: "Only businesses with a phone number", why: "So you can WhatsApp or call them." },
  { key: "goodRating", label: "Only 4★ and above", why: "Busy, well-rated businesses can pay. Unrated ones stay." },
];

/** Which sources can run right now, and a one-line reason when one can't. */
export function sourceInfo(config: Config | null) {
  return [
    { key: "google", label: "Google Maps", note: "Best coverage", ready: !!config?.google, why: "Needs a Google key" },
    { key: "osm", label: "OpenStreetMap", note: "Free", ready: true, why: "" },
    ...(config?.gmapsScraper ? [{ key: "gmaps", label: "Google Maps scraper", note: "Testing only", ready: true, why: "" }] : []),
    { key: "web", label: "Search engines", note: "Businesses with their own site", ready: true, why: "" },
    { key: "instagram", label: "Instagram", note: config?.meta ? "Followers & bio via Meta" : "Business profiles", ready: true, why: "" },
    { key: "facebook", label: "Facebook Pages", note: "Pages via web search", ready: true, why: "" },
    { key: "apollo", label: "Apollo", note: "Company size", ready: true, why: "" },
  ] as Array<{ key: keyof Sources; label: string; note: string; ready: boolean; why: string }>;
}

const low = (x?: string) => (x ?? "").trim().toLowerCase();
const ago = (iso: string) => {
  const d = Math.floor((Date.now() - Date.parse(iso)) / 86_400_000);
  return d < 1 ? "today" : d === 1 ? "yesterday" : `${d} days ago`;
};
const cap = (x: string) => x.replace(/\b\w/g, (c) => c.toUpperCase());

/** What your past searches say about a type: in this city if you've searched it here, else anywhere. */
export function statFor(stats: Record<string, CategoryStat> | undefined, city: string, label: string): { s: CategoryStat; here: boolean } | null {
  const here = stats?.[`${low(city)}|${label}`];
  if (here && here.total >= 3) return { s: here, here: true };
  const any = stats?.[`*|${label}`];
  return any && any.total >= 3 ? { s: any, here: false } : null;
}

/** "About 35 businesses, 12 worth messaging first", from your own past searches, or null if there's nothing to go on. */
export function estimate(stats: Record<string, CategoryStat> | undefined, city: string, cats: string[]): { total: number; hot: number; known: number } | null {
  let total = 0, hot = 0, known = 0;
  for (const k of cats) {
    const c = CATEGORIES.find((x) => x.key === k);
    const st = c && statFor(stats, city, c.label);
    if (!st) continue;
    known++;
    total += st.s.total / st.s.searches;
    hot += st.s.hot / st.s.searches;
  }
  return known ? { total: Math.round(total), hot: Math.round(hot), known } : null;
}

/** The same search (or a bigger one) run in the last 30 days. */
export function sameSearch(history: SearchRecord[], form: Pick<FormState, "city" | "area" | "cats">, now = Date.now()): SearchRecord | undefined {
  return history.find(
    (h) =>
      h.status !== "failed" &&
      h.status !== "running" &&
      low(h.params.city) === low(form.city) &&
      low(h.params.area) === low(form.area) &&
      form.cats.length > 0 &&
      form.cats.every((c) => h.params.categories.includes(c)) &&
      now - Date.parse(h.createdAt) < 30 * 86_400_000,
  );
}

export function SearchForm({
  form,
  setForm,
  config,
  running,
  onSubmit,
  onCancel,
  onOpenSetup,
  history,
  stats,
  onOpenSearch,
}: {
  form: FormState;
  setForm: (f: FormState) => void;
  config: Config | null;
  running: boolean;
  onSubmit: () => void;
  onCancel?: () => void;
  onOpenSetup: () => void;
  history: SearchRecord[];
  stats?: Record<string, CategoryStat>;
  onOpenSearch: (id: string) => void;
}) {
  const keep = { ...DEFAULT_KEEP, ...form.keep };
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm({ ...form, [k]: v });
  const setSource = (k: keyof Sources, v: boolean) => setForm({ ...form, sources: { ...form.sources, [k]: v } });
  const toggleCat = (k: string) => set("cats", form.cats.includes(k) ? form.cats.filter((x) => x !== k) : form.cats.length >= 8 ? form.cats : [...form.cats, k]);
  const sources = sourceInfo(config);
  const on = sources.filter((s) => s.ready && form.sources[s.key] && s.key !== "apollo");
  const canRun = !running && form.cats.length > 0 && form.city.trim().length > 0 && on.length > 0;

  const picked = form.cats.map((k) => CATEGORIES.find((c) => c.key === k)?.label ?? k);
  const where = form.area.trim() || form.city.trim();
  const headline = !picked.length ? "Pick a business type" : `${picked[0]}${picked.length > 1 ? ` and ${picked.length - 1} more` : ""}${where ? ` in ${cap(where)}` : ""}`;
  const est = estimate(stats, form.city, form.cats);
  const again = sameSearch(history, form);
  const filtersOn = KEEP.filter((k) => keep[k.key]).length;
  const places = [...new Map(history.map((h) => [`${low(h.params.area)}|${low(h.params.city)}`, h.params])).values()].slice(0, 4);
  const allowance = config?.searchUsage?.find((u) => u.limit && u.exact);
  const left = allowance?.limit ? allowance.limit.n - (allowance.limit.per === "day" ? allowance.today : allowance.month) : null;
  const block = !form.city.trim() ? "Enter a city to start." : !form.cats.length ? "Pick at least one business type." : !on.length ? "Turn on at least one source under More options." : "";

  return (
    <form
      className="sf"
      aria-label="New search"
      onSubmit={(e) => {
        e.preventDefault();
        if (canRun) onSubmit();
      }}
    >
      <div className="sf-main">
        <section className="step">
          <h2 className="step-title">Where should we look?</h2>
          <p className="step-hint">An area works best. Leave it empty to cover the whole city.</p>
          <div className="place">
            <label className="place-f">
              <span className="lbl">Area</span>
              <input id="area" type="text" value={form.area} onChange={(e) => set("area", e.target.value)} placeholder="e.g. Alkapuri" autoComplete="off" />
            </label>
            <label className="place-f">
              <span className="lbl">City</span>
              <input id="city" type="text" value={form.city} onChange={(e) => set("city", e.target.value)} placeholder="e.g. Vadodara" autoComplete="off" required />
            </label>
          </div>
          {places.length > 0 && (
            <div className="recent">
              <span className="sub">Recent:</span>
              {places.map((p) => (
                <button key={`${p.area}|${p.city}`} type="button" className="linkish" onClick={() => setForm({ ...form, city: p.city, area: p.area ?? "" })}>
                  {p.area ? `${p.area}, ${p.city}` : p.city}
                </button>
              ))}
            </div>
          )}
        </section>

        <section className="step">
          <h2 className="step-title">What kind of business?</h2>
          <p className="step-hint">Pick up to 8 ({form.cats.length} picked). Businesses that take bookings or walk-ins pitch best.</p>
          <div className="cats">
            {CATEGORIES.map((c) => {
              const onC = form.cats.includes(c.key);
              const st = statFor(stats, form.city, c.label);
              const good = st && st.s.total >= 5 && st.s.hot / st.s.total >= 0.4;
              return (
                <button key={c.key} type="button" className={`cat ${onC ? "on" : ""}`} aria-pressed={onC} onClick={() => toggleCat(c.key)} disabled={!onC && form.cats.length >= 8}>
                  <span className="box">{onC && <IconCheck />}</span>
                  <span className="cat-txt">
                    <b>{c.label}{good && <span className="tag good">Pitches well</span>}</b>
                    <span className="sub">{st ? `Last time${st.here ? "" : " (all cities)"}: ${st.s.noSite} of ${st.s.total} had no working site` : HINT[c.key]}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </section>

        <section className="step">
          <h2 className="step-title">Keep only the useful ones</h2>
          <p className="step-hint">These start as filters on your results. Nothing is thrown away: you can turn them off there.</p>
          <div className="switches">
            {KEEP.map((k) => (
              <label key={k.key} className="switch">
                <span>
                  <b>{k.label}</b>
                  <span className="sub">{k.why}</span>
                </span>
                <input type="checkbox" checked={keep[k.key]} onChange={(e) => set("keep", { ...keep, [k.key]: e.target.checked })} />
                <i className="track" aria-hidden="true" />
              </label>
            ))}
          </div>
        </section>

        <details className="more">
          <summary>More options: sources, website checks, how many</summary>
          <div className="toggles">
            {sources.map((s) => (
              <label key={s.key} className={`toggle ${s.ready ? "" : "off"} ${s.key === "gmaps" ? "testing" : ""}`} title={s.ready ? s.note : s.why}>
                <input type="checkbox" checked={s.ready && form.sources[s.key]} disabled={!s.ready} onChange={(e) => setSource(s.key, e.target.checked)} />
                <span>
                  <b>{s.label}</b>
                  <small>{s.ready ? s.note : s.why}</small>
                </span>
              </label>
            ))}
          </div>
          {sources.some((s) => !s.ready) || (config && !config.contact) ? (
            <button type="button" className="linkish" onClick={onOpenSetup}>
              <IconSettings /> Some sources need setting up
            </button>
          ) : null}
          <div className="more-grid">
            <label className="check">
              <input type="checkbox" checked={form.verifyWebsites} onChange={(e) => set("verifyWebsites", e.target.checked)} />
              <span><b>Look for websites the map missed</b><small>Try likely addresses and check the page really is theirs</small></span>
            </label>
            <label className={`check ${form.verifyWebsites ? "" : "off"}`}>
              <input type="checkbox" checked={form.verifyWebsites && form.webSearch} disabled={!form.verifyWebsites} onChange={(e) => set("webSearch", e.target.checked)} />
              <span><b>Use web search for that</b><small>{config?.searchProviders?.length ? `Through ${config.searchProviders.slice(0, 2).join(", then ")}` : "Finds more, takes longer"}</small></span>
            </label>
            <label className="check">
              <input type="checkbox" checked={form.pageSpeed} onChange={(e) => set("pageSpeed", e.target.checked)} />
              <span><b>Check mobile speed</b><small>{config?.pageSpeedKey ? "Adds a few minutes" : "Few checks work without a PageSpeed key"}</small></span>
            </label>
            <div className="field">
              <label className="lbl" htmlFor="per">Businesses per type</label>
              <select id="per" value={form.perCategory} onChange={(e) => set("perCategory", Number(e.target.value))}>
                {[10, 20, 40, 60].map((n) => <option key={n} value={n}>Up to {n}</option>)}
              </select>
            </div>
            {form.sources.apollo && !config?.apollo && (
              <div className="field">
                <label className="lbl" htmlFor="apollo-key">Your Apollo API key</label>
                <input id="apollo-key" type="password" value={form.apolloKey} onChange={(e) => set("apolloKey", e.target.value)} placeholder="Used for this search only, never saved" />
              </div>
            )}
          </div>
        </details>
      </div>

      <aside className="sf-sum" aria-live="polite">
        <span className="k">Your search</span>
        <b className="big">{headline}</b>
        <dl>
          <div><dt>Area</dt><dd>{form.city.trim() ? cap(form.area.trim() ? `${form.area.trim()}, ${form.city.trim()}` : `All of ${form.city.trim()}`) : "Not set"}</dd></div>
          <div><dt>Types</dt><dd>{picked.length ? `${picked.length} picked` : "None yet"}</dd></div>
          <div><dt>Filters on</dt><dd>{filtersOn}</dd></div>
          <div><dt>Looking through</dt><dd>{on.length ? on.map((s) => s.label).join(", ") : "Nothing"}</dd></div>
        </dl>
        <div className="est">
          {block ? (
            block
          ) : est ? (
            <>From your past searches: about <b>{est.total} businesses</b>, <b>{est.hot}</b> worth messaging first{est.known < form.cats.length ? ` (for ${est.known} of ${form.cats.length} types)` : ""}.</>
          ) : (
            <>First search for these types. Leads show up as they're found; you can start messaging before it finishes.</>
          )}
          {left != null && <span className="est-line">{allowance!.label}: {left.toLocaleString("en-IN")} free searches left{allowance!.limit!.per === "day" ? " today" : " this month"}.</span>}
        </div>
        {again && (
          <div className="again">
            You ran this search {ago(again.createdAt)} ({again.counts.afterDedupe} leads).{" "}
            <button type="button" className="linkish" onClick={() => onOpenSearch(again.id)}>Open it</button>
          </div>
        )}
        <button type="submit" className="go" disabled={!canRun}>
          {running ? <><span className="spin" /> Finding leads…</> : "Find leads"}
        </button>
        {onCancel && <button type="button" className="linkish cancel" onClick={onCancel}>Cancel</button>}
        <p className="fine">{config?.store === "supabase" ? "Saved to your Supabase database." : "Saved on this computer."}</p>
      </aside>
    </form>
  );
}

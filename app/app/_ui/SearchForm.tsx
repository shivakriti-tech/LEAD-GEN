"use client";

import { CATEGORIES } from "@/lib/categories";
import type { SearchParams } from "@/lib/types";
import { IconSettings } from "./icons";

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
}
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

const groups = [...new Set(CATEGORIES.map((c) => c.group))];

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

export function SearchForm({
  form,
  setForm,
  config,
  running,
  onSubmit,
  onCancel,
  onOpenSetup,
}: {
  form: FormState;
  setForm: (f: FormState) => void;
  config: Config | null;
  running: boolean;
  onSubmit: () => void;
  onCancel?: () => void;
  onOpenSetup: () => void;
}) {
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm({ ...form, [k]: v });
  const setSource = (k: keyof Sources, v: boolean) => setForm({ ...form, sources: { ...form.sources, [k]: v } });
  const toggleCat = (k: string) => set("cats", form.cats.includes(k) ? form.cats.filter((x) => x !== k) : form.cats.length >= 8 ? form.cats : [...form.cats, k]);
  const sources = sourceInfo(config);
  const anySource = sources.some((s) => s.ready && form.sources[s.key] && s.key !== "apollo");
  const canRun = !running && form.cats.length > 0 && form.city.trim().length > 0 && anySource;

  return (
    <form
      className="panel stack search-form"
      aria-label="New search"
      onSubmit={(e) => {
        e.preventDefault();
        if (canRun) onSubmit();
      }}
    >
      <div className="grid-form">
        <div className="field">
          <label className="lbl" htmlFor="city">City</label>
          <input id="city" type="text" value={form.city} onChange={(e) => set("city", e.target.value)} placeholder="e.g. Vadodara" autoComplete="off" required />
        </div>
        <div className="field">
          <label className="lbl" htmlFor="area">Area <span className="opt">optional</span></label>
          <input id="area" type="text" value={form.area} onChange={(e) => set("area", e.target.value)} placeholder="e.g. Alkapuri" autoComplete="off" />
        </div>
        <div className="field">
          <label className="lbl" htmlFor="sells">You sell</label>
          <select id="sells" defaultValue="website_development">
            <option value="website_development">Website development</option>
            <option disabled>More services coming</option>
          </select>
        </div>
      </div>

      <fieldset className="fs">
        <legend className="lbl">Business types <span className="opt">{form.cats.length}/8 picked</span></legend>
        <div className="cat-groups">
          {groups.map((g) => (
            <div className="chip-group" key={g}>
              <span className="sub">{g}</span>
              <div className="chips">
                {CATEGORIES.filter((c) => c.group === g).map((c) => (
                  <button type="button" key={c.key} className="chip" aria-pressed={form.cats.includes(c.key)} onClick={() => toggleCat(c.key)}>
                    {c.label}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </fieldset>

      <fieldset className="fs">
        <legend className="lbl">Where to look</legend>
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
      </fieldset>

      <details className="more">
        <summary>More options</summary>
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

      <div className="form-foot">
        <span className="sub">
          {!form.city.trim() ? "Enter a city to start." : !form.cats.length ? "Pick at least one business type." : !anySource ? "Turn on at least one source." : `${form.cats.length} business type${form.cats.length > 1 ? "s" : ""} in ${form.area ? `${form.area}, ` : ""}${form.city}, up to ${form.perCategory} each per source.`}
        </span>
        <div className="row">
          {onCancel && <button type="button" className="btn" onClick={onCancel}>Cancel</button>}
          <button type="submit" className="btn primary" disabled={!canRun}>
            {running ? <><span className="spin" /> Finding leads…</> : "Find leads"}
          </button>
        </div>
      </div>
    </form>
  );
}

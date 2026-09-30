"use client";

import { Fragment } from "react";

import { CATEGORIES, categoriesFor } from "@/lib/categories";
import type { CategoryStat } from "@/lib/followups";
import { DEFAULT_SERVICES, SERVICE_CHIP, SERVICE_ORDER } from "@/lib/score/logistics";
import { AGENCY_CHIP, ALL_AGENCY } from "@/lib/score/agency";
import { MARKETS, marketOf, type CountryCode } from "@/lib/markets";
import type { AgencyService, KeepOnly, LogisticsService, Offer, SearchParams, SearchRecord } from "@/lib/types";
import { IconCheck, IconSettings } from "./icons";

export type Sources = SearchParams["sources"];
export interface FormState {
  cats: string[];
  city: string;
  area: string;
  perCategory: number;
  sources: Sources;
  pageSpeed: boolean;
  /** Search everything live instead of starting from saved businesses. */
  fresh?: boolean;
  verifyWebsites: boolean;
  webSearch: boolean;
  apolloKey: string;
  keep: KeepOnly;
  /** What you're finding leads for: your website service, or a logistics client. */
  sells: Offer;
  client: { name: string; services: LogisticsService[] };
  /** The client (Business Brain) this search is for, if picked. */
  clientId?: string;
  /** Country to search in. */
  country?: CountryCode;
  /** Your agency's services (agency searches). */
  agency?: AgencyService[];
}
export const DEFAULT_CATS: Record<Offer, string[]> = { website_development: ["dentist", "salon", "cafe"], logistics: ["manufacturer", "exporter", "wholesaler"], agency: ["store_fashion", "store_beauty", "co_freight", "co_trucking"] };
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
  sells: "website_development",
  client: { name: "", services: DEFAULT_SERVICES },
  country: "IN",
  agency: ALL_AGENCY,
};

/** Countries in the picker, by region. */
const REGIONS = [...new Set(Object.values(MARKETS).map((m) => m.group))].map((g) => ({ g, list: Object.values(MARKETS).filter((m) => m.group === g) }));

export type Config = {
  google: boolean;
  pageSpeedKey: boolean;
  apollo: boolean;
  emailVerify?: string | null;
  /** "Gemini" / "Claude" when an AI reads client websites. */
  ai?: string | null;
  /** WhatsApp Business API set up (token + phone number id). */
  whatsapp?: boolean;
  /** Sending mailboxes set up (MAILBOX_n). */
  mailboxes?: number;
  store: "local" | "supabase";
  contact: boolean;
  meta: boolean;
  fbPageSearch: boolean;
  searchProviders: string[];
  gmapsScraper: boolean;
  searchUsage?: Array<{ id: string; label: string; exact: boolean; today: number; month: number; limit: { n: number; per: "day" | "month" } | null }>;
  directory?: { sets: number; businesses: number; areas: number; lastSaved?: string } | null;
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
  manufacturer: "Goods go out every week",
  textile: "Bulk orders across India",
  chemical: "Regular loads, often exported",
  pharma: "Time-bound, tracked shipments",
  engineering: "Heavy parts, truck loads",
  food_proc: "Exports and cold routes",
  exporter: "Forwarding and customs, every month",
  importer: "Customs clearance and inland transport",
  wholesaler: "Moves stock to shops daily",
  distributor: "Warehousing and deliveries",
  online_seller: "Parcels every day",
  furniture_mfr: "Big items, trucks and packing",
  store_fashion: "Often marketplace-only or on a stock theme",
  store_beauty: "Repeat buyers: flows and subscriptions",
  store_home: "Big baskets, long browsing",
  store_jewelry: "High value: the store must look premium",
  store_health: "Subscriptions and reorders",
  store_pet: "Reorders every month",
  store_sports: "Seasonal ranges, lots of products",
  store_food: "Gift boxes and subscriptions",
  store_online: "Brands found through web search",
  co_freight: "Quotes, tracking and paperwork by email",
  co_trucking: "Dispatch and loads on spreadsheets",
  co_3pl: "Client portals and stock reports",
  co_mining: "Sites, fleets and compliance records",
  co_oilgas: "Field crews, jobs and invoices",
  co_energy: "Leads, site surveys and installs",
  co_agri: "Contracts, lots and shipments",
  co_manufacturing: "Orders, stock and production",
  co_construction: "Bids, projects and subcontractors",
  co_wholesale: "Dealer orders and price lists",
  co_equipment: "Rentals, service and parts",
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
  clients,
  onPickClient,
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
  /** Saved client profiles (Business Brains): picking one fills in their offer, services and business types. */
  clients?: Array<{ id: string; name: string }>;
  onPickClient?: (id: string | null) => void;
}) {
  const keep = { ...DEFAULT_KEEP, ...form.keep };
  const sells: Offer = form.sells ?? "website_development";
  const client = form.client ?? DEFAULT_FORM.client;
  const country: CountryCode = form.country ?? "IN";
  const market = marketOf(country);
  const agency = form.agency ?? ALL_AGENCY;
  // your agency's leads are international: switching to it leaves India for the US
  const setOffer = (o: Offer) => o !== sells && setForm({ ...form, sells: o, cats: DEFAULT_CATS[o], client, clientId: undefined, country: o === "agency" && country === "IN" ? "US" : country, city: o === "agency" && country === "IN" ? "" : form.city, area: o === "agency" && country === "IN" ? "" : form.area });
  const setCountry = (c: CountryCode) => c !== country && setForm({ ...form, country: c, city: "", area: "" });
  const toggleAgency = (x: AgencyService) => setForm({ ...form, agency: agency.includes(x) ? agency.filter((y) => y !== x) : [...agency, x] });
  const toggleService = (x: LogisticsService) => setForm({ ...form, client: { ...client, services: client.services.includes(x) ? client.services.filter((y) => y !== x) : [...client.services, x] } });
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm({ ...form, [k]: v });
  const setSource = (k: keyof Sources, v: boolean) => setForm({ ...form, sources: { ...form.sources, [k]: v } });
  const toggleCat = (k: string) => set("cats", form.cats.includes(k) ? form.cats.filter((x) => x !== k) : form.cats.length >= 8 ? form.cats : [...form.cats, k]);
  const sources = sourceInfo(config);
  const on = sources.filter((s) => s.ready && form.sources[s.key] && s.key !== "apollo");
  const canRun = !running && form.cats.length > 0 && form.city.trim().length > 0 && on.length > 0 && (sells !== "logistics" || client.services.length > 0) && (sells !== "agency" || agency.length > 0);

  const picked = form.cats.map((k) => CATEGORIES.find((c) => c.key === k)?.label ?? k);
  const where = form.area.trim() || form.city.trim();
  const headline = !picked.length ? "Pick a business type" : `${picked[0]}${picked.length > 1 ? ` and ${picked.length - 1} more` : ""}${where ? ` in ${cap(where)}` : ""}`;
  const est = estimate(stats, form.city, form.cats);
  const again = sameSearch(history, form);
  const filtersOn = KEEP.filter((k) => keep[k.key]).length;
  const places = [...new Map(history.map((h) => [`${low(h.params.area)}|${low(h.params.city)}|${h.params.country ?? "IN"}`, h.params])).values()].slice(0, 4);
  const allowance = config?.searchUsage?.find((u) => u.limit && u.exact);
  const left = allowance?.limit ? allowance.limit.n - (allowance.limit.per === "day" ? allowance.today : allowance.month) : null;
  const block = sells === "logistics" && !client.services.length ? "Pick at least one service your client offers." : sells === "agency" && !agency.length ? "Pick at least one service you sell." : !form.city.trim() ? "Enter a city to start." : !form.cats.length ? "Pick at least one business type." : !on.length ? "Turn on at least one source under More options." : "";

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
          <h2 className="step-title">Who are the leads for?</h2>
          {!!clients?.length && onPickClient && (
            <label className="field client-pick">
              <span className="lbl">Client profile <span className="opt">fills in their services, business types and message rules</span></span>
              <select value={form.clientId ?? ""} onChange={(e) => onPickClient(e.target.value || null)}>
                <option value="">No client profile</option>
                {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </label>
          )}
          <div className="offers" role="radiogroup" aria-label="Who are the leads for">
            <button type="button" role="radio" aria-checked={sells === "website_development"} className={`offer ${sells === "website_development" ? "on" : ""}`} onClick={() => setOffer("website_development")}>
              <b>Website clients</b>
              <span className="sub">Businesses with a missing or weak website, for your web design service.</span>
            </button>
            <button type="button" role="radio" aria-checked={sells === "logistics"} className={`offer ${sells === "logistics" ? "on" : ""}`} onClick={() => setOffer("logistics")}>
              <b>A logistics client</b>
              <span className="sub">Businesses that ship goods: factories, exporters, traders and online sellers.</span>
            </button>
            <button type="button" role="radio" aria-checked={sells === "agency"} className={`offer ${sells === "agency" ? "on" : ""}`} onClick={() => setOffer("agency")}>
              <b>My agency's services</b>
              <span className="sub">Online stores and mid-size companies abroad that need a store, website, CRM / ERP or automation.</span>
            </button>
          </div>
          {sells === "agency" && (
            <div className="client-box">
              <div className="field">
                <span className="lbl">What you build <span className="opt">leads are matched to these</span></span>
                <div className="chips">
                  {ALL_AGENCY.map((x) => (
                    <button key={x} type="button" className="chip" aria-pressed={agency.includes(x)} onClick={() => toggleAgency(x)}>
                      {agency.includes(x) && <IconCheck />} {AGENCY_CHIP[x]}
                    </button>
                  ))}
                </div>
              </div>
              {!form.clientId && <p className="sub">Tip: add your agency under Clients (with your case studies in Proof) and pick it above: messages then quote your work.</p>}
            </div>
          )}
          {sells === "logistics" && (
            <div className="client-box">
              <label className="field">
                <span className="lbl">Your client's company <span className="opt">optional, shown in messages and the report</span></span>
                <input type="text" value={client.name} onChange={(e) => set("client", { ...client, name: e.target.value })} placeholder="e.g. Shree Logistics" />
              </label>
              <div className="field">
                <span className="lbl">Services they offer</span>
                <div className="chips">
                  {SERVICE_ORDER.map((x) => (
                    <button key={x} type="button" className="chip" aria-pressed={client.services.includes(x)} onClick={() => toggleService(x)}>
                      {client.services.includes(x) && <IconCheck />} {SERVICE_CHIP[x]}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </section>

        <section className="step">
          <h2 className="step-title">Where should we look?</h2>
          <p className="step-hint">An area works best. Leave it empty to cover the whole city.</p>
          <div className="place">
            <label className="place-f">
              <span className="lbl">Country</span>
              <select id="country" value={country} onChange={(e) => setCountry(e.target.value as CountryCode)}>
                {REGIONS.map(({ g, list }) => (
                  <optgroup key={g} label={g}>
                    {list.map((m) => <option key={m.code} value={m.code}>{m.name}</option>)}
                  </optgroup>
                ))}
              </select>
            </label>
            <label className="place-f">
              <span className="lbl">Area</span>
              <input id="area" type="text" value={form.area} onChange={(e) => set("area", e.target.value)} placeholder={country === "IN" ? "e.g. Alkapuri" : "optional"} autoComplete="off" />
            </label>
            <label className="place-f">
              <span className="lbl">City</span>
              <input id="city" type="text" list="city-list" value={form.city} onChange={(e) => set("city", e.target.value)} placeholder={`e.g. ${market.cities[0]}`} autoComplete="off" required />
              <datalist id="city-list">{market.cities.map((c) => <option key={c} value={c} />)}</datalist>
            </label>
          </div>
          {places.length > 0 && (
            <div className="recent">
              <span className="sub">Recent:</span>
              {places.map((p) => (
                <button key={`${p.area}|${p.city}`} type="button" className="linkish" onClick={() => setForm({ ...form, city: p.city, area: p.area ?? "", country: p.country ?? "IN" })}>
                  {p.area ? `${p.area}, ${p.city}` : p.city}
                </button>
              ))}
            </div>
          )}
        </section>

        <section className="step">
          <h2 className="step-title">What kind of business?</h2>
          <p className="step-hint">Pick up to 8 ({form.cats.length} picked). {sells === "logistics" ? "Factories and exporters ship the most." : sells === "agency" ? "Online stores need a store or an upgrade; companies need systems: a CRM / ERP, portals and automation." : "Businesses that take bookings or walk-ins pitch best."}</p>
          <div className="cats">
            {categoriesFor(sells).map((c, i, all) => {
              const onC = form.cats.includes(c.key);
              const st = statFor(stats, form.city, c.label);
              const good = st && st.s.total >= 5 && st.s.hot / st.s.total >= 0.4;
              const head = sells === "agency" && all[i - 1]?.group !== c.group ? <h3 className="cat-group" key={`g-${c.group}`}>{c.group}</h3> : null;
              return (
                <Fragment key={c.key}>
                {head}
                <button type="button" className={`cat ${onC ? "on" : ""}`} aria-pressed={onC} onClick={() => toggleCat(c.key)} disabled={!onC && form.cats.length >= 8}>
                  <span className="box">{onC && <IconCheck />}</span>
                  <span className="cat-txt">
                    <b>{c.label}{good && <span className="tag good">Pitches well</span>}</b>
                    <span className="sub">{st ? `Last time${st.here ? "" : " (all cities)"}: ${sells !== "website_development" ? `${st.s.hot} of ${st.s.total} were strong leads` : `${st.s.noSite} of ${st.s.total} had no working site`}` : HINT[c.key]}</span>
                  </span>
                </button>
                </Fragment>
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
              <input type="checkbox" checked={!form.fresh} onChange={(e) => set("fresh", !e.target.checked)} />
              <span><b>Reuse businesses checked recently</b><small>Starts from what's already been checked here; old ones are rechecked and new ones added</small></span>
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
          <div><dt>For</dt><dd>{form.clientId && client.name.trim() ? client.name.trim() : sells === "logistics" ? client.name.trim() || "Logistics client" : sells === "agency" ? "Your agency" : "Your website service"}</dd></div>
          <div><dt>Area</dt><dd>{form.city.trim() ? `${cap(form.area.trim() ? `${form.area.trim()}, ${form.city.trim()}` : `All of ${form.city.trim()}`)}${country !== "IN" ? `, ${market.name}` : ""}` : "Not set"}</dd></div>
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

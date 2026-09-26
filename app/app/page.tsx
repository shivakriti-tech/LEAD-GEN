"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CATEGORIES } from "@/lib/categories";
import type { Lead, ProgressEvent, SearchRecord, Tier } from "@/lib/types";
import { EMAIL_KIND_LABEL } from "@/lib/enrich/email";

type Config = { google: boolean; pageSpeedKey: boolean; apollo: boolean; store: "local" | "supabase"; contact: boolean; brave: boolean; meta: boolean; fbPageSearch: boolean; searchProviders: string[]; gmapsScraper: boolean; searchUsage?: Array<{ id: string; label: string; exact: boolean; today: number; month: number; limit: { n: number; per: "day" | "month" } | null }> };
type LogLine = { level: "info" | "warn" | "error"; message: string };

const STAGE_LABEL: Record<string, string> = {
  search: "Searching maps",
  dedupe: "Removing duplicates",
  verify: "Looking for websites the map missed",
  enrich: "Checking websites",
  social: "Reading Instagram profiles",
  speed: "Checking mobile speed",
  score: "Scoring",
  save: "Saving",
};

const groups = [...new Set(CATEGORIES.map((c) => c.group))];

export default function LeadFinder() {
  const [config, setConfig] = useState<Config | null>(null);
  const [cats, setCats] = useState<string[]>(["dentist", "salon", "cafe"]);
  const [city, setCity] = useState("Pune");
  const [area, setArea] = useState("");
  const [perCategory, setPerCategory] = useState(20);
  const [useGoogle, setUseGoogle] = useState(true);
  const [useOsm, setUseOsm] = useState(true);
  const [useApollo, setUseApollo] = useState(false);
  const [useInstagram, setUseInstagram] = useState(true);
  const [useFacebook, setUseFacebook] = useState(false);
  const [useWeb, setUseWeb] = useState(true);
  const [useGmaps, setUseGmaps] = useState(true);
  const [apolloKey, setApolloKey] = useState("");
  const [pageSpeed, setPageSpeed] = useState(false);
  const [verifyWebsites, setVerifyWebsites] = useState(true);
  const [webSearch, setWebSearch] = useState(true);

  const [running, setRunning] = useState(false);
  const [stage, setStage] = useState<{ stage: string; done: number; total: number } | null>(null);
  const [log, setLog] = useState<LogLine[]>([]);
  const [search, setSearch] = useState<SearchRecord | null>(null);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [history, setHistory] = useState<SearchRecord[]>([]);
  const [error, setError] = useState("");

  const [tier, setTier] = useState<Tier | "all">("all");
  const [onlyNoSite, setOnlyNoSite] = useState(false);
  const [needPhone, setNeedPhone] = useState(false);
  const [needEmail, setNeedEmail] = useState(false);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/api/config")
      .then((r) => r.json())
      .then((c: Config) => {
        setConfig(c);
        if (c.pageSpeedKey) setPageSpeed(true); // key is set: use it by default
      })
      .catch(() => {});
    loadHistory();
  }, []);
  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [log]);

  function loadHistory() {
    fetch("/api/searches").then((r) => r.json()).then((d) => setHistory(d.searches ?? [])).catch(() => {});
  }

  async function openSearch(id: string) {
    const r = await fetch(`/api/searches/${id}`);
    if (!r.ok) return;
    const d = await r.json();
    setSearch(d.search);
    setLeads(d.leads);
    setLog([]);
    setStage(null);
    setOpen(null);
  }

  async function run() {
    setError("");
    setRunning(true);
    setLog([]);
    setLeads([]);
    setSearch(null);
    setOpen(null);
    try {
      const res = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          categories: cats,
          city,
          area: area || undefined,
          perCategory,
          sources: { google: useGoogle, osm: useOsm, apollo: useApollo, instagram: useInstagram, facebook: useFacebook, web: useWeb, gmaps: useGmaps && !!config?.gmapsScraper },
          pageSpeed,
          verifyWebsites,
          webSearch: verifyWebsites && webSearch,
          apolloKey: useApollo && !config?.apollo ? apolloKey : undefined,
        }),
      });
      if (!res.ok || !res.body) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || `Search failed (${res.status})`);
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      let finished = false;
      let lastError = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let nl;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl);
          buf = buf.slice(nl + 1);
          if (!line.trim()) continue;
          const ev = JSON.parse(line) as ProgressEvent;
          if (ev.type === "log") {
            setLog((l) => [...l, { level: ev.level, message: ev.message }]);
            if (ev.level === "error") lastError = ev.message;
          }
          else if (ev.type === "stage") setStage({ stage: ev.stage, done: ev.done, total: ev.total });
          // every business as soon as the map search is done, then each one as it finishes checking
          else if (ev.type === "leads") setLeads(ev.leads);
          else if (ev.type === "lead") setLeads((ls) => ls.map((x) => (x.id === ev.lead.id ? ev.lead : x)));
          else if (ev.type === "done") {
            finished = true;
            setSearch(ev.search);
            setLeads(ev.leads);
            if (ev.search.status === "failed") setError(ev.search.error || "Search failed");
          }
        }
      }
      if (!finished) throw new Error(lastError || "The search stopped before it finished.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Search failed");
    } finally {
      setRunning(false);
      loadHistory();
    }
  }

  const shown = useMemo(() => {
    const qq = q.trim().toLowerCase();
    return leads.filter(
      (l) =>
        (tier === "all" || (!l.pending && l.tier === tier)) &&
        (!onlyNoSite || l.audit?.status === "none" || l.audit?.status === "social_only" || l.audit?.status === "down") &&
        (!needPhone || l.phone || l.phones.length) &&
        (!needEmail || l.email || l.emails.length) &&
        (!qq || `${l.name} ${l.category} ${l.address ?? ""}`.toLowerCase().includes(qq)),
    ).sort((a, b) => Number(!!a.pending) - Number(!!b.pending) || b.score - a.score); // checked first, best first
  }, [leads, tier, onlyNoSite, needPhone, needEmail, q]);
  const checking = leads.filter((l) => l.pending).length;
  const tierCount = (t: Tier) => leads.filter((l) => !l.pending && l.tier === t).length;

  // A search opened from the list that's still running (e.g. the tab was closed): refresh it until it's done.
  useEffect(() => {
    if (running || !search || search.status !== "running") return;
    const t = setInterval(async () => {
      const r = await fetch(`/api/searches/${search.id}`).catch(() => null);
      if (!r?.ok) return;
      const d = await r.json();
      setLeads(d.leads);
      if (d.search.status !== "running") setSearch(d.search);
    }, 5000);
    return () => clearInterval(t);
  }, [running, search]);

  const toggleCat = (k: string) => setCats((c) => (c.includes(k) ? c.filter((x) => x !== k) : c.length >= 8 ? c : [...c, k]));
  const googleReady = !!config?.google;
  const pct = stage && stage.total ? Math.round((stage.done / stage.total) * 100) : 0;

  return (
    <div className="shell">
      <aside className="side">
        <div className="brand">
          <b>Lead Autopilot</b>
          <small>working name</small>
        </div>
        <nav className="nav" aria-label="Modules">
          <a href="/" aria-current="page">Lead Finder</a>
          <span>Business Brain <em>soon</em></span>
          <span>Outreach <em>soon</em></span>
          <span>Conversations <em>soon</em></span>
          <span>Handed to you <em>soon</em></span>
          <span>Credits <em>soon</em></span>
        </nav>
        <div className="history-wrap">
          <div className="lbl" style={{ color: "#B3C7C3", padding: "0 10px 6px" }}>Recent searches</div>
          <div className="history">
            {history.length === 0 && <span className="sub" style={{ color: "#B3C7C3", padding: "0 10px" }}>None yet</span>}
            {history.slice(0, 8).map((h) => (
              <button key={h.id} onClick={() => openSearch(h.id)}>
                <span>{h.params.area ? `${h.params.area}, ` : ""}{h.params.city}</span>
                <span style={{ fontSize: 12, opacity: 0.75 }}>
                  {h.status === "done" ? `${h.counts.hot} hot · ${h.counts.afterDedupe} leads` : h.status} · {new Date(h.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
                </span>
              </button>
            ))}
          </div>
        </div>
        <div className="side-foot">
          <div><span className={`dot ${googleReady ? "on" : ""}`} />Google Places {googleReady ? "connected" : "no key"}</div>
          <div><span className="dot on" />OpenStreetMap free</div>
          <div><span className={`dot ${config?.pageSpeedKey ? "on" : ""}`} />PageSpeed {config?.pageSpeedKey ? "key set" : "no key"}</div>
          <div><span className={`dot ${config?.meta ? "on" : ""}`} />Instagram API {config?.meta ? "connected" : "not set"}</div>
          <div><span className={`dot ${config?.store === "supabase" ? "on" : ""}`} />{config?.store === "supabase" ? "Saving to Supabase" : "Saving locally"}</div>
          {config?.searchUsage?.filter((u) => u.limit).map((u) => {
            const used = u.limit!.per === "day" ? u.today : u.month;
            return <div key={u.id} title="Free allowance; the app stops using it at the limit"><span className={`dot ${used < u.limit!.n ? "on" : ""}`} />{u.label} {used}/{u.limit!.n} {u.limit!.per === "day" ? "today" : "this month"}</div>;
          })}
        </div>
      </aside>

      <main>
        <div className="top">
          <div>
            <h1>Find leads</h1>
            <p>Local businesses that need a new or better website, with contacts, a website check and the reason to pitch them now.</p>
          </div>
        </div>

        <section className="panel stack" aria-label="Search">
          <div className="grid-form">
            <div className="field">
              <label className="lbl" htmlFor="sells">You sell</label>
              <select id="sells" defaultValue="website_development">
                <option value="website_development">Website development</option>
                <option disabled>More niches coming</option>
              </select>
            </div>
            <div className="field">
              <label className="lbl" htmlFor="city">City</label>
              <input id="city" type="text" value={city} onChange={(e) => setCity(e.target.value)} placeholder="e.g. Pune" />
            </div>
            <div className="field">
              <label className="lbl" htmlFor="area">Area (optional)</label>
              <input id="area" type="text" value={area} onChange={(e) => setArea(e.target.value)} placeholder="e.g. Kothrud" />
            </div>
          </div>

          <div className="stack" style={{ gap: 10 }}>
            <div className="lbl">Business types to target · up to 8</div>
            {groups.map((g) => (
              <div className="chip-group" key={g}>
                <span className="sub">{g}</span>
                <div className="chips">
                  {CATEGORIES.filter((c) => c.group === g).map((c) => (
                    <button key={c.key} className="chip" aria-pressed={cats.includes(c.key)} onClick={() => toggleCat(c.key)}>
                      {c.label}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <div className="stack" style={{ gap: 8 }}>
            <div className="lbl">Where to look</div>
            <div className="srcs">
              <label className={`src ${googleReady ? "" : "disabled"}`}>
                <input id="src-google" type="checkbox" checked={useGoogle && googleReady} disabled={!googleReady} onChange={(e) => setUseGoogle(e.target.checked)} />
                <span><b>Google Maps</b><div className="sub">{googleReady ? "Best coverage. 1,000 free requests a month, about 20 businesses each." : "Add GOOGLE_PLACES_API_KEY to .env.local to turn this on."}</div></span>
              </label>
              <label className="src">
                <input id="src-osm" type="checkbox" checked={useOsm} onChange={(e) => setUseOsm(e.target.checked)} />
                <span><b>OpenStreetMap</b><div className="sub">Free, no key. Fewer businesses in Indian cities.</div>{config && !config.contact && <div className="sub" style={{ color: "var(--warn)", marginTop: 4 }}>Set CRAWLER_CONTACT in .env.local to your email, or OpenStreetMap may block searches.</div>}</span>
              </label>
              {config?.gmapsScraper && (
                <label className="src" style={{ borderStyle: "dashed" }}>
                  <input id="src-gmaps" type="checkbox" checked={useGmaps} onChange={(e) => setUseGmaps(e.target.checked)} />
                  <span><b>Google Maps (scraper)</b> <span className="tag warn">Testing only</span><div className="sub">Runs on your computer. Many more businesses, but against Google&rsquo;s terms and can get your connection blocked. Switched off automatically in the live app.</div></span>
                </label>
              )}
              <label className="src">
                <input id="src-web" type="checkbox" checked={useWeb} onChange={(e) => setUseWeb(e.target.checked)} />
                <span><b>Search engines</b><div className="sub">Local businesses with their own website, found through {config?.searchProviders?.[0] ?? "web search"}. Skips directories, national stores and chains.</div></span>
              </label>
              <label className="src">
                <input id="src-instagram" type="checkbox" checked={useInstagram} onChange={(e) => setUseInstagram(e.target.checked)} />
                <span><b>Instagram</b><div className="sub">Finds business profiles through web search. {config?.meta ? "Your Meta token is set: followers, last post and bio website are read through Meta's official API." : "Add a Meta token to read followers, last post and bio website (official API)."}</div></span>
              </label>
              <label className="src">
                <input id="src-facebook" type="checkbox" checked={useFacebook} onChange={(e) => setUseFacebook(e.target.checked)} />
                <span><b>Facebook Pages</b><div className="sub">{config?.fbPageSearch ? "Official Page search is on (address, phone, website)." : "Finds Pages through web search. Official Page search turns on after Meta approves your app."}</div></span>
              </label>
              <label className="src">
                <input id="src-apollo" type="checkbox" checked={useApollo} onChange={(e) => setUseApollo(e.target.checked)} />
                <span><b>Apollo (your key)</b><div className="sub">Company size and LinkedIn page for businesses with a website.</div></span>
              </label>
              <label className="src">
                <input id="opt-verify" type="checkbox" checked={verifyWebsites} onChange={(e) => setVerifyWebsites(e.target.checked)} />
                <span><b>Find missing websites</b><div className="sub">Map data often misses websites. Before saying &ldquo;no website&rdquo;, try likely web addresses and check the page really belongs to the business.</div></span>
              </label>
              <label className={`src ${verifyWebsites ? "" : "disabled"}`}>
                <input id="opt-websearch" type="checkbox" checked={verifyWebsites && webSearch} disabled={!verifyWebsites} onChange={(e) => setWebSearch(e.target.checked)} />
                <span><b>Web search</b><div className="sub">{config && config.searchProviders.length > 1 ? `Using ${config.searchProviders.join(", then ")}.` : "Only DuckDuckGo is set up: slow and may get blocked. Set up SearXNG or a free Tavily key (see README)."}</div></span>
              </label>
              <label className="src">
                <input id="opt-speed" type="checkbox" checked={pageSpeed} onChange={(e) => setPageSpeed(e.target.checked)} />
                <span><b>Check mobile speed</b><div className="sub">{config?.pageSpeedKey ? "Your PageSpeed key is set. " : "No PageSpeed key: only a few checks will work. "}Adds a few minutes.</div></span>
              </label>
            </div>
            {useApollo && !config?.apollo && (
              <div className="field" style={{ maxWidth: 420 }}>
                <label className="lbl" htmlFor="apollo-key">Your Apollo API key</label>
                <input id="apollo-key" type="password" value={apolloKey} onChange={(e) => setApolloKey(e.target.value)} placeholder="Used for this search only, never saved" />
              </div>
            )}
          </div>

          <div className="row" style={{ justifyContent: "space-between" }}>
            <div className="row">
              <label className="lbl" htmlFor="per">Per business type</label>
              <select id="per" value={perCategory} onChange={(e) => setPerCategory(Number(e.target.value))} style={{ width: "auto" }}>
                {[10, 20, 40, 60].map((n) => <option key={n} value={n}>up to {n}</option>)}
              </select>
            </div>
            <button className="btn primary" onClick={run} disabled={running || !cats.length || !city.trim() || (!useOsm && !(useGoogle && googleReady))}>
              {running ? <><span className="spin" /> Finding leads…</> : "Find leads"}
            </button>
          </div>
          {error && <div className="tag bad" role="alert" style={{ whiteSpace: "normal", padding: "8px 12px", borderRadius: 10 }}>{error}</div>}
        </section>

        {(running || log.length > 0) && (
          <section className="panel stack" aria-live="polite">
            <div className="row" style={{ justifyContent: "space-between" }}>
              <b>{stage ? STAGE_LABEL[stage.stage] : "Starting"}</b>
              <span className="sub mono">{stage ? `${stage.done}/${stage.total}` : ""}</span>
            </div>
            <div className="progress"><i style={{ width: `${running ? pct : 100}%` }} /></div>
            <div className="log" ref={logRef}>
              {log.map((l, i) => <div key={i} className={l.level}>{l.message}</div>)}
            </div>
          </section>
        )}

        {leads.length > 0 && (
          <>
            <div className="tiles">
              <div className="tile hot"><b>{tierCount("hot")}</b><span>Hot · pitch first</span></div>
              <div className="tile"><b>{tierCount("warm")}</b><span>Warm</span></div>
              <div className="tile"><b>{tierCount("cold")}</b><span>Cold · site looks fine</span></div>
              <div className="tile"><b>{leads.length}</b><span>{checking ? `Businesses · ${checking} still being checked` : search?.counts.found ? `Unique businesses from ${search.counts.found} results` : "Businesses"}</span></div>
            </div>

            <section className="panel stack">
              <div className="row" style={{ justifyContent: "space-between" }}>
                <div className="chips">
                  {(["all", "hot", "warm", "cold"] as const).map((t) => (
                    <button key={t} className="chip" aria-pressed={tier === t} onClick={() => setTier(t)}>
                      {t === "all" ? "All" : t[0].toUpperCase() + t.slice(1)}
                    </button>
                  ))}
                  <button className="chip" aria-pressed={onlyNoSite} onClick={() => setOnlyNoSite(!onlyNoSite)}>No working website</button>
                  <button className="chip" aria-pressed={needPhone} onClick={() => setNeedPhone(!needPhone)}>Has phone</button>
                  <button className="chip" aria-pressed={needEmail} onClick={() => setNeedEmail(!needEmail)}>Has email</button>
                </div>
                <div className="row">
                  <input id="filter-q" type="search" placeholder="Filter by name or area" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 220 }} />
                  {search?.status === "done" && <a className="btn" href={`/api/searches/${search.id}/csv`}>Export CSV</a>}
                </div>
              </div>
              <div className="sub">{shown.length} of {leads.length} shown · sorted by opportunity score{checking ? ` · ${checking} still being checked (they move up as they finish)` : ""}</div>

              <div className="leads">
                {shown.map((l) => (
                  <LeadRow key={l.id} lead={l} open={open === l.id} onToggle={() => setOpen(open === l.id ? null : l.id)} />
                ))}
                {shown.length === 0 && <div className="empty">No leads match these filters.</div>}
              </div>
              {leads.some((l) => l.sources.includes("osm")) && <div className="sub">Map data from OpenStreetMap © OpenStreetMap contributors.</div>}
            </section>
          </>
        )}

        {!running && !search && !leads.length && (
          <section className="panel empty">
            Pick business types and a city, then press <b>Find leads</b>. Without a Google key, results come from OpenStreetMap only.
          </section>
        )}
      </main>
    </div>
  );
}

const compact = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k` : String(n));
const fmtPhone = (p?: string) => (p && /^\+91\d{10}$/.test(p) ? `+91 ${p.slice(3, 8)} ${p.slice(8)}` : p ?? "");

function siteTag(l: Lead) {
  const s = l.audit?.status;
  if (s === "none") return <span className="tag bad">No website</span>;
  if (s === "social_only") return <span className="tag bad">Social page only</span>;
  if (s === "down") return <span className="tag bad">Site not working</span>;
  if (s === "ok") {
    const v = l.websiteCheck?.via;
    return <span className="tag good">{v === "domain_guess" || v === "web_search" ? "Website found by us" : "Has website"}</span>;
  }
  return null;
}

function LeadRow({ lead: l, open, onToggle }: { lead: Lead; open: boolean; onToggle: () => void }) {
  const a = l.audit;
  return (
    <>
      <button className="lead" aria-expanded={open} onClick={onToggle}>
        {l.pending ? <span className="score" title="Still checking this business">…</span> : <span className={`score ${l.tier}`} title={`Opportunity score ${l.score}/100`}>{l.score}</span>}
        <span>
          <h3>{l.name}</h3>
          <span className="sub">{l.category}{l.address ? ` · ${l.address}` : ""}</span>
          <span className="signals">{l.pending ? <span className="tag">Checking website…</span> : siteTag(l)}{l.chain && <span className="tag" title={l.chain.reason}>Chain</span>}{l.social?.instagram?.followers != null && <span className="tag">IG {compact(l.social.instagram.followers)}</span>}{l.social?.instagram && l.social.instagram.followers == null && <span className="tag">Instagram</span>}{l.social?.facebook && <span className="tag">Facebook</span>}{l.rating != null && <span className="tag">{l.rating.toFixed(1)}★ · {l.reviews ?? 0}</span>}</span>
        </span>
        <span className="contact">
          {l.phone ? <span className="mono">{fmtPhone(l.phone)}</span> : <span className="sub">No phone</span>}
          {a?.whatsapp && a.whatsapp !== l.phone && <span className="mono">WhatsApp {fmtPhone(a.whatsapp)}</span>}
          {l.email ? <span>{l.email}</span> : <span className="sub">No email</span>}
        </span>
        <span className="why">
          {l.pending ? <span className="sub">Checking its website and contacts…</span> : l.whyNow}
          <span className="signals">{l.signals.filter((s) => !["has_phone", "has_email", "no_website", "social_only", "site_down", "chain", "ig_quiet", "owner_known", "established", "agency"].includes(s.key)).map((s) => <span key={s.key} className="tag warn">{s.label}</span>)}</span>
        </span>
      </button>
      {open && (
        <div className="detail">
          <dl>
            <dt>Phones</dt><dd className="mono">{l.phones.map(fmtPhone).join(", ") || "—"}</dd>
            <dt>Emails</dt>
            <dd>
              {l.emailInfo?.length
                ? l.emailInfo.map((e) => (
                    <div key={e.email}>
                      {e.email} <span className="sub">· {EMAIL_KIND_LABEL[e.kind]}{e.deliverable === false ? " · domain can't receive mail" : ""}</span>
                    </div>
                  ))
                : l.emails.join(", ") || "—"}
            </dd>
            {l.owner && <><dt>Owner</dt><dd>{l.owner.name} <span className="sub">· from {l.owner.via === "google_maps" ? "Google Maps" : "their website"}</span></dd></>}
            {l.orderLinks?.length ? <><dt>Orders / bookings</dt><dd>{l.orderLinks.map((o) => <a key={o.url} href={o.url} target="_blank" rel="noreferrer" style={{ marginRight: 8 }}>{o.source}</a>)}</dd></> : null}
            {(l.priceRange || l.photos) && <><dt>On Google Maps</dt><dd>{[l.priceRange && `price ${l.priceRange}`, l.photos && `${l.photos} photos`].filter(Boolean).join(" · ")}</dd></>}
            <dt>Website</dt><dd>{l.website ? <a href={l.website} target="_blank" rel="noreferrer">{l.website}</a> : "—"}</dd>
            {l.social?.instagram && (
              <>
                <dt>Instagram</dt>
                <dd>
                  <a href={l.social.instagram.url} target="_blank" rel="noreferrer">@{l.social.instagram.handle}</a>
                  {l.social.instagram.checked === "api" && (
                    <>
                      {" "}· {l.social.instagram.followers?.toLocaleString("en-IN")} followers · {l.social.instagram.posts ?? "?"} posts
                      {l.social.instagram.lastPostAt && <> · last post {new Date(l.social.instagram.lastPostAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}</>}
                      {l.social.instagram.bio && <div className="sub">{l.social.instagram.bio}</div>}
                    </>
                  )}
                  {l.social.instagram.checked === "not_business" && <span className="sub"> · personal account (details not available)</span>}
                  {l.social.instagram.checked === "link_only" && <span className="sub"> · add a Meta token to see followers</span>}
                </dd>
              </>
            )}
            {l.social?.facebook && <><dt>Facebook</dt><dd><a href={l.social.facebook.url} target="_blank" rel="noreferrer">{l.social.facebook.page}</a></dd></>}
            <dt>Socials</dt><dd>{a && Object.keys(a.socials).length ? Object.entries(a.socials).map(([k, v]) => <a key={k} href={v} target="_blank" rel="noreferrer" style={{ marginRight: 8 }}>{k}</a>) : "—"}</dd>
            <dt>Google Maps</dt><dd>{l.mapsUrl ? <a href={l.mapsUrl} target="_blank" rel="noreferrer">Open</a> : "—"}</dd>
            <dt>Found on</dt><dd>{l.sources.map((s) => ({ google: "Google Maps", osm: "OpenStreetMap", apollo: "Apollo", instagram: "Instagram", facebook: "Facebook", web: "Search engines", gmaps: "Google Maps (scraper)" })[s]).join(" + ")}</dd>
            {l.company && <><dt>Company</dt><dd>{[l.company.employees && `${l.company.employees} people`, l.company.foundedYear && `since ${l.company.foundedYear}`].filter(Boolean).join(" · ") || "—"}{l.company.linkedin && <> · <a href={l.company.linkedin} target="_blank" rel="noreferrer">LinkedIn</a></>}</dd></>}
          </dl>
          <dl>
            <dt>Status</dt><dd>{a?.status ?? "not checked"}{a?.httpStatus ? ` (HTTP ${a.httpStatus})` : ""}{a?.error ? ` · ${a.error}` : ""}</dd>
            <dt>HTTPS</dt><dd>{a?.status === "ok" ? (a.https ? "Yes" : "No") : "—"}</dd>
            <dt>Mobile-ready</dt><dd>{a?.status === "ok" ? (a.mobileViewport ? "Yes" : "No") : "—"}</dd>
            <dt>Mobile speed</dt><dd>{a?.pageSpeed ? `${a.pageSpeed.score}/100${a.pageSpeed.lcp ? ` · loads in ${a.pageSpeed.lcp}` : ""}` : "not checked"}</dd>
            <dt>Built with</dt><dd>{a?.builder ?? "—"}</dd>
            <dt>Last updated</dt><dd>{a?.copyrightYear ? `© ${a.copyrightYear}` : "—"}</dd>
            {a?.designedBy && <><dt>Built by</dt><dd>{a.designedBy}</dd></>}
            {a?.foundedYear && <><dt>Running since</dt><dd>{a.foundedYear}</dd></>}
            <dt>Website check</dt>
            <dd>
              {l.websiteCheck?.via === "source" && "Listed on the map"}
              {(l.websiteCheck?.via === "domain_guess" || l.websiteCheck?.via === "web_search" || l.websiteCheck?.via === "instagram_bio") && <>Found by {({ domain_guess: "trying likely addresses", web_search: "web search", instagram_bio: "the link in its Instagram bio" } as const)[l.websiteCheck.via]}: {l.websiteCheck.evidence}</>}
              {l.websiteCheck?.via === "none_found" && "No website found"}
              {l.websiteCheck?.tried?.length ? <div className="sub">Checked: {l.websiteCheck.tried.join(" · ")}</div> : null}
            </dd>
            {l.chain && <><dt>Chain</dt><dd>{l.chain.reason}</dd></>}
            <dt>Score</dt><dd>{l.signals.map((s) => `${s.label} +${s.points}`).join(" · ") || "0"}</dd>
          </dl>
        </div>
      )}
    </>
  );
}

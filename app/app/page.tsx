"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { categoryByKey } from "@/lib/categories";
import { leadsToCsv } from "@/lib/csv";
import { FOLLOW_UP, whatsappNumber, type FollowUpStatus, type Lang } from "@/lib/outreach";
import type { Lead, ProgressEvent, SearchParams, SearchRecord, Tier } from "@/lib/types";
import { DEFAULT_FORM, SearchForm, sourceInfo, type Config, type FormState } from "./_ui/SearchForm";
import { LeadCard } from "./_ui/LeadCard";
import { LeadDrawer } from "./_ui/LeadDrawer";
import { SetupPanel } from "./_ui/SetupPanel";
import { IconDownload, IconEdit, IconHistory, IconSearch, IconSettings, IconStop } from "./_ui/icons";

type LogLine = { level: "info" | "warn" | "error"; message: string };
type Sort = "score" | "reviews" | "name" | "status";

const STAGE_LABEL: Record<string, string> = {
  search: "Searching maps and the web",
  dedupe: "Removing duplicates",
  verify: "Looking for websites the map missed",
  enrich: "Checking each business",
  social: "Reading Instagram profiles",
  speed: "Checking mobile speed",
  score: "Scoring",
  save: "Saving",
};

/** Browser-only preferences (message language, your name, last search form). Never required. */
function usePref<T>(key: string, initial: T): [T, (v: T) => void] {
  const [v, setV] = useState<T>(initial);
  useEffect(() => {
    try {
      const s = localStorage.getItem(key);
      if (s) setV({ ...(typeof initial === "object" && initial ? initial : {}), ...JSON.parse(s) } as T);
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const set = useCallback((x: T) => {
    setV(x);
    try {
      localStorage.setItem(key, JSON.stringify(x));
    } catch {}
  }, [key]);
  return [v, set];
}

const formFromParams = (p: SearchParams, prev: FormState): FormState => ({
  ...prev,
  cats: p.categories,
  city: p.city,
  area: p.area ?? "",
  perCategory: p.perCategory,
  sources: { ...prev.sources, ...p.sources },
  pageSpeed: p.pageSpeed,
  verifyWebsites: p.verifyWebsites,
  webSearch: p.webSearch,
});

const place = (p: { area?: string; city: string }) => (p.area ? `${p.area}, ${p.city}` : p.city);
const dateShort = (iso: string) => new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short" });

export default function LeadFinder() {
  const [config, setConfig] = useState<Config | null>(null);
  const [form, setForm] = usePref<FormState>("lf.form", DEFAULT_FORM);
  const [prefs, setPrefs] = usePref<{ lang: Lang; sender: string }>("lf.prefs", { lang: "en", sender: "" });
  const [editing, setEditing] = useState(false);

  const [running, setRunning] = useState(false);
  const [stage, setStage] = useState<{ stage: string; done: number; total: number } | null>(null);
  const [log, setLog] = useState<LogLine[]>([]);
  const [search, setSearch] = useState<SearchRecord | null>(null);
  const [searchId, setSearchId] = useState<string | null>(null);
  const [params, setParams] = useState<Pick<SearchParams, "categories" | "city" | "area" | "sources"> | null>(null);
  const [stopping, setStopping] = useState(false);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [history, setHistory] = useState<SearchRecord[]>([]);
  const [error, setError] = useState("");

  const [tier, setTier] = useState<Tier | "all">("all");
  const [onlyNoSite, setOnlyNoSite] = useState(false);
  const [needPhone, setNeedPhone] = useState(false);
  const [needWa, setNeedWa] = useState(false);
  const [needEmail, setNeedEmail] = useState(false);
  const [status, setStatus] = useState<FollowUpStatus | "any">("any");
  const [sort, setSort] = useState<Sort>("score");
  const [q, setQ] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [setupOpen, setSetupOpen] = useState(false);
  const [recentOpen, setRecentOpen] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/api/config")
      .then((r) => r.json())
      .then((c: Config) => setConfig(c))
      .catch(() => {});
    loadHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [log]);

  function loadHistory() {
    fetch("/api/searches").then((r) => r.json()).then((d) => setHistory(d.searches ?? [])).catch(() => {});
  }

  function resetFilters() {
    setTier("all");
    setOnlyNoSite(false);
    setNeedPhone(false);
    setNeedWa(false);
    setNeedEmail(false);
    setStatus("any");
    setQ("");
  }

  async function openSearch(id: string) {
    setRecentOpen(false);
    const r = await fetch(`/api/searches/${id}`);
    if (!r.ok) return;
    const d = await r.json();
    setSearch(d.search);
    setSearchId(d.search.id);
    setParams(d.search.params);
    setForm(formFromParams(d.search.params, form));
    setLeads(d.leads);
    setLog(d.live?.logs ?? []);
    setStage(d.live?.stage ?? null);
    setStopping(!!d.live?.stopping);
    setOpenId(null);
    setEditing(false);
    setError("");
    resetFilters();
  }

  function newSearch() {
    setSearch(null);
    setSearchId(null);
    setParams(null);
    setLeads([]);
    setLog([]);
    setStage(null);
    setError("");
    setOpenId(null);
    setEditing(true);
  }

  /** Stop the search on screen. What's checked so far is kept and can be exported. */
  async function stopSearch() {
    if (!searchId) return;
    setStopping(true);
    const r = await fetch(`/api/searches/${searchId}/stop`, { method: "POST" }).catch(() => null);
    const d = await r?.json().catch(() => null);
    if (d?.search) {
      setSearch(d.search);
      setStopping(false);
      loadHistory();
    }
  }

  async function run() {
    setError("");
    setRunning(true);
    setEditing(false);
    setLog([]);
    setStage(null);
    setLeads([]);
    setSearch(null);
    setSearchId(null);
    setStopping(false);
    setOpenId(null);
    resetFilters();
    const body = {
      categories: form.cats,
      city: form.city.trim(),
      area: form.area.trim() || undefined,
      perCategory: form.perCategory,
      sources: { ...form.sources, google: form.sources.google && !!config?.google, gmaps: form.sources.gmaps && !!config?.gmapsScraper },
      pageSpeed: form.pageSpeed,
      verifyWebsites: form.verifyWebsites,
      webSearch: form.verifyWebsites && form.webSearch,
      apolloKey: form.sources.apollo && !config?.apollo ? form.apolloKey : undefined,
    };
    setParams(body);
    try {
      const res = await fetch("/api/search", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!res.ok || !res.body) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || `Search failed (${res.status})`);
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "", finished = false, lastError = "";
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
          if (ev.type === "start") setSearchId(ev.searchId);
          else if (ev.type === "log") {
            setLog((l) => [...l, { level: ev.level, message: ev.message }]);
            if (ev.level === "error") lastError = ev.message;
          } else if (ev.type === "stage") setStage({ stage: ev.stage, done: ev.done, total: ev.total });
          else if (ev.type === "leads") setLeads(ev.leads);
          else if (ev.type === "lead") setLeads((ls) => ls.map((x) => (x.id === ev.lead.id ? ev.lead : x)));
          else if (ev.type === "done") {
            finished = true;
            setSearch(ev.search);
            setLeads(ev.leads);
            if (ev.search.status === "failed") setError(ev.search.error || "Search failed");
            setStopping(false);
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

  // A running search opened from Recent searches: refresh it until it's done.
  useEffect(() => {
    if (running || !search || search.status !== "running") return;
    const t = setInterval(async () => {
      const r = await fetch(`/api/searches/${search.id}`).catch(() => null);
      if (!r?.ok) return;
      const d = await r.json();
      setLeads(d.leads);
      if (d.live) {
        setLog(d.live.logs);
        setStage(d.live.stage ?? null);
      }
      if (d.search.status !== "running") {
        setSearch(d.search);
        setStopping(false);
        loadHistory();
      }
    }, 5000);
    return () => clearInterval(t);
  }, [running, search]);

  const searchRunning = running || search?.status === "running";

  /** Save a status/note; shows it immediately and rolls back if the save fails. */
  async function saveFollowUp(lead: Lead, st: FollowUpStatus, note?: string) {
    if (!searchId || searchRunning) return;
    const before = lead.followUp;
    const next = { status: st, note: note ?? lead.followUp?.note, updatedAt: new Date().toISOString() };
    setLeads((ls) => ls.map((x) => (x.id === lead.id ? { ...x, followUp: next } : x)));
    const r = await fetch(`/api/searches/${searchId}/leads/${lead.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(next) }).catch(() => null);
    if (!r?.ok) {
      setLeads((ls) => ls.map((x) => (x.id === lead.id ? { ...x, followUp: before } : x)));
      const d = await r?.json().catch(() => null);
      setError(d?.error ?? "Couldn't save the status. Try again.");
    }
  }

  const counts = useMemo(() => {
    const done = leads.filter((l) => !l.pending);
    return { hot: done.filter((l) => l.tier === "hot").length, warm: done.filter((l) => l.tier === "warm").length, cold: done.filter((l) => l.tier === "cold").length, checking: leads.length - done.length };
  }, [leads]);

  const shown = useMemo(() => {
    const qq = q.trim().toLowerCase();
    const out = leads.filter(
      (l) =>
        (tier === "all" || (!l.pending && l.tier === tier)) &&
        (!onlyNoSite || ["none", "social_only", "down"].includes(l.audit?.status ?? "")) &&
        (!needPhone || l.phone || l.phones.length) &&
        (!needWa || whatsappNumber(l)) &&
        (!needEmail || l.email) &&
        (status === "any" || (l.followUp?.status ?? "new") === status) &&
        (!qq || `${l.name} ${l.category} ${l.address ?? ""} ${l.followUp?.note ?? ""}`.toLowerCase().includes(qq)),
    );
    const cmp: Record<Sort, (a: Lead, b: Lead) => number> = {
      score: (a, b) => b.score - a.score,
      reviews: (a, b) => (b.reviews ?? 0) - (a.reviews ?? 0),
      name: (a, b) => a.name.localeCompare(b.name),
      status: (a, b) => (b.followUp?.updatedAt ?? "").localeCompare(a.followUp?.updatedAt ?? ""),
    };
    return out.sort((a, b) => Number(!!a.pending) - Number(!!b.pending) || cmp[sort](a, b));
  }, [leads, tier, onlyNoSite, needPhone, needWa, needEmail, status, q, sort]);

  const filtered = shown.length !== leads.length;
  function exportShown() {
    const csv = leadsToCsv(shown);
    const name = `leads-${params?.city ?? "search"}-${new Date().toISOString().slice(0, 10)}${filtered ? `-${shown.length}` : ""}.csv`.replace(/[^a-z0-9.-]+/gi, "-").toLowerCase();
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const pct = stage && stage.total ? Math.round((stage.done / stage.total) * 100) : 0;
  const showForm = editing || (!leads.length && !searchRunning && !search);
  const openLead = leads.find((l) => l.id === openId) ?? null;
  const ready = sourceInfo(config).filter((s) => s.ready).length;

  const recentList = (
    <div className="history">
      {history.length === 0 && <span className="sub side-empty">No searches yet</span>}
      {history.slice(0, 12).map((h) => (
        <div key={h.id} className={`history-row ${h.id === searchId ? "current" : ""}`}>
          <button onClick={() => openSearch(h.id)}>
            <span>{place(h.params)}</span>
            <span className="h-meta">
              {h.status === "done" ? `${h.counts.hot} hot · ${h.counts.afterDedupe} leads` : h.status === "stopped" ? `stopped · ${h.counts.afterDedupe} leads` : h.status === "running" ? "running now" : h.status} · {dateShort(h.createdAt)}
            </span>
          </button>
          {h.status !== "failed" && <a className="history-csv" href={`/api/searches/${h.id}/csv`} title="Download this search as CSV" aria-label={`Download ${place(h.params)} as CSV`}><IconDownload /></a>}
        </div>
      ))}
    </div>
  );

  return (
    <div className="shell">
      <aside className="side">
        <div className="brand">
          <b>Lead Autopilot</b>
          <small>working name</small>
        </div>
        <nav className="nav" aria-label="Modules">
          <a href="/" aria-current="page">Lead Finder</a>
          <details className="soon">
            <summary>Coming soon</summary>
            <span>Business Brain</span>
            <span>Outreach</span>
            <span>Conversations</span>
            <span>Handed to you</span>
            <span>Credits</span>
          </details>
        </nav>
        <div className="history-wrap">
          <div className="side-lbl">Recent searches</div>
          {recentList}
        </div>
        <button className="side-foot" onClick={() => setSetupOpen(true)}>
          <IconSettings />
          <span>
            <b>Sources & setup</b>
            <small>{config ? `${ready} sources ready · ${config.store === "supabase" ? "saving to Supabase" : "saving on this computer"}` : "Loading…"}</small>
          </span>
        </button>
      </aside>

      <main>
        <div className="mobile-bar">
          <b className="m-brand">Lead Autopilot</b>
          <button className="icon-btn" onClick={() => setRecentOpen(true)} aria-label="Recent searches"><IconHistory /></button>
          <button className="icon-btn" onClick={() => setSetupOpen(true)} aria-label="Sources and setup"><IconSettings /></button>
        </div>

        <div className="top">
          <div>
            <h1>Find leads</h1>
            <p>Local businesses that need a new or better website, with how to reach them and the reason to pitch now.</p>
          </div>
          {!showForm && (
            <button className="btn" onClick={newSearch} disabled={searchRunning}><IconSearch /> New search</button>
          )}
        </div>

        {showForm ? (
          <SearchForm form={form} setForm={setForm} config={config} running={running} onSubmit={run} onCancel={leads.length || search ? () => setEditing(false) : undefined} onOpenSetup={() => setSetupOpen(true)} />
        ) : (
          params && (
            <section className="summary panel" aria-label="This search">
              <div>
                <b>{params.categories.map((k) => categoryByKey(k)?.label ?? k).join(", ")}</b>
                <span className="sub">
                  {" "}in {place(params)} · {Object.entries(params.sources).filter(([, v]) => v).length} sources
                  {search?.createdAt ? ` · ${dateShort(search.createdAt)}` : ""}
                </span>
              </div>
              <button className="btn" onClick={() => setEditing(true)} disabled={searchRunning}><IconEdit /> Edit & search again</button>
            </section>
          )
        )}

        {error && <div className="alert" role="alert">{error}<button className="linkish" onClick={() => setError("")}>Dismiss</button></div>}

        {(searchRunning || (log.length > 0 && !leads.length)) && (
          <section className="panel progress-panel" aria-live="polite">
            <div className="row between">
              <b>{stopping ? "Stopping…" : stage ? STAGE_LABEL[stage.stage] ?? "Working" : "Starting"}</b>
              <div className="row">
                {stage && <span className="sub mono">{stage.done}/{stage.total}</span>}
                {searchRunning && searchId && (
                  <button className="btn" onClick={stopSearch} disabled={stopping} title="Stop here: everything checked so far is kept and can be exported">
                    <IconStop /> {stopping ? "Stopping…" : "Stop"}
                  </button>
                )}
              </div>
            </div>
            <div className="progress"><i style={{ width: `${searchRunning ? pct : 100}%` }} /></div>
            {log.length > 0 && <p className={`last-log ${log[log.length - 1].level}`}>{log[log.length - 1].message}</p>}
            {log.length > 1 && (
              <details>
                <summary>Full log ({log.length})</summary>
                <div className="log" ref={logRef}>{log.map((l, i) => <div key={i} className={l.level}>{l.message}</div>)}</div>
              </details>
            )}
          </section>
        )}

        {!searchRunning && search && search.status !== "done" && search.status !== "failed" && search.error && (
          <p className="note">{search.error}. Businesses marked “Checking” weren't checked; they're included in exports with Checked = no.</p>
        )}

        {leads.length > 0 && (
          <>
            <div className="tiles" role="group" aria-label="Filter by tier">
              {([["hot", "Hot", "pitch first"], ["warm", "Warm", "worth a try"], ["cold", "Cold", "site looks fine"]] as const).map(([t, label, hint]) => (
                <button key={t} className={`tile ${t}`} aria-pressed={tier === t} onClick={() => setTier(tier === t ? "all" : t)}>
                  <b>{counts[t]}</b>
                  <span>{label} · {hint}</span>
                </button>
              ))}
              <button className="tile" aria-pressed={tier === "all"} onClick={() => setTier("all")}>
                <b>{leads.length}</b>
                <span>{counts.checking ? `All · ${counts.checking} still checking` : "All businesses"}</span>
              </button>
            </div>

            <section className="panel stack results" aria-label="Leads">
              <div className="toolbar">
                <div className="chips" role="group" aria-label="Filters">
                  <button className="chip" aria-pressed={onlyNoSite} onClick={() => setOnlyNoSite(!onlyNoSite)}>No working website</button>
                  <button className="chip" aria-pressed={needPhone} onClick={() => setNeedPhone(!needPhone)}>Has phone</button>
                  <button className="chip" aria-pressed={needWa} onClick={() => setNeedWa(!needWa)}>WhatsApp</button>
                  <button className="chip" aria-pressed={needEmail} onClick={() => setNeedEmail(!needEmail)}>Has email</button>
                </div>
                <div className="toolbar-right">
                  <select value={status} onChange={(e) => setStatus(e.target.value as FollowUpStatus | "any")} aria-label="Filter by status">
                    <option value="any">Any status</option>
                    {FOLLOW_UP.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                  </select>
                  <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="Sort">
                    <option value="score">Best leads first</option>
                    <option value="reviews">Most reviews</option>
                    <option value="name">Name A–Z</option>
                    <option value="status">Recently updated</option>
                  </select>
                  <input type="search" placeholder="Search name, area, note" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search leads" />
                </div>
              </div>
              <div className="row between">
                <span className="sub">
                  {shown.length} of {leads.length} shown{filtered && <> · <button className="linkish" onClick={resetFilters}>clear filters</button></>}
                </span>
                <div className="row">
                  <button className="btn" onClick={exportShown} disabled={!shown.length} title="Download the leads shown, as CSV">
                    <IconDownload /> Export {filtered ? `${shown.length} shown` : "CSV"}{searchRunning || (search && search.status !== "done") ? " (so far)" : ""}
                  </button>
                  {filtered && searchId && <a className="linkish" href={`/api/searches/${searchId}/csv`}>or all {leads.length}</a>}
                </div>
              </div>

              <div className="cards">
                {shown.map((l) => (
                  <LeadCard key={l.id} lead={l} active={openId === l.id} lang={prefs.lang} sender={prefs.sender} onOpen={() => setOpenId(l.id)} onStatus={(s) => saveFollowUp(l, s)} statusDisabled={searchRunning} />
                ))}
                {shown.length === 0 && <div className="empty">No leads match these filters. <button className="linkish" onClick={resetFilters}>Clear filters</button></div>}
              </div>
              {leads.some((l) => l.sources.includes("osm")) && <div className="sub">Map data from OpenStreetMap © OpenStreetMap contributors.</div>}
            </section>
          </>
        )}

        {showForm && !leads.length && !history.length && (
          <section className="panel how">
            <h2>How it works</h2>
            <ol>
              <li><b>Pick a city and business types.</b> The app searches maps and the web for local businesses.</li>
              <li><b>It checks each one</b>: does it have a website, is it working, fast and mobile-friendly, how to reach them.</li>
              <li><b>Work the list</b>: the best leads come first, with the reason to pitch, one-tap Call and WhatsApp, and a status to track who you've contacted.</li>
            </ol>
          </section>
        )}
      </main>

      {openLead && (
        <LeadDrawer
          lead={openLead}
          lang={prefs.lang}
          setLang={(lang) => setPrefs({ ...prefs, lang })}
          sender={prefs.sender}
          setSender={(sender) => setPrefs({ ...prefs, sender })}
          onClose={() => setOpenId(null)}
          onFollowUp={(st, note) => saveFollowUp(openLead, st, note)}
          statusDisabled={searchRunning}
        />
      )}
      {setupOpen && <SetupPanel config={config} onClose={() => setSetupOpen(false)} />}
      {recentOpen && (
        <>
          <div className="scrim" onClick={() => setRecentOpen(false)} />
          <div className="sheet" role="dialog" aria-modal="true" aria-label="Recent searches">
            <div className="row between"><b>Recent searches</b><button className="linkish" onClick={() => setRecentOpen(false)}>Close</button></div>
            {recentList}
          </div>
        </>
      )}
    </div>
  );
}

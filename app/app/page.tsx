"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { categoryByKey } from "@/lib/categories";
import { leadsToCsv } from "@/lib/csv";
import { addDays, FOLLOW_UP, localDate, statusOf, whatsappNumber, type FollowUpStatus, type Lang } from "@/lib/outreach";
import { mergeFollowUp, type DueLead, type FollowUpPatch } from "@/lib/followups";
import type { Lead, ProgressEvent, SearchParams, SearchRecord, Tier } from "@/lib/types";
import { DEFAULT_FORM, SearchForm, sourceInfo, type Config, type FormState } from "./_ui/SearchForm";
import { LeadList, Skeleton } from "./_ui/LeadList";
import { FollowUpsToday } from "./_ui/FollowUps";
import { BulkBar } from "./_ui/BulkBar";
import { LeadDrawer } from "./_ui/LeadDrawer";
import { SetupPanel } from "./_ui/SetupPanel";
import { IconCheck, IconDownload, IconEdit, IconHistory, IconSearch, IconSettings, IconStop } from "./_ui/icons";

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
  const [prefs, setPrefs] = usePref<{ lang: Lang; sender: string; view: "cards" | "table" }>("lf.prefs", { lang: "en", sender: "", view: "table" });
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
  const [contactedWeek, setContactedWeek] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pitchId, setPitchId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [pipe, setPipe] = useState<{ due: DueLead[]; contactedThisWeek: number } | null>(null);
  const [toast, setToast] = useState<{ text: string; lead?: Lead } | null>(null);
  const [setupOpen, setSetupOpen] = useState(false);
  const [recentOpen, setRecentOpen] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/api/config")
      .then((r) => r.json())
      .then((c: Config) => setConfig(c))
      .catch(() => {});
    loadHistory();
    loadPipeline();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [log]);

  function loadPipeline() {
    fetch(`/api/pipeline?today=${localDate()}`).then((r) => r.json()).then((d) => d.due && setPipe(d)).catch(() => {});
  }

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
    setContactedWeek(false);
    setQ("");
  }

  async function openSearch(id: string, leadId?: string) {
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
    setOpenId(leadId ?? null);
    setSelected(new Set());
    setPitchId(null);
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
    setSelected(new Set());
    setPitchId(null);
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

  const locked = !!searchRunning;
  const patchLocal = (ids: Set<string>, patch: FollowUpPatch) => setLeads((ls) => ls.map((x) => (ids.has(x.id) ? { ...x, followUp: mergeFollowUp(x.followUp, patch) } : x)));

  /** Save a status/note/date: shown at once, rolled back if the save fails. Works for any saved search. */
  async function saveFollowUp(lead: Pick<Lead, "id" | "followUp" | "name">, patch: FollowUpPatch, sid = searchId) {
    if (!sid) return;
    const here = sid === searchId;
    if (here && locked) return;
    const before = leads;
    if (here) patchLocal(new Set([lead.id]), patch);
    const r = await fetch(`/api/searches/${sid}/leads/${lead.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) }).catch(() => null);
    if (!r?.ok) {
      if (here) setLeads(before);
      const d = await r?.json().catch(() => null);
      setError(d?.error ?? "Couldn't save that. Try again.");
    }
    loadPipeline();
  }

  async function bulkPatch(patch: FollowUpPatch) {
    if (!searchId || locked || !selected.size) return;
    const ids = new Set(selected);
    const before = leads;
    patchLocal(ids, patch);
    const r = await fetch(`/api/searches/${searchId}/leads`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids: [...ids], ...patch }) }).catch(() => null);
    if (!r?.ok) {
      setLeads(before);
      setError("Couldn't update those leads. Try again.");
    } else setToast({ text: `Updated ${ids.size} lead${ids.size > 1 ? "s" : ""}` });
    loadPipeline();
  }

  async function deleteSelected() {
    if (!searchId || locked || !selected.size) return;
    const ids = [...selected];
    const r = await fetch(`/api/searches/${searchId}/leads`, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids }) }).catch(() => null);
    if (!r?.ok) return setError("Couldn't delete those leads. Try again.");
    const gone = new Set(ids);
    setLeads((ls) => ls.filter((l) => !gone.has(l.id)));
    setSelected(new Set());
    setToast({ text: `Deleted ${ids.length} lead${ids.length > 1 ? "s" : ""}` });
    loadHistory();
    loadPipeline();
  }

  /** After WhatsApp opens: one tap to mark the lead contacted (and remind you in 3 days). */
  function onSent(lead: Lead) {
    if (statusOf(lead) === "new" && !locked) setToast({ text: `Sent to ${lead.name}?`, lead });
  }

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 9000);
    return () => clearTimeout(t);
  }, [toast]);

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
        (status === "any" || statusOf(l) === status) &&
        (!contactedWeek || (!!l.followUp?.contactedAt && Date.now() - Date.parse(l.followUp.contactedAt) < 7 * 86_400_000)) &&
        (!qq || `${l.name} ${l.category} ${l.address ?? ""} ${l.followUp?.note ?? ""}`.toLowerCase().includes(qq)),
    );
    const cmp: Record<Sort, (a: Lead, b: Lead) => number> = {
      score: (a, b) => b.score - a.score,
      reviews: (a, b) => (b.reviews ?? 0) - (a.reviews ?? 0),
      name: (a, b) => a.name.localeCompare(b.name),
      status: (a, b) => (b.followUp?.updatedAt ?? "").localeCompare(a.followUp?.updatedAt ?? ""),
    };
    return out.sort((a, b) => Number(!!a.pending) - Number(!!b.pending) || cmp[sort](a, b));
  }, [leads, tier, onlyNoSite, needPhone, needWa, needEmail, status, contactedWeek, q, sort]);

  const activeFilters = [tier !== "all", onlyNoSite, needPhone, needWa, needEmail, status !== "any", contactedWeek, !!q.trim()].filter(Boolean).length;
  const filtered = activeFilters > 0;
  function exportLeads(list: Lead[]) {
    const csv = leadsToCsv(list);
    const name = `leads-${params?.city ?? "search"}-${new Date().toISOString().slice(0, 10)}${list.length !== leads.length ? `-${list.length}` : ""}.csv`.replace(/[^a-z0-9.-]+/gi, "-").toLowerCase();
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const exportShown = () => exportLeads(shown);
  const toggleSelect = (id: string) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleAll = () => setSelected((s) => (shown.every((l) => s.has(l.id)) ? new Set() : new Set(shown.map((l) => l.id))));
  const contactedHere = leads.filter((l) => l.followUp?.contactedAt && Date.now() - Date.parse(l.followUp.contactedAt) < 7 * 86_400_000).length;

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

        {pipe && pipe.due.length > 0 && (
          <FollowUpsToday
            due={pipe.due}
            lang={prefs.lang}
            sender={prefs.sender}
            onUpdate={(sid, lead, p) => saveFollowUp(lead, p, sid)}
            onOpen={(sid, id) => (sid === searchId ? setOpenId(id) : openSearch(sid, id))}
          />
        )}

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

        {searchRunning && !leads.length && <Skeleton />}

        {leads.length > 0 && (
          <>
            <div className="tiles" role="group" aria-label="Quick filters">
              {([["hot", "Hot", "pitch first"], ["warm", "Warm", "worth a try"], ["cold", "Cold", "site looks fine"]] as const).map(([t, label, hint]) => (
                <button key={t} className={`tile t-${t}`} aria-pressed={tier === t} onClick={() => setTier(tier === t ? "all" : t)}>
                  <b>{counts[t]}</b>
                  <span>{label} · {hint}</span>
                </button>
              ))}
              <button className="tile" aria-pressed={tier === "all" && !contactedWeek} onClick={() => { setTier("all"); setContactedWeek(false); }}>
                <b>{leads.length}</b>
                <span>{counts.checking ? `All · ${counts.checking} still checking` : "All leads"}</span>
              </button>
              <button className="tile t-progress" aria-pressed={contactedWeek} onClick={() => setContactedWeek(!contactedWeek)} title="Leads you moved past New in the last 7 days (all searches). Tap to show the ones in this search.">
                <b>{pipe?.contactedThisWeek ?? contactedHere}</b>
                <span>Contacted this week</span>
              </button>
            </div>

            <section className="results" aria-label="Leads">
              <div className="filterbar">
                <div className="chips scroll" role="group" aria-label="Filters">
                  {([["No working website", onlyNoSite, setOnlyNoSite], ["Has phone", needPhone, setNeedPhone], ["WhatsApp", needWa, setNeedWa], ["Has email", needEmail, setNeedEmail]] as const).map(([label, on, set]) => (
                    <button key={label} className="chip" aria-pressed={on} onClick={() => set(!on)}>
                      {on && <IconCheck />} {label}
                    </button>
                  ))}
                  <select className={`chip-select ${status !== "any" ? "on" : ""}`} value={status} onChange={(e) => setStatus(e.target.value as FollowUpStatus | "any")} aria-label="Filter by status">
                    <option value="any">Any status</option>
                    {FOLLOW_UP.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                  </select>
                </div>
                <div className="filterbar-row">
                  <span className="count-line">
                    <b>{shown.length}</b> of {leads.length} leads
                    {filtered && <button className="linkish" onClick={resetFilters}>Clear filters ({activeFilters})</button>}
                  </span>
                  <span className="grow" />
                  <input type="search" placeholder="Search name, area, note" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search leads" />
                  <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="Sort">
                    <option value="score">Best leads first</option>
                    <option value="reviews">Most reviews</option>
                    <option value="name">Name A–Z</option>
                    <option value="status">Recently updated</option>
                  </select>
                  <div className="seg" role="group" aria-label="View">
                    <button aria-pressed={prefs.view === "table"} onClick={() => setPrefs({ ...prefs, view: "table" })}>Table</button>
                    <button aria-pressed={prefs.view === "cards"} onClick={() => setPrefs({ ...prefs, view: "cards" })}>Cards</button>
                  </div>
                  <button className="btn sm" onClick={exportShown} disabled={!shown.length} title="Download the leads shown, as CSV">
                    <IconDownload /> Export{filtered ? ` ${shown.length}` : ""}
                  </button>
                </div>
              </div>

              {shown.length ? (
                <LeadList
                  leads={shown}
                  view={prefs.view}
                  selected={selected}
                  onToggleSelect={toggleSelect}
                  onToggleAll={toggleAll}
                  openId={openId}
                  onOpen={setOpenId}
                  pitchId={pitchId}
                  onTogglePitch={(id) => setPitchId(pitchId === id ? null : id)}
                  lang={prefs.lang}
                  setLang={(lang) => setPrefs({ ...prefs, lang })}
                  sender={prefs.sender}
                  drafts={drafts}
                  setDraft={(id, t) => setDrafts((d) => { const n = { ...d }; if (t === undefined) delete n[id]; else n[id] = t; return n; })}
                  onSent={onSent}
                  onFollowUp={(l, p) => saveFollowUp(l, p)}
                  locked={locked}
                />
              ) : (
                <div className="empty">
                  <b>No leads match these filters.</b>
                  <button className="btn sm" onClick={resetFilters}>Clear filters</button>
                </div>
              )}
              {leads.some((l) => l.sources.includes("osm")) && <div className="sub attribution">Map data from OpenStreetMap © OpenStreetMap contributors.</div>}
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
          onFollowUp={(p) => saveFollowUp(openLead, p)}
          statusDisabled={locked}
          draft={drafts[openLead.id]}
          setDraft={(t) => setDrafts((d) => { const n = { ...d }; if (t === undefined) delete n[openLead.id]; else n[openLead.id] = t; return n; })}
          onSent={() => onSent(openLead)}
        />
      )}
      <BulkBar
        count={selected.size}
        locked={locked}
        onPatch={bulkPatch}
        onExport={() => exportLeads(leads.filter((l) => selected.has(l.id)))}
        onDelete={deleteSelected}
        onClear={() => setSelected(new Set())}
      />
      {toast && (
        <div className="toast" role="status">
          <span>{toast.text}</span>
          {toast.lead && (
            <button
              className="btn sm primary"
              onClick={() => {
                saveFollowUp(toast.lead!, { status: "contacted", followUpOn: addDays(3) });
                setToast({ text: `${toast.lead!.name} marked contacted · follow up in 3 days` });
              }}
            >
              Mark contacted
            </button>
          )}
          <button className="icon-btn" onClick={() => setToast(null)} aria-label="Dismiss">×</button>
        </div>
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

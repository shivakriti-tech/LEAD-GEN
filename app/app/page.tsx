"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { categoryByKey } from "@/lib/categories";
import { hasAgencyReason } from "@/lib/score/agency";
import { leadsToCsv } from "@/lib/csv";
import { addDays, FOLLOW_UP, localDate, pitchText, senderFor, statusOf, toneFor, whatsappLinkWith, whatsappNumber, type FollowUpStatus, type Lang, type Sender, type Tone } from "@/lib/outreach";
import { mergeFollowUp, touchedElsewhere, type CategoryStat, type DueLead, type FollowUpPatch, type Touched } from "@/lib/followups";
import type { FollowUp, KeepOnly, Lead, ProgressEvent, SearchParams, SearchRecord, Tier } from "@/lib/types";
import { DEFAULT_CATS, DEFAULT_FORM, DEFAULT_KEEP, SearchForm, sourceInfo, type Config, type FormState } from "./_ui/SearchForm";
import { ClientsView } from "./_ui/ClientsView";
import { OutreachView } from "./_ui/OutreachView";
import { PipelineView } from "./_ui/PipelineView";
import { brainServices, type ClientBrain } from "@/lib/brain";
import { LeadList, Skeleton } from "./_ui/LeadList";
import { HomeView } from "./_ui/HomeView";
import type { HomeData, HomeLead } from "@/lib/home";
import { BulkBar } from "./_ui/BulkBar";
import { LeadPanel } from "./_ui/LeadPanel";
import { RunPanel } from "./_ui/RunPanel";
import { useRunAlerts } from "./_ui/runAlerts";
import { SetupPanel } from "./_ui/SetupPanel";
import { PitchCtx, YourDetails, type PitchPrefs } from "./_ui/pitch";
import { IconReport, IconBell, IconCalendar, IconCheck, IconChevron, IconDownload, IconEdit, IconHistory, IconHome, IconPlus, IconSearch, IconSettings, IconSend, IconShield, IconTrophy, IconUser } from "./_ui/icons";
import { Popover } from "./_ui/Popover";
import { hasNicheReason, isNiche, NICHES } from "@/lib/niches";

type LogLine = { level: "info" | "warn" | "error"; message: string };
type Sort = "score" | "reviews" | "name" | "status";
type Prefs = { lang: Lang; sender: string; view: "cards" | "table"; tone: Exclude<Tone, "follow">; me: Sender };

/** Keep whichever follow-up was changed last (a streamed update can be older than your click). */
const newer = (a?: FollowUp, b?: FollowUp) => (!a ? b : !b ? a : a.updatedAt >= b.updatedAt ? a : b);

/** True while the screen is at least this wide. */
function useWide(query: string): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const m = window.matchMedia(query);
    const f = () => setOn(m.matches);
    f();
    m.addEventListener("change", f);
    return () => m.removeEventListener("change", f);
  }, [query]);
  return on;
}

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
  sells: p.sells ?? "website_development",
  client: p.client ? { name: p.client.name ?? "", services: p.client.services.length ? p.client.services : prev.client?.services ?? DEFAULT_FORM.client.services } : prev.client ?? DEFAULT_FORM.client,
  clientId: p.clientId,
  country: p.country ?? "IN",
  agency: p.agency?.services ?? prev.agency,
});

const initials = (name?: string) => (name?.trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "You").slice(0, 3);
const place = (p: { area?: string; city: string }) => (p.area ? `${p.area}, ${p.city}` : p.city);
const dateShort = (iso: string) => new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short" });

export default function LeadFinder() {
  const [config, setConfig] = useState<Config | null>(null);
  const [form, setForm] = usePref<FormState>("lf.form", DEFAULT_FORM);
  // the first service list ticked all five by default; move a form still on that default to the agent's eight
  const oldDefault = form.client?.services.length === 5 && ["customs", "freight", "courier", "forwarding", "warehousing"].every((x) => form.client!.services.includes(x as never));
  useEffect(() => {
    if (oldDefault) setForm({ ...form, client: { ...form.client!, services: DEFAULT_FORM.client.services } });
  }, [oldDefault]); // eslint-disable-line react-hooks/exhaustive-deps
  const [prefs, setPrefs] = usePref<Prefs>("lf.prefs", { lang: "en", sender: "", view: "table", tone: "friendly", me: {} });
  const [editing, setEditing] = useState(false);

  const [running, setRunning] = useState(false);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [stage, setStage] = useState<{ stage: string; done: number; total: number } | null>(null);
  const [log, setLog] = useState<LogLine[]>([]);
  const [search, setSearch] = useState<SearchRecord | null>(null);
  const [searchId, setSearchId] = useState<string | null>(null);
  const [params, setParams] = useState<Pick<SearchParams, "categories" | "city" | "area" | "sources" | "sells" | "client" | "clientId"> | null>(null);
  const [stopping, setStopping] = useState(false);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [history, setHistory] = useState<SearchRecord[]>([]);
  const [historyError, setHistoryError] = useState("");
  const [error, setError] = useState("");

  const [tier, setTier] = useState<Tier | "all">("all");
  const [onlyNoSite, setOnlyNoSite] = useState(false);
  const [needPhone, setNeedPhone] = useState(false);
  const [needWa, setNeedWa] = useState(false);
  const [needEmail, setNeedEmail] = useState(false);
  const [notContacted, setNotContacted] = useState(false);
  const [skipChains, setSkipChains] = useState(false);
  const [goodRating, setGoodRating] = useState(false);
  const [status, setStatus] = useState<FollowUpStatus | "any">("any");
  const [sort, setSort] = useState<Sort>("score");
  const [q, setQ] = useState("");
  const [contactedWeek, setContactedWeek] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pitchId, setPitchId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [pipe, setPipe] = useState<{ due: DueLead[]; contactedThisWeek: number; touched?: Record<string, Touched>; stats?: Record<string, CategoryStat> } | null>(null);
  const [toast, setToast] = useState<{ text: string; lead?: Lead; next?: Lead; sid?: string } | null>(null);
  /** Home (your numbers, what to do today) or Find leads. Starts on Home once you have searches. */
  const [view, setView] = useState<"home" | "leads" | "clients" | "outreach" | "pipeline" | null>(null);
  const [home, setHome] = useState<HomeData | null>(null);
  const [panelHidden, setPanelHidden] = useState(false);
  const wide = useWide("(min-width: 1280px)");
  const [setupOpen, setSetupOpen] = useState(false);
  const [recentOpen, setRecentOpen] = useState(false);
  const [focusDue, setFocusDue] = useState(0);
  /** Saved clients for the search form's picker (names only), refreshed when you come back from Clients. */
  const [clientList, setClientList] = useState<Array<{ id: string; name: string }>>([]);
  useEffect(() => {
    if (view !== "leads") return;
    fetch("/api/clients").then((r) => r.json()).then((d) => setClientList((d.clients ?? []).map((c: ClientBrain) => ({ id: c.id, name: c.name })))).catch(() => {});
  }, [view]);
  /** The Business Brain of the client the open search is for, if any. */
  const [brain, setBrain] = useState<ClientBrain | null>(null);
  const brainId = params?.clientId;
  useEffect(() => {
    if (!brainId) return setBrain(null);
    let live = true;
    fetch(`/api/clients/${brainId}`).then((r) => r.json()).then((d) => live && setBrain(d.client ?? null)).catch(() => live && setBrain(null));
    return () => void (live = false);
  }, [brainId]);

  useEffect(() => {
    fetch("/api/config")
      .then((r) => r.json())
      .then((c: Config) => setConfig(c))
      .catch(() => {});
    // links like /?view=leads&s=<search>&lead=<lead> open that search (and lead)
    const q = new URLSearchParams(window.location.search);
    if (q.get("s")) openSearch(q.get("s")!, q.get("lead") ?? undefined);
    else if (q.get("view") === "leads") setView("leads");
    else if (q.get("view") === "clients") setView("clients");
    else if (q.get("view") === "outreach") setView("outreach");
    else if (q.get("view") === "pipeline") setView("pipeline");
    loadHistory(true);
    loadPipeline();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Follow-ups due, contacted keys and type stats, plus the Home numbers. */
  function loadPipeline() {
    fetch(`/api/pipeline?today=${localDate()}`).then((r) => r.json()).then((d) => d.due && setPipe(d)).catch(() => {});
    fetch(`/api/home?today=${localDate()}&tz=${new Date().getTimezoneOffset()}`).then((r) => r.json()).then((d) => d.days && setHome(d)).catch(() => {});
  }

  /** Recent searches. A failed load keeps the list already shown and tries again (the server may be busy or restarting). */
  function loadHistory(first = false, attempt = 0) {
    fetch("/api/searches")
      .then(async (r) => {
        const d = await r.json().catch(() => ({}));
        if (!r.ok || !Array.isArray(d.searches)) throw new Error(d.error || `HTTP ${r.status}`);
        setHistory(d.searches);
        setHistoryError("");
        if (first) setView((v) => v ?? (d.searches.length ? "home" : "leads"));
      })
      .catch((e) => {
        setHistoryError(e instanceof Error ? e.message : "couldn't reach the server");
        if (first) setView((v) => v ?? "leads");
        if (attempt < 5) setTimeout(() => loadHistory(false, attempt + 1), 3000 * (attempt + 1));
      });
  }

  // keep the address bar in step, so a reload comes back to the same place
  useEffect(() => {
    if (!view) return;
    const url = view === "home" ? "/" : view === "clients" ? "/?view=clients" : view === "outreach" ? "/?view=outreach" : view === "pipeline" ? "/?view=pipeline" : searchId ? `/?view=leads&s=${searchId}` : "/?view=leads";
    if (window.location.pathname + window.location.search !== url) window.history.replaceState(null, "", url);
  }, [view, searchId]);

  /** Home, scrolled to the follow-up list. */
  function showFollowUps() {
    goHome();
    setFocusDue((n) => n + 1);
  }

  function goHome() {
    setView("home");
    setOpenId(null);
    setSelected(new Set());
    loadPipeline();
    window.scrollTo({ top: 0 });
  }

  /** Clear every filter, then start from the search's "keep only" choices if given. */
  function resetFilters(keep?: KeepOnly) {
    setTier("all");
    setOnlyNoSite(false);
    setNeedPhone(!!keep?.needPhone);
    setNeedWa(false);
    setNeedEmail(false);
    setNotContacted(!!keep?.notContacted);
    setSkipChains(!!keep?.skipChains);
    setGoodRating(!!keep?.goodRating);
    setStatus("any");
    setContactedWeek(false);
    setQ("");
  }

  async function openSearch(id: string, leadId?: string) {
    setRecentOpen(false);
    setView("leads");
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
    setPanelHidden(false);
    resetFilters(d.search.params.keep);
  }

  /** Selected leads → the email queue or LinkedIn tasks; says how many went in and why others didn't. */
  async function outreach(kind: "email" | "linkedin") {
    if (!searchId || !selected.size) return;
    const ids = [...selected];
    const sender = pitch.send ?? pitch.me;
    const texts = kind === "email" ? Object.fromEntries(ids.filter((id) => drafts[id]).map((id) => [id, drafts[id]])) : undefined;
    const r = await fetch(kind === "email" ? "/api/outreach/email/queue" : `/api/outreach/linkedin?today=${localDate()}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ searchId, leadIds: ids, sender, lang: prefs.lang, tone: prefs.tone ?? "friendly", followUps: true, texts, clientId: params?.clientId }),
    }).then((x) => x.json()).catch(() => ({ error: "Couldn't reach the app" }));
    if (r.error) return setToast({ text: r.error });
    const n = kind === "email" ? r.queued : r.added;
    const why = [...new Set((r.skipped ?? []).map((x: { why: string }) => x.why))].slice(0, 2).join("; ");
    setToast({ text: `${n} ${kind === "email" ? `email${n === 1 ? "" : "s"} queued` : `LinkedIn task${n === 1 ? "" : "s"} added`}${r.skipped?.length ? ` · ${r.skipped.length} skipped (${why})` : ""}` });
    if (n) setSelected(new Set());
  }

  /** Fill the search form for one client: their offer, services, business types, city and area. */
  function applyClient(c: ClientBrain) {
    const services = brainServices(c);
    // an agency search keeps its own types and place: the profile is your agency, used for its name and proof
    if (form.sells === "agency" && c.offer !== "logistics") return setForm({ ...form, clientId: c.id, client: { ...form.client, name: c.name } });
    setForm({
      ...form,
      sells: c.offer,
      clientId: c.id,
      client: { name: c.name, services: c.offer === "logistics" && services.length ? services : form.client.services },
      cats: c.audience.categories.length ? c.audience.categories : DEFAULT_CATS[c.offer],
      city: c.city ?? form.city,
      area: c.audience.areas[0] ?? (c.city && c.city !== form.city ? "" : form.area),
    });
  }
  /** A new search set up for one client. */
  function searchForClient(c: ClientBrain) {
    applyClient(c);
    newSearch();
  }
  async function pickClient(id: string | null) {
    if (!id) return setForm({ ...form, clientId: undefined, client: { ...form.client, name: form.sells === "logistics" ? form.client.name : "" } });
    const d = await fetch(`/api/clients/${id}`).then((r) => r.json()).catch(() => null);
    if (d?.client) applyClient(d.client);
  }

  function newSearch() {
    setView("leads");
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
    // retried: the server may be busy or restarting
    let d: { search?: SearchRecord; stopping?: boolean } | null = null;
    for (let i = 0; i < 4 && !d; i++) {
      if (i) await new Promise((r) => setTimeout(r, 3000));
      const r = await fetch(`/api/searches/${searchId}/stop`, { method: "POST" }).catch(() => null);
      d = r?.ok ? await r.json().catch(() => null) : null;
    }
    if (!d) {
      setStopping(false);
      setError("Couldn't reach the server to stop the search. Try Stop again in a moment.");
      return;
    }
    if (d.search) {
      setSearch(d.search);
      setStopping(false);
      loadHistory();
    }
  }

  async function run() {
    setError("");
    setRunning(true);
    setStartedAt(Date.now());
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
    setPanelHidden(false);
    const keep = { ...DEFAULT_KEEP, ...form.keep };
    resetFilters(keep);
    const body = {
      categories: form.cats,
      city: form.city.trim(),
      area: form.area.trim() || undefined,
      perCategory: form.perCategory,
      sources: { ...form.sources, google: form.sources.google && !!config?.google, gmaps: form.sources.gmaps && !!config?.gmapsScraper },
      pageSpeed: form.pageSpeed,
      fresh: !!form.fresh,
      verifyWebsites: form.verifyWebsites,
      webSearch: form.verifyWebsites && form.webSearch,
      apolloKey: form.sources.apollo && !config?.apollo ? form.apolloKey : undefined,
      keep,
      sells: form.sells ?? "website_development",
      client: form.sells === "logistics" || form.clientId ? { name: form.client?.name.trim() || undefined, services: form.sells === "logistics" ? form.client?.services ?? [] : [] } : undefined,
      clientId: form.clientId,
      country: form.country ?? "IN",
      agency: form.sells === "agency" ? { services: form.agency ?? [] } : undefined,
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
      let buf = "", finished = false, lastError = "", sid = "";
      // The server sends a blank line every 20s. Silence for a minute means the connection is dead
      // (e.g. the server restarted for a deploy and carries on with the search on its own).
      let quiet: ReturnType<typeof setTimeout> | undefined;
      const read = () => new Promise<ReadableStreamReadResult<Uint8Array> | null>((resolve, reject) => {
        quiet = setTimeout(() => resolve(null), 60_000);
        reader.read().then(resolve, reject).finally(() => clearTimeout(quiet));
      });
      for (;;) {
        const got = await read().catch(() => null);
        if (!got) {
          reader.cancel().catch(() => {});
          break;
        }
        const { value, done } = got;
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let nl;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl);
          buf = buf.slice(nl + 1);
          if (!line.trim()) continue;
          const ev = JSON.parse(line) as ProgressEvent;
          if (ev.type === "start") setSearchId((sid = ev.searchId));
          else if (ev.type === "log") {
            setLog((l) => [...l, { level: ev.level, message: ev.message }]);
            if (ev.level === "error") lastError = ev.message;
          } else if (ev.type === "stage") setStage({ stage: ev.stage, done: ev.done, total: ev.total });
          else if (ev.type === "leads") setLeads(ev.leads);
          else if (ev.type === "lead") setLeads((ls) => ls.map((x) => (x.id === ev.lead.id ? { ...ev.lead, followUp: newer(x.followUp, ev.lead.followUp) } : x)));
          else if (ev.type === "done") {
            finished = true;
            setSearch(ev.search);
            setLeads(ev.leads);
            if (ev.search.status === "failed") setError(ev.search.error || "Search failed");
            setStopping(false);
          }
        }
      }
      // Connection lost before the end: follow the saved search instead (it may still be running).
      if (!finished && sid && !lastError && (await followSaved(sid))) return;
      if (!finished) throw new Error(lastError || "The search stopped before it finished.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Search failed");
    } finally {
      setRunning(false);
      loadHistory();
      loadPipeline();
    }
  }

  /** Show a search as saved on the server (the refresh below takes over while it runs). False if it can't be loaded. */
  async function followSaved(id: string): Promise<boolean> {
    for (let i = 0; i < 6; i++) {
      const r = await fetch(`/api/searches/${id}`).catch(() => null);
      if (r?.ok) {
        const d = await r.json();
        setSearch(d.search);
        setLeads(d.leads);
        if (d.live) {
          setLog(d.live.logs);
          setStage(d.live.stage ?? null);
        }
        if (d.search.status === "failed") setError(d.search.error || "Search failed");
        return true;
      }
      await new Promise((r) => setTimeout(r, 5000)); // server still starting up
    }
    return false;
  }

  // A running search opened from Recent searches: refresh it until it's done.
  useEffect(() => {
    if (running || !search || search.status !== "running") return;
    const t = setInterval(async () => {
      const r = await fetch(`/api/searches/${search.id}`).catch(() => null);
      if (!r?.ok) return;
      const d = await r.json();
      setLeads((ls) => {
        const mine = new Map(ls.map((x) => [x.id, x.followUp]));
        return (d.leads as Lead[]).map((x) => ({ ...x, followUp: newer(mine.get(x.id), x.followUp) }));
      });
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
  // progress in the tab's title, and a notification when it's done (if you asked for one)
  const checkedCount = leads.filter((l) => !l.pending).length;
  const alerts = useRunAlerts(
    !!searchRunning,
    leads.length ? `${checkedCount}/${leads.length} checked` : "Searching…",
    `${leads.length} lead${leads.length === 1 ? "" : "s"}, ${leads.filter((l) => !l.pending && l.tier === "hot").length} hot`,
  );
  const isLogistics = params?.sells === "logistics";
  const isAgency = params?.sells === "agency";

  // statuses can change any time (even while a search runs); deleting waits until it's finished
  const locked = !!searchRunning;
  const patchLocal = (ids: Set<string>, patch: FollowUpPatch) => setLeads((ls) => ls.map((x) => (ids.has(x.id) ? { ...x, followUp: mergeFollowUp(x.followUp, patch) } : x)));

  /** Save a status/note/date: shown at once, rolled back if the save fails. Works for any saved search. */
  async function saveFollowUp(lead: Pick<Lead, "id" | "followUp" | "name">, patch: FollowUpPatch, sid = searchId) {
    if (!sid) return;
    const here = sid === searchId;
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
    if (!searchId || !selected.size) return;
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
    if (statusOf(lead) === "new") setToast({ text: `Sent to ${lead.name}?`, lead, next: nextAfter(lead.id) });
  }
  const markContacted = (lead: Lead, sid?: string) => saveFollowUp(lead, { status: "contacted", followUpOn: addDays(3) }, sid ?? searchId);

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
        (!onlyNoSite || (isLogistics ? l.signals.some((x) => x.key === "exports" || x.key === "imports") : isAgency ? hasAgencyReason(l) : isNiche(params?.sells) ? hasNicheReason(l) : ["none", "social_only", "down"].includes(l.audit?.status ?? ""))) &&
        (!needPhone || l.phone || l.phones.length) &&
        (!needWa || whatsappNumber(l)) &&
        (!needEmail || l.email) &&
        (!notContacted || (statusOf(l) === "new" && !touchedElsewhere(l, searchId, pipe?.touched))) &&
        (!skipChains || !l.chain) &&
        (!goodRating || l.rating == null || l.rating >= 4) &&
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
  }, [leads, tier, onlyNoSite, needPhone, needWa, needEmail, notContacted, skipChains, goodRating, status, contactedWeek, q, sort, searchId, pipe?.touched, isLogistics, isAgency, params?.sells]);

  const activeFilters = [tier !== "all", onlyNoSite, needPhone, needWa, needEmail, notContacted, skipChains, goodRating, status !== "any", contactedWeek, !!q.trim()].filter(Boolean).length;
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

  const showForm = editing || (!leads.length && !searchRunning && !search);
  const openLead = leads.find((l) => l.id === openId) ?? null;
  const docked = view === "leads" && wide && !showForm && leads.length > 0 && !panelHidden;
  const touchedOf = useCallback((l: Lead) => touchedElsewhere(l, searchId, pipe?.touched), [searchId, pipe?.touched]);
  /** The next lead in the list still worth messaging (checked, not contacted yet). */
  function nextAfter(id: string | null): Lead | undefined {
    const i = shown.findIndex((l) => l.id === id);
    return [...shown.slice(i + 1), ...shown.slice(0, Math.max(0, i))].find((l) => !l.pending && statusOf(l) === "new" && l.tier !== "cold" && !touchedOf(l));
  }
  const nextLead = openLead ? nextAfter(openLead.id) : undefined;

  // wide screen: the panel always shows a lead, starting with the best one
  useEffect(() => {
    if (docked && !openLead && shown.length) setOpenId((shown.find((l) => !l.pending) ?? shown[0]).id);
  }, [docked, openLead, shown]);

  // keys, when the panel sits beside the list: J/K move, W WhatsApp, C mark contacted
  const keyState = useRef({ shown, openLead, docked, prefs });
  keyState.current = { shown, openLead, docked, prefs };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const { shown, openLead, docked, prefs } = keyState.current;
      const t = e.target as HTMLElement;
      if (!docked || e.metaKey || e.ctrlKey || e.altKey || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable) return;
      const i = shown.findIndex((l) => l.id === openLead?.id);
      if (e.key === "j" || e.key === "k") {
        const n = shown[e.key === "j" ? Math.min(shown.length - 1, i + 1) : Math.max(0, i - 1)];
        if (n) setOpenId(n.id);
        document.querySelector(".leads-table tr.active, .card.active")?.scrollIntoView({ block: "nearest" });
      } else if (e.key === "w" && openLead) {
        const link = whatsappLinkWith(openLead, drafts[openLead.id] ?? pitchText(openLead, prefs.lang, toneFor(openLead, prefs.tone ?? "friendly"), pitch.send ?? pitch.me));
        if (link) {
          window.open(link, "_blank", "noreferrer");
          onSent(openLead);
        }
      } else if (e.key === "c" && openLead && statusOf(openLead) === "new") {
        markContacted(openLead);
        setToast({ text: `${openLead.name} marked contacted · follow up in 3 days` });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // what to do first: hot leads not messaged yet, and how many of those have no working website
  const focus = useMemo(() => {
    const hot = leads.filter((l) => !l.pending && l.tier === "hot");
    const todo = hot.filter((l) => statusOf(l) === "new" && !touchedOf(l));
    // a niche pitches something else than a website: its reasons are on each lead
    const noSite = isNiche(params?.sells) ? 0 : todo.filter((l) => ["none", "social_only", "down"].includes(l.audit?.status ?? "none")).length;
    const exporters = todo.filter((l) => l.signals.some((x) => x.key === "exports")).length;
    return { hot: hot.length, todo: todo.length, noSite, exporters };
  }, [leads, touchedOf, params?.sells]);
  const baseMe: Sender = prefs.me && Object.keys(prefs.me).length ? prefs.me : prefs.sender ? { name: prefs.sender } : {};
  const pitch: PitchPrefs = {
    lang: prefs.lang,
    setLang: (lang) => setPrefs({ ...prefs, lang }),
    tone: prefs.tone ?? "friendly",
    setTone: (tone) => setPrefs({ ...prefs, tone }),
    // an older saved "Sign messages as" becomes your name
    me: baseMe,
    setMe: (me) => setPrefs({ ...prefs, me }),
    send: senderFor(baseMe, brain),
    banned: brain?.rules.bannedPhrases,
    clientName: brain?.name,
  };
  const ready = sourceInfo(config).filter((s) => s.ready).length;

  const recentList = (
    <div className="history">
      {history.length === 0 && !historyError && <span className="sub side-empty">No searches yet</span>}
      {historyError && (
        <span className="sub side-empty">
          Couldn&apos;t load your searches ({historyError}).{" "}
          <button className="linkish" onClick={(e) => { e.stopPropagation(); loadHistory(); }}>Try again</button>
        </span>
      )}
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
    <PitchCtx.Provider value={pitch}>
    <div className="app">
      <header className="topbar">
        <button className="logo" onClick={goHome} aria-label="Lead Autopilot, Home">
          <span className="logo-mark" aria-hidden="true"><i /><i /></span>
          <b>Lead<span>Autopilot</span></b>
        </button>
        <nav className="topnav" aria-label="Main">
          <button className="tn" aria-current={view === "home" ? "page" : undefined} onClick={goHome}><span className="tn-ic"><IconHome /></span>Home</button>
          <button className="tn" aria-current={view === "leads" ? "page" : undefined} onClick={() => setView("leads")}><span className="tn-ic"><IconSearch /></span>Find leads</button>
          <Popover
            label="Recent searches"
            button={(open) => <button className="tn" aria-expanded={open} onClick={() => !open && loadHistory()}><span className="tn-ic"><IconHistory /></span>Searches<IconChevron /></button>}
          >
            {(close) => (
              <div className="pop-list" onClick={close}>
                <div className="pop-head"><b>Recent searches</b><span className="sub">Open one, or download it as CSV</span></div>
                {recentList}
              </div>
            )}
          </Popover>
          <button className="tn" aria-current={view === "outreach" ? "page" : undefined} onClick={() => setView("outreach")}><span className="tn-ic"><IconSend /></span>Outreach</button>
          <button className="tn" aria-current={view === "pipeline" ? "page" : undefined} onClick={() => setView("pipeline")}><span className="tn-ic"><IconTrophy /></span>Pipeline</button>
          <button className="tn" aria-current={view === "clients" ? "page" : undefined} onClick={() => setView("clients")}><span className="tn-ic"><IconUser /></span>Clients</button>
          <button className="tn" onClick={() => setSetupOpen(true)}><span className="tn-ic"><IconSettings /></span>Setup</button>
        </nav>
        <div className="top-actions">
          {config?.feedback && (
            <a className="btn sm feedback" href={`mailto:${config.feedback}?subject=${encodeURIComponent("Lead Autopilot feedback")}&body=${encodeURIComponent(`What I was doing:\n\nWhat happened:\n\nWhat I expected:\n\n(Screen: ${view ?? "home"}${searchId ? `, search ${searchId}` : ""})`)}`} title="Tell us what works and what doesn't">Feedback</a>
          )}
          <button className="round" onClick={showFollowUps} aria-label={`Follow-ups due: ${pipe?.due.length ?? 0}`} title="Follow up today">
            <IconBell />
            {(pipe?.due.length ?? 0) > 0 && <span className="badge">{pipe?.due.length ?? 0}</span>}
          </button>
          <Popover
            label="Your details"
            align="right"
            button={() => <button className="avatar" aria-label="Your details" title="Your details">{initials(pitch.me.name)}</button>}
          >
            {() => (
              <div className="pop-me">
                <b>Your details</b>
                <span className="sub">Every message introduces you with these.</span>
                <YourDetails plain />
                <span className="sub">{config ? `${ready} sources ready · ${config.store === "supabase" ? "saving to Supabase" : "saving on this computer"}` : ""}</span>
              </div>
            )}
          </Popover>
        </div>
      </header>

      <aside className="rail" aria-label="Quick actions">
        <div className="rail-group">
          <button className="round" onClick={newSearch} title="New search" aria-label="New search"><IconPlus /></button>
          <button className="round" onClick={showFollowUps} title="Follow up today" aria-label="Follow up today"><IconCalendar /></button>
          <button className="round" onClick={() => setRecentOpen(true)} title="Recent searches" aria-label="Recent searches"><IconHistory /></button>
          <button className="round" onClick={() => (leads.length ? exportLeads(leads) : setView("leads"))} title={leads.length ? "Export this search (CSV)" : "Find leads"} aria-label="Export this search"><IconDownload /></button>
        </div>
        <button className="round" onClick={() => setSetupOpen(true)} title="Sources & setup" aria-label="Sources and setup"><IconShield /></button>
      </aside>

      <main>
        {view === "outreach" ? (
          <OutreachView />
        ) : view === "pipeline" ? (
          <PipelineView onOpenLead={(sid, id) => openSearch(sid, id)} />
        ) : view === "clients" ? (
          <ClientsView ai={config?.ai ?? null} onFindLeads={searchForClient} />
        ) : view !== "leads" ? (
          <HomeView
            data={view ? home : null}
            due={pipe?.due ?? []}
            focusDue={focusDue}
            onNewSearch={newSearch}
            onFindLeads={() => setView("leads")}
            onOpenSearch={(id) => openSearch(id)}
            onOpenLead={(sid, id) => openSearch(sid, id)}
            onUpdate={(sid, lead, p) => saveFollowUp(lead, p, sid)}
            onSent={(l: HomeLead) => statusOf(l as unknown as Lead) === "new" && setToast({ text: `Sent to ${l.name}?`, lead: l as unknown as Lead, sid: l.searchId })}
          />
        ) : (
        <>
        <div className="top">
          <div>
            {showForm ? (
              <>
                {isNiche(form.sells) ? (
                  <>
                    <h1>{NICHES[form.sells].heading}</h1>
                    <p>{NICHES[form.sells].intro}</p>
                  </>
                ) : form.sells === "agency" ? (
                  <>
                    <h1>Who needs a store or better systems?</h1>
                    <p>Pick a country, a city and the kinds of business. We find online stores and companies whose website, store or systems are holding them back, say why, and write the first message.</p>
                  </>
                ) : form.sells === "logistics" ? (
                  <>
                    <h1>Who needs to ship goods today?</h1>
                    <p>Pick an area and the kinds of business. We find the ones that ship goods regularly, say what they'll likely need, and write the first message for your logistics client.</p>
                  </>
                ) : (
                  <>
                    <h1>Who needs a website today?</h1>
                    <p>Pick an area and the kinds of business you want to work with. We find the ones with weak or missing websites and write your first message.</p>
                  </>
                )}
              </>
            ) : searchRunning && !focus.todo ? (
              <>
                <h1>Finding leads</h1>
                <p>The best ones show up in the list as soon as they're checked.</p>
              </>
            ) : focus.todo ? (
              <>
                <h1>{focus.todo} {focus.todo === 1 ? "business" : "businesses"} to message first</h1>
                <p>{isLogistics ? (focus.exporters ? `${focus.exporters === focus.todo ? (focus.todo === 1 ? "It exports" : "All of them export") : `${focus.exporters} of them export`}: a fit for forwarding and customs. The message is ready.` : "Each one ships goods regularly. Their reasons are below, with the message ready.") : focus.noSite ? `${focus.noSite === focus.todo ? (focus.todo === 1 ? "It has" : "All have") : `${focus.noSite} ${focus.noSite === 1 ? "has" : "have"}`} no working website. Start there: the message is ready.` : "Their reasons are below, with the message ready."}</p>
              </>
            ) : focus.hot ? (
              <>
                <h1>Every top lead is messaged</h1>
                <p>Follow up with them, or try the ones worth a try.</p>
              </>
            ) : (
              <>
                <h1>No top leads in this search</h1>
                <p>Try the ones worth a try, or search another area or business type.</p>
              </>
            )}
          </div>
          {!showForm && (
            <button className="btn" onClick={newSearch} disabled={searchRunning}><IconSearch /> New search</button>
          )}
        </div>

        {showForm ? (
          <SearchForm
            form={form}
            setForm={setForm}
            config={config}
            running={running}
            onSubmit={run}
            onCancel={leads.length || search ? () => setEditing(false) : undefined}
            onOpenSetup={() => setSetupOpen(true)}
            history={history}
            stats={pipe?.stats}
            onOpenSearch={(id) => openSearch(id)}
            clients={clientList}
            onPickClient={pickClient}
          />
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
          <RunPanel
            where={params ? place(params) : "your area"}
            params={params ? { pageSpeed: form.pageSpeed, sources: params.sources, sells: params.sells } : null}
            stage={stage}
            log={log}
            leads={leads}
            running={!!searchRunning}
            stopping={stopping}
            onStop={searchId ? stopSearch : undefined}
            startedAt={running ? startedAt ?? undefined : search ? Date.parse(search.createdAt) : undefined}
            notify={alerts.notify}
            onNotify={alerts.ask}
          />
        )}

        {!searchRunning && search && search.status !== "done" && search.status !== "failed" && search.error && (
          <p className="note">{search.error}. Businesses marked “Checking” weren't checked; they're included in exports with Checked = no.</p>
        )}

        {searchRunning && !leads.length && <Skeleton />}

        {leads.length > 0 && (
          <>
          <div className={`work ${docked ? "docked" : ""}`}>
          <div className="work-main">
            <div className="tiles" role="group" aria-label="Quick filters">
              {([["hot", "Message first", "hot"], ["warm", "Worth a try", "warm"], ["cold", "Skip for now", "site looks fine"]] as const).map(([t, label, hint]) => (
                <button key={t} className={`tile t-${t}`} aria-pressed={tier === t} onClick={() => setTier(tier === t ? "all" : t)} title={`${label} (${hint})`}>
                  <b>{counts[t]}</b>
                  <span>{label}</span>
                </button>
              ))}
              <button className="tile" aria-pressed={tier === "all" && !contactedWeek} onClick={() => { setTier("all"); setContactedWeek(false); }}>
                <b>{leads.length}</b>
                <span>{counts.checking ? `Everything · ${counts.checking} checking` : "Everything"}</span>
              </button>
              <button className="tile t-progress" aria-pressed={contactedWeek} onClick={() => setContactedWeek(!contactedWeek)} title="Leads you moved past New in the last 7 days (all searches). Tap to show the ones in this search.">
                <b>{pipe?.contactedThisWeek ?? contactedHere}</b>
                <span>Contacted this week</span>
              </button>
            </div>

            <section className="results" aria-label="Leads">
              <div className="filterbar">
                <div className="chips scroll" role="group" aria-label="Filters">
                  {([[isLogistics ? "Exports or imports" : isAgency || isNiche(params?.sells) ? "Clear reason to pitch" : "No working website", onlyNoSite, setOnlyNoSite], ["Not messaged yet", notContacted, setNotContacted], ["Has phone", needPhone, setNeedPhone], ["WhatsApp", needWa, setNeedWa], ["Has email", needEmail, setNeedEmail], ["4★ and up", goodRating, setGoodRating], ["No chains", skipChains, setSkipChains]] as const).map(([label, on, set]) => (
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
                    {filtered && <button className="linkish" onClick={() => resetFilters()}>Clear filters ({activeFilters})</button>}
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
                  {searchId && (
                    <a className="btn sm" href={`/api/searches/${searchId}/report?format=pdf${pitch.me.name ? `&by=${encodeURIComponent(pitch.me.name)}` : ""}`} target="_blank" rel="noreferrer" title="A PDF report of the best leads, to send to your client. Opens in a new tab; download it from there">
                      <IconReport /> Report
                    </a>
                  )}
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
                  onOpen={(id) => { setOpenId(id); setPanelHidden(false); }}
                  pitchId={pitchId}
                  onTogglePitch={(id) => setPitchId(pitchId === id ? null : id)}
                  drafts={drafts}
                  setDraft={(id, t) => setDrafts((d) => { const n = { ...d }; if (t === undefined) delete n[id]; else n[id] = t; return n; })}
                  onSent={onSent}
                  onFollowUp={(l, p) => saveFollowUp(l, p)}
                  locked={false}
                  touched={touchedOf}
                  docked={docked}
                />
              ) : (
                <div className="empty">
                  <b>No leads match these filters.</b>
                  {searchRunning ? <span>More are still being checked.</span> : null}
                  <button className="btn sm" onClick={() => resetFilters()}>Clear filters</button>
                </div>
              )}
              {leads.some((l) => l.sources.includes("osm")) && <div className="sub attribution">Map data from OpenStreetMap © OpenStreetMap contributors.</div>}
            </section>
          </div>
          {docked && openLead && (
            <LeadPanel
              docked
              lead={openLead}
              onClose={() => setPanelHidden(true)}
              onFollowUp={(p) => saveFollowUp(openLead, p)}
              searchId={searchId}
              waApi={!!config?.whatsapp}
              draft={drafts[openLead.id]}
              setDraft={(t) => setDrafts((d) => { const n = { ...d }; if (t === undefined) delete n[openLead.id]; else n[openLead.id] = t; return n; })}
              onSent={() => onSent(openLead)}
              next={nextLead}
              onNext={() => nextLead && setOpenId(nextLead.id)}
              touched={touchedOf(openLead)}
            />
          )}
          </div>
          </>
        )}

        {showForm && !leads.length && !history.length && (
          <section className="panel how">
            <h2>How it works</h2>
            <ol>
              <li><b>Pick a city and business types.</b> The app searches maps and the web for local businesses.</li>
              <li><b>It checks each one</b>: does it have a website, is it working, fast and mobile-friendly, how to reach them.</li>
              <li><b>Message the best ones first</b>: each lead has the reason to pitch and a WhatsApp message already written in your voice (set your name once), in English or Hinglish.</li>
              <li><b>Keep track</b>: mark who you've messaged, set a follow-up date, and they come back under <i>Follow up today</i> on Home.</li>
            </ol>
          </section>
        )}
        </>
        )}
      </main>

      {openLead && !docked && (
        <LeadPanel
          docked={false}
          lead={openLead}
          onClose={() => setOpenId(null)}
          onFollowUp={(p) => saveFollowUp(openLead, p)}
          searchId={searchId}
          waApi={!!config?.whatsapp}
          draft={drafts[openLead.id]}
          setDraft={(t) => setDrafts((d) => { const n = { ...d }; if (t === undefined) delete n[openLead.id]; else n[openLead.id] = t; return n; })}
          onSent={() => onSent(openLead)}
          next={nextLead}
          onNext={() => nextLead && setOpenId(nextLead.id)}
          touched={touchedOf(openLead)}
        />
      )}
      <BulkBar
        count={selected.size}
        locked={locked}
        onPatch={bulkPatch}
        onExport={() => exportLeads(leads.filter((l) => selected.has(l.id)))}
        onDelete={deleteSelected}
        onClear={() => setSelected(new Set())}
        onEmail={searchId ? () => outreach("email") : undefined}
        onLinkedIn={searchId ? () => outreach("linkedin") : undefined}
      />
      {toast && (
        <div className="toast" role="status">
          <span>{toast.text}</span>
          {toast.lead && (
            <button
              className="btn sm primary"
              onClick={() => {
                markContacted(toast.lead!, toast.sid);
                setToast({ text: `${toast.lead!.name} marked contacted · follow up in 3 days` });
              }}
            >
              Mark contacted
            </button>
          )}
          {toast.lead && toast.next && (
            <button
              className="btn sm"
              onClick={() => {
                markContacted(toast.lead!);
                setOpenId(toast.next!.id);
                setPanelHidden(false);
                setToast({ text: `${toast.lead!.name} marked contacted · now ${toast.next!.name}` });
              }}
            >
              Contacted, next lead →
            </button>
          )}
          <button className="icon-btn" onClick={() => setToast(null)} aria-label="Dismiss">×</button>
        </div>
      )}
      {setupOpen && <SetupPanel config={config} onClose={() => setSetupOpen(false)} />}
      <nav className="bottomnav" aria-label="Main">
        <button aria-current={view === "home" ? "page" : undefined} onClick={goHome}><IconHome /><span>Home</span></button>
        <button aria-current={view === "leads" ? "page" : undefined} onClick={() => setView("leads")}><IconSearch /><span>Find leads</span></button>
        <button aria-current={view === "outreach" ? "page" : undefined} onClick={() => setView("outreach")}><IconSend /><span>Outreach</span></button>
        <button aria-current={view === "pipeline" ? "page" : undefined} onClick={() => setView("pipeline")}><IconTrophy /><span>Pipeline</span></button>
        <button onClick={() => { setRecentOpen(true); loadHistory(); }}><IconHistory /><span>Searches</span></button>
        <button aria-current={view === "clients" ? "page" : undefined} onClick={() => setView("clients")}><IconUser /><span>Clients</span></button>
      </nav>
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
    </PitchCtx.Provider>
  );
}

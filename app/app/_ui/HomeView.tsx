"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { HomeData, HomeDay, HomeLead } from "@/lib/home";
import { windowed } from "@/lib/home";
import type { DueLead, FollowUpPatch } from "@/lib/followups";
import type { Lead } from "@/lib/types";
import { addDays, dueLabel, followUpMessage, issueChips, localDate, pitchText, toneFor, whatsappLinkWith, FOLLOW_UP } from "@/lib/outreach";
import { usePitch } from "./pitch";
import { IconCalendar, IconChat, IconCheck, IconClose, IconDown, IconExpand, IconHistory, IconPercent, IconPlus, IconReply, IconSend, IconTrophy, IconUp, IconWhatsApp } from "./icons";

const dayOf = (d: string) => new Date(`${d}T12:00:00`);
const fmtDay = (d: string) => dayOf(d).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });
const fmtShort = (d: string) => dayOf(d).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
const rupees = (n: number) => `₹${n.toLocaleString("en-IN")}`;
const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);
const LETTER = ["S", "M", "T", "W", "T", "F", "S"];

function greeting(now = new Date()) {
  const h = now.getHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

function ago(iso: string): string {
  const mins = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins} min ago`;
  if (localDate(new Date(iso)) === localDate()) return `Today, ${new Date(iso).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })}`;
  const days = Math.round((Date.now() - Date.parse(iso)) / 86_400_000);
  return days <= 1 ? "Yesterday" : days < 7 ? `${days} days ago` : fmtShort(localDate(new Date(iso)));
}

/** A round badge with the business's initials, tinted by name so rows are easy to tell apart. */
const TINTS = ["#F6DCCF", "#E9E1D3", "#DCE6DF", "#DDE3F1", "#EBDDF1", "#F2E6C9"];
function Avatar({ name }: { name: string }) {
  const words = name.replace(/[^\p{L}\p{N} ]/gu, "").split(/\s+/).filter(Boolean);
  const ini = ((words[0]?.[0] ?? "") + (words[1]?.[0] ?? "")).toUpperCase() || "·";
  const tint = TINTS[[...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % TINTS.length];
  return <span className="avatar-sm" style={{ background: tint }} aria-hidden="true">{ini}</span>;
}

/** "↗ +3 vs last week". The arrow says up or down (green when that's good); the words stay plain. */
function Delta({ now, prev, vs, money, unit = "", dark }: { now: number; prev: number; vs: string; money?: boolean; unit?: string; dark?: boolean }) {
  const d = now - prev;
  const cls = `delta ${d > 0 ? "up" : d < 0 ? "down" : "flat"} ${dark ? "on-dark" : ""}`;
  if (!now && !prev) return <span className={cls}>Nothing yet</span>;
  return (
    <span className={cls}>
      {d > 0 ? <IconUp /> : d < 0 ? <IconDown /> : null}
      {d === 0 ? `Same as ${vs}` : `${d > 0 ? "+" : "−"}${money ? rupees(Math.abs(d)) : Math.abs(d)}${unit} vs ${vs}`}
    </span>
  );
}

/**
 * Messages sent: this period in orange beside the one before it in sand, so you see at a glance
 * whether you're keeping up. Week = 14 daily bars; Month = 8 weekly bars.
 */
function PeriodBars({ days, mode }: { days: HomeDay[]; mode: "week" | "month" }) {
  const [hover, setHover] = useState<number | null>(null);
  const bars = useMemo(() => {
    if (mode === "week")
      return days.slice(-14).map((d, i) => ({ key: d.date, now: i >= 7, v: d.messaged, r: d.replied, x: LETTER[dayOf(d.date).getDay()], tip: fmtDay(d.date) }));
    const last = days.slice(-56);
    return Array.from({ length: 8 }, (_, w) => {
      const wk = last.slice(w * 7, w * 7 + 7);
      return { key: wk[0].date, now: w >= 4, v: wk.reduce((t, d) => t + d.messaged, 0), r: wk.reduce((t, d) => t + d.replied, 0), x: fmtShort(wk[0].date), tip: `Week of ${fmtShort(wk[0].date)}` };
    });
  }, [days, mode]);
  const max = Math.max(1, ...bars.map((b) => b.v));
  const h = hover != null ? bars[hover] : null;
  const label = mode === "week" ? "Messages per day, last week and this week" : "Messages per week, the last 8 weeks";
  return (
    <div className="pbars" onMouseLeave={() => setHover(null)}>
      <div className="pbars-top">
        <div className="legend" aria-hidden="true">
          <span><i className="sw now" /> {mode === "week" ? "This week" : "Last 4 weeks"}</span>
          <span><i className="sw prev" /> {mode === "week" ? "Last week" : "4 weeks before"}</span>
        </div>
        <span className="pbars-tip" aria-live="polite">{h ? <><b>{h.tip}</b> · {h.v} sent{h.r ? ` · ${h.r} ${h.r === 1 ? "reply" : "replies"}` : ""}</> : bars.every((b) => !b.v) ? "Send a few messages to fill this in" : null}</span>
      </div>
      <div className="pbars-plot" role="img" aria-label={label}>
        {bars.map((b, i) => (
          <button
            key={b.key}
            type="button"
            className={`pbar-slot ${hover === i ? "on" : ""}`}
            onMouseEnter={() => setHover(i)}
            onFocus={() => setHover(i)}
            onClick={() => setHover(i)}
            aria-label={`${b.tip}: ${b.v} sent, ${b.r} replies`}
          >
            <i className={`pbar ${b.now ? "now" : "prev"} ${b.v ? "" : "zero"}`} style={b.v ? { height: `${Math.max(6, (b.v / max) * 100)}%` } : undefined} />
          </button>
        ))}
      </div>
      <div className="pbars-x" aria-hidden="true">{bars.map((b) => <span key={b.key}>{b.x}</span>)}</div>
      <table className="sr-only">
        <caption>{label}</caption>
        <thead><tr><th>{mode === "week" ? "Day" : "Week"}</th><th>Sent</th><th>Replies</th></tr></thead>
        <tbody>{bars.map((b) => <tr key={b.key}><td>{b.tip}</td><td>{b.v}</td><td>{b.r}</td></tr>)}</tbody>
      </table>
    </div>
  );
}

/** A soft wave: the last 14 days, the latest day marked. */
function Spark({ values, dark }: { values: number[]; dark?: boolean }) {
  const id = useId().replace(/:/g, "");
  // a 3-day average turns day-to-day jumps into a readable trend
  const smooth = values.map((_, i) => { const w = values.slice(Math.max(0, i - 1), i + 2); return w.reduce((a, b) => a + b, 0) / w.length; });
  const max = Math.max(1, ...smooth);
  const pts = smooth.map((v, i) => [2 + (i / (smooth.length - 1)) * 96, 33 - (v / max) * 24] as const);
  // smooth curve through the points (Catmull-Rom as cubic Béziers)
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, y0] = pts[i - 1] ?? pts[i], [x1, y1] = pts[i], [x2, y2] = pts[i + 1], [x3, y3] = pts[i + 2] ?? pts[i + 1];
    d += ` C${(x1 + (x2 - x0) / 6).toFixed(2)},${(y1 + (y2 - y0) / 6).toFixed(2)} ${(x2 - (x3 - x1) / 6).toFixed(2)},${(y2 - (y3 - y1) / 6).toFixed(2)} ${x2.toFixed(2)},${y2.toFixed(2)}`;
  }
  const [lx, ly] = pts[pts.length - 1];
  return (
    <svg className={`wave ${dark ? "dark" : ""}`} viewBox="0 0 100 38" preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <linearGradient id={id} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" className="wave-g0" />
          <stop offset="1" className="wave-g1" />
        </linearGradient>
      </defs>
      <path d={`${d} L100,38 L0,38 Z`} fill={`url(#${id})`} />
      <path className="wave-line" d={d} vectorEffect="non-scaling-stroke" />
      <circle className="wave-dot" cx={lx} cy={ly} r="1.6" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/** Follow-ups set for each of the next 7 days, on the dark card. */
function Upcoming({ days }: { days: Array<{ date: string; n: number }> }) {
  const max = Math.max(1, ...days.map((d) => d.n));
  return (
    <div className="upc" role="img" aria-label={`Follow-ups coming up: ${days.map((d) => `${fmtShort(d.date)} ${d.n}`).join(", ")}`}>
      {days.map((d, i) => (
        <span key={d.date} className="upc-col" title={`${fmtDay(d.date)}: ${d.n}`}>
          <i className={`upc-bar ${i === 0 ? "today" : ""} ${d.n ? "" : "zero"}`} style={d.n ? { height: `${Math.max(12, (d.n / max) * 100)}%` } : undefined} />
          <small>{i === 0 ? "Today" : LETTER[dayOf(d.date).getDay()]}</small>
        </span>
      ))}
    </div>
  );
}

type Tab = "follow" | "next" | "recent";
type Tip = { text: string; action?: { label: string; run: () => void } };

export function HomeView({
  data,
  due,
  focusDue,
  onNewSearch,
  onFindLeads,
  onOpenSearch,
  onOpenLead,
  onUpdate,
  onSent,
}: {
  data: HomeData | null;
  due: DueLead[];
  /** Changes when the bell is pressed: jump to the follow-up list. */
  focusDue: number;
  onNewSearch: () => void;
  onFindLeads: () => void;
  onOpenSearch: (id: string) => void;
  onOpenLead: (searchId: string, leadId: string) => void;
  onUpdate: (searchId: string, lead: Pick<Lead, "id" | "name" | "followUp">, p: FollowUpPatch) => void;
  onSent: (lead: HomeLead) => void;
}) {
  const { lang, tone, me } = usePitch();
  const [mode, setMode] = useState<"week" | "month">("week");
  const [tab, setTab] = useState<Tab | null>(null);
  const [tipAt, setTipAt] = useState(0);
  const [tipHidden, setTipHidden] = useState(false);
  const tableRef = useRef<HTMLElement>(null);
  const today = localDate();
  const late = due.filter((d) => d.lead.followUp!.followUpOn! < today).length;
  const current: Tab = tab ?? (due.length ? "follow" : "next");
  const openTab = (t: Tab) => {
    setTab(t);
    setTimeout(() => tableRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 30);
  };
  useEffect(() => {
    if (focusDue) openTab("follow");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusDue]);

  const tips = useMemo<Tip[]>(() => {
    if (!data) return [];
    const out: Tip[] = [];
    if (!me.name) out.push({ text: "Add your name (top right) so every message introduces you." });
    if (!me.link) out.push({ text: "Add a link to your work, like a portfolio or Instagram. It gives people a reason to reply." });
    const cats = Object.entries(data.byCategory).filter(([, c]) => c.messaged >= 5).sort((a, b) => b[1].replied / b[1].messaged - a[1].replied / a[1].messaged);
    if (cats.length && cats[0][1].replied) out.push({ text: `${cats[0][0]} reply the most: ${cats[0][1].replied} of ${cats[0][1].messaged}. Find more of them?`, action: { label: "New search", run: onNewSearch } });
    if (data.waitingTotal && windowed(data.days, 7, "messaged").now < 20) out.push({ text: `${data.waitingTotal} top leads are waiting. About 10 messages a day keeps replies coming.` });
    out.push({ text: "When someone answers, mark them Replied. That's how this page learns what works." });
    return out;
  }, [data, me.name, me.link, onNewSearch]);

  const name = me.name?.trim().split(" ")[0];
  const hello = `${greeting()}${name ? `, ${name}` : ""}`;

  if (!data)
    return (
      <div className="home" aria-busy="true">
        <div className="home-top"><div><div className="sk sk-h1" /><div className="sk sk-p" /></div></div>
        <div className="bento">{[0, 1, 2, 3].map((i) => <div key={i} className={`tray sk-tray b${i}`} />)}</div>
      </div>
    );

  if (!data.searches)
    return (
      <div className="home">
        <section className="hero">
          <div>
            <span className="kicker">Welcome</span>
            <h1>{hello}. Let's find your first clients.</h1>
            <p>Pick an area and a few kinds of business. We find the ones with missing or weak websites, check how to reach them, and write your first WhatsApp message.</p>
            <button className="btn accent lg" onClick={onNewSearch}><IconPlus /> Start your first search</button>
          </div>
          <ol className="hero-steps">
            <li><b>1</b><span><strong>Search</strong> an area and business types</span></li>
            <li><b>2</b><span><strong>Message</strong> the best leads, message ready</span></li>
            <li><b>3</b><span><strong>Follow up</strong> and track who replies</span></li>
          </ol>
        </section>
      </div>
    );

  const n = mode === "week" ? 7 : 28;
  const vs = mode === "week" ? "last week" : "4 weeks before";
  const sent = windowed(data.days, n, "messaged");
  const replies = windowed(data.days, n, "replied");
  const r30 = windowed(data.days, 30, "replied"), m30 = windowed(data.days, 30, "messaged");
  const rate = { now: pct(r30.now, m30.now), prev: pct(r30.prev, m30.prev) };
  const won = windowed(data.days, 30, "won"), wonValue = windowed(data.days, 30, "wonValue");
  const spark = (k: keyof Omit<HomeDay, "date">) => data.days.slice(-14).map((d) => d[k]);
  const waitingReply = data.byStatus.contacted ?? 0;
  const talking = (data.byStatus.replied ?? 0) + (data.byStatus.meeting ?? 0);
  const todo = [due.length && `${due.length} follow-up${due.length > 1 ? "s" : ""} due`, data.waitingTotal && `${data.waitingTotal} top lead${data.waitingTotal > 1 ? "s" : ""} to message`].filter(Boolean) as string[];
  const tip = tipHidden ? null : tips[tipAt % Math.max(1, tips.length)];
  const TABS: Array<[Tab, string, number]> = [
    ...(due.length ? [["follow", "Follow up", due.length] as [Tab, string, number]] : []),
    ["next", "Message next", data.waitingTotal],
    ["recent", "Recent", data.recent.length],
  ];

  return (
    <div className="home">
      <header className="home-top">
        <div>
          <h1>{hello}!</h1>
          <p>{todo.length ? `Today you have ${todo.join(" and ")}.` : "You're all caught up. Time to find some new leads?"}</p>
        </div>
        <div className="home-actions">
          {data.latest && <button className="btn" onClick={() => onOpenSearch(data.latest!.id)}><IconHistory /> {data.latest.search}</button>}
          <button className="btn accent" onClick={onNewSearch}><IconPlus /> New search</button>
        </div>
      </header>

      <div className="bento">
        <section className="tray b-sum" aria-labelledby="h-sum">
          <div className="tray-head">
            <div>
              <h2 id="h-sum">Summary</h2>
              <p className="sub">How much you reached out.</p>
            </div>
            <label className="pill-select">
              <span className="sr-only">Period</span>
              <select value={mode} onChange={(e) => setMode(e.target.value as "week" | "month")}>
                <option value="week">Weekly</option>
                <option value="month">Monthly</option>
              </select>
            </label>
          </div>
          <div className="wcard sum-card">
            <div className="kpis">
              <div className="kpi">
                <span className="kpi-ic"><IconSend /></span>
                <span className="kpi-txt">
                  <span className="kpi-l">Messages sent</span>
                  <b className="kpi-v">{sent.now}</b>
                  <Delta {...sent} vs={vs} />
                </span>
              </div>
              <div className="kpi">
                <span className="kpi-ic"><IconReply /></span>
                <span className="kpi-txt">
                  <span className="kpi-l">Replies</span>
                  <b className="kpi-v">{replies.now}</b>
                  <Delta {...replies} vs={vs} />
                </span>
              </div>
            </div>
            <PeriodBars days={data.days} mode={mode} />
          </div>
        </section>

        <section className="tray b-act" aria-labelledby="h-act">
          <div className="tray-head">
            <div>
              <h2 id="h-act">Pipeline</h2>
              <p className="sub">Where your leads are right now.</p>
            </div>
            <div className="row tight">
              <button className="round" onClick={() => openTab("follow")} title="Follow-ups" aria-label="Show follow-ups"><IconCalendar /></button>
              <button className="round" onClick={onFindLeads} title="Find leads" aria-label="Open Find leads"><IconExpand /></button>
            </div>
          </div>
          <div className="act-grid">
            <article className="act-card">
              <header><span className="ac-ic"><IconSend /></span><b>Awaiting reply</b></header>
              <Delta now={windowed(data.days, 7, "messaged").now} prev={windowed(data.days, 7, "messaged").prev} vs="last week" />
              <b className="kpi-v big">{waitingReply}</b>
              <Spark values={spark("messaged")} />
            </article>
            <article className="act-card">
              <header><span className="ac-ic"><IconChat /></span><b>In talks</b></header>
              <Delta now={windowed(data.days, 7, "replied").now} prev={windowed(data.days, 7, "replied").prev} vs="last week" />
              <b className="kpi-v big">{talking}</b>
              <Spark values={spark("replied")} />
            </article>
            <article className="act-card dark">
              <header><span className="ac-ic"><IconCalendar /></span><b>Follow up</b></header>
              <span className="delta on-dark">{due.length ? (late ? `${late} overdue` : "All due today") : "Nothing due today"}</span>
              <b className="kpi-v big">{due.length}</b>
              <Upcoming days={data.upcoming} />
              {due.length > 0 && <button className="btn accent sm block-btn" onClick={() => openTab("follow")}>Start now</button>}
            </article>
          </div>
        </section>

        <div className="b-left">
          <div className="stat-pair">
            <section className="stat">
              <header><span className="ac-ic"><IconPercent /></span><span>Reply rate</span></header>
              <Delta now={rate.now} prev={rate.prev} vs="the 30 before" unit=" pts" />
              <b className="kpi-v">{rate.now}%</b>
              <span className="sub">Last 30 days</span>
            </section>
            <section className="stat">
              <header><span className="ac-ic"><IconTrophy /></span><span>Won</span></header>
              <Delta now={wonValue.now || won.now} prev={wonValue.now ? wonValue.prev : won.prev} vs="the 30 before" money={!!wonValue.now} />
              <b className="kpi-v">{wonValue.now ? rupees(wonValue.now) : won.now}</b>
              <span className="sub">{won.now} deal{won.now === 1 ? "" : "s"}, last 30 days</span>
            </section>
          </div>
          {tip && (
            <section className="tipcard" aria-label="Tip">
              <div>
                <p>{tip.text}</p>
                {tip.action && <button className="linkish" onClick={tip.action.run}>{tip.action.label} →</button>}
              </div>
              <button className="round" onClick={() => (tips.length > 1 ? setTipAt(tipAt + 1) : setTipHidden(true))} aria-label={tips.length > 1 ? "Next tip" : "Dismiss tip"} title={tips.length > 1 ? "Next tip" : "Dismiss"}><IconClose /></button>
            </section>
          )}
        </div>

        <section className="tray b-table" ref={tableRef} aria-labelledby="h-tab">
          <div className="tray-head">
            <div>
              <h2 id="h-tab">{current === "follow" ? "Follow up today" : current === "next" ? "Message next" : "Recent activity"}</h2>
              <p className="sub">{current === "follow" ? "Due today or overdue, from all your searches." : current === "next" ? "Your best leads not messaged yet, from all searches." : "The last leads you updated."}</p>
            </div>
            <div className="seg" role="tablist" aria-label="Lists">
              {TABS.map(([k, label, count]) => (
                <button key={k} role="tab" aria-selected={current === k} aria-pressed={current === k} onClick={() => setTab(k)}>
                  {label}{count ? <span className="seg-n">{count}</span> : null}
                </button>
              ))}
            </div>
          </div>
          <div className="wcard flush">
            {current === "follow" && (
              <table className="htable">
                <thead><tr><th>Business</th><th>Due</th><th className="right">Action</th></tr></thead>
                <tbody>
                  {due.map((d) => {
                    const l = d.lead as unknown as Lead;
                    const wa = whatsappLinkWith(l, followUpMessage(l, lang, me));
                    const when = d.lead.followUp!.followUpOn!;
                    return (
                      <tr key={`${d.searchId}/${l.id}`}>
                        <td>
                          <button className="biz" onClick={() => onOpenLead(d.searchId, l.id)}>
                            <Avatar name={l.name} />
                            <span><b>{l.name}</b><span className="sub">{d.lead.followUp?.note || `${l.category} · ${d.search}`}</span></span>
                          </button>
                        </td>
                        <td><span className={`due ${when < today ? "late" : "today"}`}>{dueLabel(when, today)}</span></td>
                        <td className="right">
                          <span className="row-acts">
                            {wa && <a className="btn wa sm" href={wa} target="_blank" rel="noreferrer" onClick={() => onUpdate(d.searchId, l, { followUpOn: addDays(3) })} title="Send a follow-up; the next reminder moves 3 days out"><IconWhatsApp /> Follow up</a>}
                            <button className="icon-act" onClick={() => onUpdate(d.searchId, l, { followUpOn: addDays(1) })} title="Remind me tomorrow" aria-label={`Remind me about ${l.name} tomorrow`}><IconCalendar /></button>
                            <button className="icon-act" onClick={() => onUpdate(d.searchId, l, { followUpOn: null })} title="Done: remove the reminder" aria-label={`Done with ${l.name}: remove the reminder`}><IconCheck /></button>
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
            {current === "next" &&
              (data.waiting.length ? (
                <table className="htable">
                  <thead><tr><th>Business</th><th className="hide-sm">Search</th><th className="hide-sm">Why</th><th className="right">Action</th></tr></thead>
                  <tbody>
                    {data.waiting.map((w) => {
                      const l = w as unknown as Lead;
                      const wa = whatsappLinkWith(l, pitchText(l, lang, toneFor(l, tone), me));
                      const chip = issueChips(l)[0];
                      return (
                        <tr key={`${w.searchId}/${w.id}`}>
                          <td>
                            <button className="biz" onClick={() => onOpenLead(w.searchId, w.id)}>
                              <span className={`score sm ${w.tier}`}><b>{w.score}</b></span>
                              <span><b>{w.name}</b><span className="sub">{w.category}</span></span>
                            </button>
                          </td>
                          <td className="hide-sm sub">{w.search}</td>
                          <td className="hide-sm">{chip && <span className={`tag ${chip.kind}`}>{chip.label}</span>}</td>
                          <td className="right">
                            {wa ? (
                              <a className="btn wa sm" href={wa} target="_blank" rel="noreferrer" onClick={() => onSent(w)} title="Opens WhatsApp with your message ready"><IconWhatsApp /> WhatsApp</a>
                            ) : (
                              <button className="btn sm" onClick={() => onOpenLead(w.searchId, w.id)}>Open</button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              ) : (
                <div className="empty-in"><b>Everyone's been messaged.</b><button className="btn sm" onClick={onNewSearch}><IconPlus /> Find new leads</button></div>
              ))}
            {current === "recent" &&
              (data.recent.length ? (
                <table className="htable">
                  <thead><tr><th>Business</th><th className="hide-sm">Search</th><th>Status</th><th className="hide-sm">When</th></tr></thead>
                  <tbody>
                    {data.recent.map((r) => (
                      <tr key={`${r.lead.searchId}/${r.lead.id}`}>
                        <td>
                          <button className="biz" onClick={() => onOpenLead(r.lead.searchId, r.lead.id)}>
                            <Avatar name={r.lead.name} />
                            <span><b>{r.lead.name}</b><span className="sub">{r.lead.category}</span></span>
                          </button>
                        </td>
                        <td className="hide-sm sub">{r.lead.search}</td>
                        <td>
                          <span className={`pill s-${r.status} pill-static`}><i className="pill-dot" />{FOLLOW_UP.find((s) => s.key === r.status)?.label ?? r.status}</span>
                          {r.lead.followUp?.value ? <span className="money">{rupees(r.lead.followUp.value)}</span> : null}
                        </td>
                        <td className="hide-sm sub">{ago(r.at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <div className="empty-in"><span className="sub">When you message leads and update their status, they show up here.</span></div>
              ))}
          </div>
        </section>
      </div>
    </div>
  );
}

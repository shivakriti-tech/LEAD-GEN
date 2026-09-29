"use client";

import { useMemo, useState } from "react";
import type { HomeData, HomeDay, HomeLead } from "@/lib/home";
import { windowed } from "@/lib/home";
import type { DueLead, FollowUpPatch } from "@/lib/followups";
import type { Lead } from "@/lib/types";
import { issueChips, localDate, pitchText, toneFor, whatsappLinkWith, FOLLOW_UP } from "@/lib/outreach";
import { FollowUpsToday } from "./FollowUps";
import { usePitch } from "./pitch";
import { IconArrow, IconBell, IconDown, IconSearch, IconUp, IconWhatsApp } from "./icons";

const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const dayOf = (d: string) => new Date(`${d}T12:00:00`);
const fmtDay = (d: string) => dayOf(d).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });
const rupees = (n: number) => `₹${n.toLocaleString("en-IN")}`;
const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);

function greeting(now = new Date()) {
  const h = now.getHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

function ago(iso: string): string {
  const mins = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  if (localDate(new Date(iso)) === localDate()) return `today, ${new Date(iso).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })}`;
  const days = Math.round((Date.now() - Date.parse(iso)) / 86_400_000);
  return days <= 1 ? "yesterday" : days < 7 ? `${days} days ago` : new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

/** "↗ +3 vs last week": up or down, and whether that's good. */
function Delta({ now, prev, period, money, unit = "" }: { now: number; prev: number; period: string; money?: boolean; unit?: string }) {
  const d = now - prev;
  if (!now && !prev) return <span className="delta flat">No change {period}</span>;
  const up = d > 0;
  return (
    <span className={`delta ${d === 0 ? "flat" : up ? "up" : "down"}`}>
      {d !== 0 && (up ? <IconUp /> : <IconDown />)}
      {d === 0 ? "Same as" : `${up ? "+" : "−"}${money ? rupees(Math.abs(d)) : Math.abs(d)}${unit} vs`} {period}
    </span>
  );
}

/** Messages you sent each day: one bar per day, today darker. Hover or tap a bar for its numbers. */
function DayBars({ days, label }: { days: HomeDay[]; label: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...days.map((d) => d.messaged));
  const n = days.length;
  const W = 100 / n;
  const today = localDate();
  const empty = days.every((d) => !d.messaged);
  const h = hover != null ? days[hover] : null;
  return (
    <div className="bars" onMouseLeave={() => setHover(null)}>
      <div className="bars-tip" aria-hidden="true">
        {h ? (
          <><b>{fmtDay(h.date)}</b> · {h.messaged} messaged{h.replied ? ` · ${h.replied} ${h.replied === 1 ? "reply" : "replies"}` : ""}</>
        ) : (
          <span className="sub">{empty ? "Send your first messages to see your days here." : `Most in a day: ${max}`}</span>
        )}
      </div>
      <div className="bars-plot" role="img" aria-label={label}>
        {days.map((d, i) => (
          <button
            key={d.date}
            type="button"
            className={`bar-slot ${hover === i ? "on" : ""}`}
            onMouseEnter={() => setHover(i)}
            onFocus={() => setHover(i)}
            onClick={() => setHover(i)}
            aria-label={`${fmtDay(d.date)}: ${d.messaged} messaged, ${d.replied} replies`}
          >
            <i className={`bar ${d.date === today ? "today" : ""} ${d.messaged ? "" : "zero"}`} style={{ height: d.messaged ? `${Math.max(4, (d.messaged / max) * 100)}%` : undefined }} />
          </button>
        ))}
      </div>
      <div className="bars-x" aria-hidden="true">
        {days.map((d, i) => (
          <span key={d.date} style={{ width: `${W}%` }}>
            {n <= 7 ? WEEKDAY[dayOf(d.date).getDay()] : i % 5 === 4 || i === n - 1 ? dayOf(d.date).getDate() : ""}
          </span>
        ))}
      </div>
      <table className="sr-only">
        <caption>{label}</caption>
        <thead><tr><th>Day</th><th>Messaged</th><th>Replies</th></tr></thead>
        <tbody>{days.map((d) => <tr key={d.date}><td>{fmtDay(d.date)}</td><td>{d.messaged}</td><td>{d.replied}</td></tr>)}</tbody>
      </table>
    </div>
  );
}

/** A small trend line: the last 14 days, the latest day marked. */
function Spark({ values, dark }: { values: number[]; dark?: boolean }) {
  const max = Math.max(1, ...values);
  const pts = values.map((v, i) => [(i / (values.length - 1)) * 100, 28 - (v / max) * 24] as const);
  const line = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const [lx, ly] = pts[pts.length - 1];
  return (
    <svg className={`spark ${dark ? "dark" : ""}`} viewBox="0 0 100 32" preserveAspectRatio="none" aria-hidden="true">
      <path className="spark-area" d={`${line} L100,32 L0,32 Z`} />
      <path className="spark-line" d={line} vectorEffect="non-scaling-stroke" />
      <circle className="spark-dot" cx={lx} cy={ly} r="2.2" />
    </svg>
  );
}

type Tip = { text: string; action?: { label: string; run: () => void } };

export function HomeView({
  data,
  due,
  onNewSearch,
  onOpenSearch,
  onOpenLead,
  onUpdate,
  onSent,
}: {
  data: HomeData | null;
  due: DueLead[];
  onNewSearch: () => void;
  onOpenSearch: (id: string) => void;
  onOpenLead: (searchId: string, leadId: string) => void;
  onUpdate: (searchId: string, lead: Pick<Lead, "id" | "name" | "followUp">, p: FollowUpPatch) => void;
  onSent: (lead: HomeLead) => void;
}) {
  const { lang, tone, me } = usePitch();
  const [range, setRange] = useState<7 | 30>(7);
  const [tipAt, setTipAt] = useState(0);
  const [showDue, setShowDue] = useState(false);
  const period = range === 7 ? "last week" : "previous 30 days";
  const today = localDate();
  const late = due.filter((d) => d.lead.followUp!.followUpOn! < today).length;

  const tips = useMemo<Tip[]>(() => {
    if (!data) return [];
    const out: Tip[] = [];
    if (!me.name) out.push({ text: "Add your name under Your details (in any lead's panel) so every message introduces you." });
    if (!me.link) out.push({ text: "Add a link to your work (a portfolio or Instagram) under Your details: it gives people a reason to reply." });
    const cats = Object.entries(data.byCategory).filter(([, c]) => c.messaged >= 5).sort((a, b) => b[1].replied / b[1].messaged - a[1].replied / a[1].messaged);
    if (cats.length && cats[0][1].replied) out.push({ text: `${cats[0][0]} reply most: ${cats[0][1].replied} of ${cats[0][1].messaged} you messaged. Search more of them?`, action: { label: "New search", run: onNewSearch } });
    const week = windowed(data.days, 7, "messaged").now;
    if (data.waitingTotal && week < 20) out.push({ text: `${data.waitingTotal} top leads are waiting. About 10 messages a day keeps replies coming.` });
    out.push({ text: "When someone answers, mark them Replied: it's how this screen learns what works." });
    return out;
  }, [data, me.name, me.link, onNewSearch]);

  if (!data) return <div className="home"><div className="panel home-loading"><span className="sub">Loading your numbers…</span></div></div>;

  const name = me.name?.trim().split(" ")[0];
  const days = data.days.slice(-range);
  const messaged = windowed(data.days, range, "messaged");
  const replied = windowed(data.days, range, "replied");
  const meetings = windowed(data.days, range, "meetings");
  const rate30 = { now: pct(windowed(data.days, 30, "replied").now, windowed(data.days, 30, "messaged").now), prev: pct(windowed(data.days, 60, "replied").now - windowed(data.days, 30, "replied").now, windowed(data.days, 60, "messaged").now - windowed(data.days, 30, "messaged").now) };
  const won = windowed(data.days, 30, "won");
  const wonValue = windowed(data.days, 30, "wonValue");
  const spark = (k: keyof Omit<HomeDay, "date">) => data.days.slice(-14).map((d) => d[k]);
  const todo = [due.length && `${due.length} follow-up${due.length > 1 ? "s" : ""} due${late ? ` (${late} overdue)` : ""}`, data.waitingTotal && `${data.waitingTotal} top lead${data.waitingTotal > 1 ? "s" : ""} not messaged yet`].filter(Boolean);
  const tip = tips[tipAt % Math.max(1, tips.length)];

  if (!data.searches)
    return (
      <div className="home">
        <header className="home-top">
          <div>
            <h1>{greeting()}{name ? `, ${name}` : ""}</h1>
            <p>Let's find your first clients. Pick an area and a few business types; we find the ones with weak or missing websites and write your first message.</p>
          </div>
          <button className="btn primary go-btn" onClick={onNewSearch}><IconSearch /> Start your first search</button>
        </header>
      </div>
    );

  return (
    <div className="home">
      <header className="home-top">
        <div>
          <h1>{greeting()}{name ? `, ${name}` : ""}</h1>
          <p>{todo.length ? `Today: ${todo.join(" · ")}.` : "You're all caught up. Find some new leads?"}</p>
        </div>
        <div className="row">
          {data.latest && <button className="btn" onClick={() => onOpenSearch(data.latest!.id)}>Open {data.latest.search}</button>}
          <button className="btn primary go-btn" onClick={onNewSearch}><IconSearch /> New search</button>
        </div>
      </header>

      <div className="bento">
        <section className="tray b-week" aria-labelledby="h-week">
          <div className="tray-head">
            <div>
              <h2 id="h-week">{range === 7 ? "Your week" : "Your month"}</h2>
              <span className="sub">Messages you sent each day</span>
            </div>
            <div className="seg" role="group" aria-label="Range">
              <button aria-pressed={range === 7} onClick={() => setRange(7)}>Week</button>
              <button aria-pressed={range === 30} onClick={() => setRange(30)}>Month</button>
            </div>
          </div>
          <div className="inner">
            <div className="kpis">
              <div className="kpi">
                <span className="kpi-l">Messaged</span>
                <b className="kpi-v">{messaged.now}</b>
                <Delta {...messaged} period={period} />
              </div>
              <div className="kpi">
                <span className="kpi-l">Replies</span>
                <b className="kpi-v">{replied.now}</b>
                <Delta {...replied} period={period} />
              </div>
            </div>
            <DayBars days={days} label={`Messages sent per day, ${range === 7 ? "last 7 days" : "last 30 days"}`} />
          </div>
        </section>

        <section className="tray b-pipe" aria-labelledby="h-pipe">
          <div className="tray-head">
            <div>
              <h2 id="h-pipe">Pipeline</h2>
              <span className="sub">Where your leads are now · trend over 14 days</span>
            </div>
          </div>
          <div className="pipe-grid">
            {([["contacted", "Contacted", "messaged"], ["replied", "Replied", "replied"], ["meeting", "Meetings", "meetings"]] as const).map(([st, label, k]) => {
              const w = windowed(data.days, range, k);
              return (
                <div key={st} className="pcard">
                  <span className={`pill s-${st} pill-static`}><i className="pill-dot" />{label}</span>
                  <b className="kpi-v">{data.byStatus[st] ?? 0}</b>
                  <span className="sub">{w.now} new {range === 7 ? "this week" : "in 30 days"}</span>
                  <Spark values={spark(k)} />
                </div>
              );
            })}
            <div className="pcard dark">
              <span className="pcard-l"><IconBell /> Follow up today</span>
              <b className="kpi-v">{due.length}</b>
              <span className="dark-sub">{due.length ? (late ? `${late} overdue` : "All due today") : "Nothing due. Nice."}</span>
              {due.length > 0 && (
                <button className="btn sm dark-btn" onClick={() => setShowDue(!showDue)} aria-expanded={showDue}>
                  {showDue ? "Hide" : "Start"} <IconArrow />
                </button>
              )}
            </div>
          </div>
        </section>

        {showDue && due.length > 0 && (
          <div className="b-full">
            <FollowUpsToday due={due} onUpdate={onUpdate} onOpen={onOpenLead} />
          </div>
        )}

        <div className="b-side">
          <div className="stat-pair">
            <section className="stat" aria-label="Reply rate">
              <span className="kpi-l">Reply rate · 30 days</span>
              <b className="kpi-v">{rate30.now}%</b>
              <Delta now={rate30.now} prev={rate30.prev} period="the 30 before" unit=" pts" />
            </section>
            <section className="stat" aria-label="Won this month">
              <span className="kpi-l">Won · 30 days</span>
              <b className="kpi-v">{wonValue.now ? rupees(wonValue.now) : won.now}</b>
              <span className="sub">{won.now} deal{won.now === 1 ? "" : "s"}{meetings.now ? ` · ${meetings.now} meeting${meetings.now > 1 ? "s" : ""}` : ""}</span>
            </section>
          </div>
          {tip && (
            <section className="tipcard" aria-label="Tip">
              <p>{tip.text}</p>
              <div className="row">
                {tip.action && <button className="btn sm" onClick={tip.action.run}>{tip.action.label}</button>}
                {tips.length > 1 && <button className="linkish" onClick={() => setTipAt(tipAt + 1)}>Next tip</button>}
              </div>
            </section>
          )}
        </div>

        <section className="tray b-next" aria-labelledby="h-next">
          <div className="tray-head">
            <div>
              <h2 id="h-next">Message next</h2>
              <span className="sub">{data.waitingTotal ? `Top leads you haven't messaged, from all your searches (${data.waitingTotal})` : "Top leads you haven't messaged"}</span>
            </div>
          </div>
          {data.waiting.length ? (
            <ul className="next-list">
              {data.waiting.map((l) => {
                const lead = l as unknown as Lead;
                const wa = whatsappLinkWith(lead, pitchText(lead, lang, toneFor(lead, tone), me));
                return (
                  <li key={`${l.searchId}/${l.id}`}>
                    <span className={`score sm ${l.tier}`}><b>{l.score}</b></span>
                    <button className="nl-name" onClick={() => onOpenLead(l.searchId, l.id)}>
                      <b>{l.name}</b>
                      <span className="sub">{l.category} · {l.search}</span>
                    </button>
                    <span className="nl-tags">{issueChips(lead).slice(0, 1).map((c) => <span key={c.label} className={`tag ${c.kind}`}>{c.label}</span>)}</span>
                    {wa ? (
                      <a className="btn wa sm" href={wa} target="_blank" rel="noreferrer" onClick={() => onSent(l)} title="Opens WhatsApp with your message ready"><IconWhatsApp /> WhatsApp</a>
                    ) : (
                      <button className="btn sm" onClick={() => onOpenLead(l.searchId, l.id)}>Open</button>
                    )}
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className="inner empty-in"><b>Everyone's been messaged.</b><button className="btn sm" onClick={onNewSearch}>Find new leads</button></div>
          )}
        </section>

        <section className="tray b-full" aria-labelledby="h-recent">
          <div className="tray-head">
            <div>
              <h2 id="h-recent">Recent activity</h2>
              <span className="sub">The last leads you updated</span>
            </div>
          </div>
          {data.recent.length ? (
            <div className="inner flush">
              <table className="recent-table">
                <thead><tr><th>Business</th><th className="hide-sm">Search</th><th>Status</th><th className="hide-sm">When</th><th className="hide-sm" /></tr></thead>
                <tbody>
                  {data.recent.map((r) => (
                    <tr key={`${r.lead.searchId}/${r.lead.id}`}>
                      <td><button className="nl-name" onClick={() => onOpenLead(r.lead.searchId, r.lead.id)}><b>{r.lead.name}</b><span className="sub">{r.lead.category}</span></button></td>
                      <td className="hide-sm sub">{r.lead.search}</td>
                      <td><span className={`pill s-${r.status} pill-static`}><i className="pill-dot" />{FOLLOW_UP.find((s) => s.key === r.status)?.label ?? r.status}</span>{r.lead.followUp?.value ? <span className="sub block">{rupees(r.lead.followUp.value)}</span> : null}</td>
                      <td className="hide-sm sub">{ago(r.at)}</td>
                      <td className="right hide-sm"><button className="btn sm" onClick={() => onOpenLead(r.lead.searchId, r.lead.id)}>Open</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="inner empty-in"><span className="sub">When you message leads and update their status, they show up here.</span></div>
          )}
        </section>
      </div>
    </div>
  );
}

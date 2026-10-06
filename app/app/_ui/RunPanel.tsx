"use client";

import { useEffect, useRef, useState } from "react";
import type { NotifyState } from "./runAlerts";
import type { Lead, SearchParams } from "@/lib/types";
import { IconCheck, IconStop } from "./icons";
import { hasAgencyReason } from "@/lib/score/agency";

type LogLine = { level: "info" | "warn" | "error"; message: string };
type Stage = { stage: string; done: number; total: number };

/** Where each pipeline stage sits in the checklist. */
const STEP_OF: Record<string, number> = { search: 0, dedupe: 0, verify: 1, enrich: 1, social: 2, speed: 3, score: 4, save: 4 };

/** 75 → "1:15" */
const clock = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

/**
 * While a search runs: what it's doing, step by step, with live counts, the time so far and an
 * estimate of what's left. The leads it has found are already in the list below, so you can start
 * messaging before it finishes, or turn on a notification and come back when it's done.
 */
export function RunPanel({
  where,
  params,
  stage,
  log,
  leads,
  running,
  stopping,
  onStop,
  startedAt,
  notify,
  onNotify,
}: {
  where: string;
  params: Pick<SearchParams, "pageSpeed" | "sources" | "sells"> | null;
  stage: Stage | null;
  log: LogLine[];
  leads: Lead[];
  running: boolean;
  stopping: boolean;
  onStop?: () => void;
  /** When the search started (ms), for the clock and the estimate. */
  startedAt?: number;
  notify?: NotifyState;
  onNotify?: () => void;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [running]);
  // pace of the checks, measured from the first one done: gives "about N min left"
  const pace = useRef<{ at: number; n: number } | null>(null);
  const logRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [log]);
  const checked = leads.filter((l) => !l.pending);
  const logistics = params?.sells === "logistics";
  const agency = params?.sells === "agency";
  const noSite = agency ? checked.filter(hasAgencyReason).length : logistics ? checked.filter((l) => l.signals.some((x) => x.key === "exports" || x.key === "imports")).length : checked.filter((l) => ["none", "social_only", "down"].includes(l.audit?.status ?? "none")).length;
  const hot = checked.filter((l) => l.tier === "hot").length;
  const cur = stage ? STEP_OF[stage.stage] ?? 0 : 0;
  const sawSocial = stage?.stage === "social" || log.some((l) => /Instagram profile/.test(l.message) && /Reading/.test(l.message));
  const steps = [
    { i: 0, label: "Finding businesses on maps and the web", n: [leads.length ? `${leads.length} found${stage?.stage === "search" ? " so far" : ""}` : "", stage?.stage === "search" && stage.total ? `${stage.done} of ${stage.total} searches` : ""].filter(Boolean).join(" · ") },
    { i: 1, label: "Checking each website and contact", n: leads.length ? `${checked.length} of ${leads.length}` : "" },
    ...(sawSocial ? [{ i: 2, label: "Reading Instagram profiles", n: stage?.stage === "social" ? `${stage.done} of ${stage.total}` : "" }] : []),
    ...(params?.pageSpeed ? [{ i: 3, label: "Testing mobile speed", n: stage?.stage === "speed" ? `${stage.done} of ${stage.total}` : "" }] : []),
    { i: 4, label: "Scoring and saving", n: "" },
  ];
  if (!running || !checked.length) pace.current = null;
  else if (!pace.current) pace.current = { at: now, n: checked.length };
  const elapsed = startedAt ? now - startedAt : 0;
  const left = leads.length - checked.length;
  let eta = "";
  if (running && pace.current && checked.length - pace.current.n >= 3 && left > 0) {
    const perMs = (checked.length - pace.current.n) / Math.max(1, now - pace.current.at);
    const mins = Math.ceil(left / perMs / 60_000);
    eta = mins <= 1 ? "under a minute left" : `about ${mins} min left`;
  } else if (running && cur >= 2) eta = "almost done";
  else if (running && cur === 0) eta = "finding businesses…";
  // overall progress: finding ~20%, checking ~70%, the rest ~10%
  const pct = !running ? 100 : cur === 0 ? (stage?.total ? (20 * stage.done) / stage.total : 3) : cur === 1 ? 20 + (leads.length ? (70 * checked.length) / leads.length : 0) : 92;
  const last = log[log.length - 1];
  const failed = !running && !leads.length && log.some((l) => l.level === "error");

  return (
    <section className="panel run" aria-live="polite">
      <div className="run-head">
        <div>
          <h2>{running ? (stopping ? "Stopping…" : `Looking around ${where}`) : failed ? "The search didn't finish" : "Search finished"}</h2>
          {running && <p className="sub">You can leave this page: it keeps going. Stop keeps everything found so far.</p>}
          {running && startedAt ? (
            <p className="run-time">
              <span className="mono">{clock(elapsed)}</span>
              {eta && <> · {eta}</>}
            </p>
          ) : null}
        </div>
        {running && onStop && (
          <button className="btn" onClick={onStop} disabled={stopping} title="Stop here: everything checked so far is kept and can be exported">
            <IconStop /> {stopping ? "Stopping…" : "Stop"}
          </button>
        )}
      </div>
      {running && (
        <div className="run-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)} aria-label="Search progress">
          <span style={{ width: `${Math.min(100, Math.max(3, pct))}%` }} />
        </div>
      )}
      {running && onNotify && notify !== "unsupported" && (
        <p className="run-notify">
          {notify === "on" ? (
            <>
              <b>We'll notify you when it's done.</b> Feel free to switch tabs. <button className="linkish" onClick={onNotify}>Turn off</button>
            </>
          ) : notify === "denied" ? (
            <>Notifications are blocked for this site in your browser. The tab's title shows the progress instead.</>
          ) : (
            <>
              Don't want to wait? <button className="linkish" onClick={onNotify}>Notify me when it's done</button> and switch tabs: the tab's title shows the progress.
            </>
          )}
        </p>
      )}
      <ol className="steps">
        {steps.map((s) => {
          const state = !running ? "done" : s.i < cur ? "done" : s.i === cur ? "active" : "wait";
          return (
            <li key={s.i} className={`step-row ${state}`}>
              <span className="ic" aria-hidden="true">{state === "done" && <IconCheck />}</span>
              <span>{s.label}</span>
              <span className="n">{s.n}</span>
              <span className="sr-only">{state === "done" ? "done" : state === "active" ? "working" : "waiting"}</span>
            </li>
          );
        })}
      </ol>
      {running && checked.length > 0 && (
        <p className="found">
          Already spotted <b>{noSite} {logistics ? `that export or import` : agency ? "with a clear reason to pitch" : "without a working website"}</b>{hot ? <>, <b>{hot}</b> worth messaging first</> : null}. They're in the list below: you can message them now.
        </p>
      )}
      {last && (running || failed) && <p className={`last-log ${last.level}`}>{last.message}</p>}
      {log.length > 1 && (
        <details>
          <summary>Full log ({log.length})</summary>
          <div className="log" ref={logRef}>{log.map((l, i) => <div key={i} className={l.level}>{l.message}</div>)}</div>
        </details>
      )}
    </section>
  );
}

"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import type { Lead } from "@/lib/types";
import { emailLink, firstMessage, issueChips, mapsLink, scoreSummary, shortAddress, telLink, whatsappLinkWith, type Lang } from "@/lib/outreach";
import type { FollowUpPatch } from "@/lib/followups";
import { DueChip, StatusMenu } from "./StatusMenu";
import { PitchBox } from "./PitchBox";
import { IconCheck, IconCopy, IconMail, IconMap, IconPhone, IconWhatsApp } from "./icons";

export const TIER_LABEL = { hot: "Hot", warm: "Warm", cold: "Cold" } as const;
export const fmtPhone = (p?: string) => (p && /^\+91\d{10}$/.test(p) ? `+91 ${p.slice(3, 8)} ${p.slice(8)}` : p ?? "");

/** Score + tier. Tap it to see what the score is made of. */
export function ScoreBadge({ lead, size = "md" }: { lead: Lead; size?: "sm" | "md" }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [open]);
  if (lead.pending) return <span className={`score ${size} pending`} title="Still checking this business">…</span>;
  return (
    <span className="score-wrap" ref={ref}>
      <button
        type="button"
        className={`score ${size} ${lead.tier}`}
        title={`${lead.score}: ${scoreSummary(lead)}`}
        aria-label={`Score ${lead.score}, ${TIER_LABEL[lead.tier]}. Why?`}
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation();
          setOpen(!open);
        }}
      >
        <b>{lead.score}</b>
        <small>{TIER_LABEL[lead.tier]}</small>
      </button>
      {open && (
        <span className="why-pop" role="tooltip" onClick={(e) => e.stopPropagation()}>
          <b>Why {lead.score}?</b>
          {lead.signals.map((s) => (
            <span key={s.key} className="why-line">
              <span>{s.label}</span>
              <span className={`pts ${s.points < 0 ? "neg" : ""}`}>{s.points > 0 ? "+" : ""}{s.points}</span>
            </span>
          ))}
          {!lead.signals.length && <span className="sub">Nothing counted.</span>}
        </span>
      )}
    </span>
  );
}

interface RowProps {
  lead: Lead;
  selected: boolean;
  onSelect: () => void;
  open: boolean;
  onOpen: () => void;
  pitchOpen: boolean;
  onTogglePitch: () => void;
  lang: Lang;
  setLang: (l: Lang) => void;
  sender: string;
  draft?: string;
  setDraft: (t: string | undefined) => void;
  onSent: () => void;
  onFollowUp: (p: FollowUpPatch) => void;
  locked: boolean;
}

/** WhatsApp first; pitch, copy and the rest as smaller buttons. */
function Actions({ lead: l, pitchOpen, onTogglePitch, lang, sender, draft, onSent }: RowProps) {
  const [copied, setCopied] = useState(false);
  const text = draft ?? firstMessage(l, lang, sender);
  const wa = whatsappLinkWith(l, text);
  const mail = emailLink(l, sender);
  const copy = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard?.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }, () => {});
  };
  return (
    <div className="actions" onClick={(e) => e.stopPropagation()}>
      {wa ? (
        <a className="btn wa sm" href={wa} target="_blank" rel="noreferrer" onClick={onSent} title="Open WhatsApp with the pitch already typed">
          <IconWhatsApp /> WhatsApp
        </a>
      ) : (
        <span className="btn sm ghost" title="No mobile number found">No WhatsApp</span>
      )}
      <button type="button" className={`btn sm ${pitchOpen ? "on" : ""}`} onClick={onTogglePitch} aria-expanded={pitchOpen} title={pitchOpen ? "Hide the pitch" : "Read and edit the pitch"}>
        Pitch
      </button>
      <button type="button" className="icon-act" onClick={copy} title="Copy pitch" aria-label="Copy pitch">{copied ? <IconCheck /> : <IconCopy />}</button>
      {l.phone && <a className="icon-act" href={telLink(l.phone)} title={`Call ${fmtPhone(l.phone)}`} aria-label={`Call ${fmtPhone(l.phone)}`}><IconPhone /></a>}
      {mail && <a className="icon-act" href={mail} title={`Email ${l.email}`} aria-label={`Email ${l.email}`}><IconMail /></a>}
      <a className="icon-act" href={mapsLink(l)} target="_blank" rel="noreferrer" title="Open in Google Maps" aria-label="Open in Google Maps"><IconMap /></a>
    </div>
  );
}

function Check({ checked, onChange, label }: { checked: boolean; onChange: () => void; label: string }) {
  return (
    <label className="sel" onClick={(e) => e.stopPropagation()}>
      <input type="checkbox" checked={checked} onChange={onChange} aria-label={label} />
    </label>
  );
}

function Chips({ lead: l, max = 3 }: { lead: Lead; max?: number }) {
  if (l.pending) return <span className="tag">Checking website…</span>;
  return (
    <>
      {issueChips(l).slice(0, max).map((c) => <span key={c.label} className={`tag ${c.kind}`}>{c.label}</span>)}
      {l.chain && <span className="tag" title={l.chain.reason}>Chain</span>}
    </>
  );
}

function CardRow(p: RowProps) {
  const l = p.lead;
  const where = shortAddress(l.address, l.city);
  return (
    <article className={`card ${p.open ? "active" : ""} ${p.selected ? "picked" : ""} ${l.pending ? "is-pending" : ""}`} aria-label={l.name} onClick={p.onOpen}>
      <div className="card-top">
        <Check checked={p.selected} onChange={p.onSelect} label={`Select ${l.name}`} />
        <ScoreBadge lead={l} />
        <div className="card-id">
          <button type="button" className="name-btn" onClick={(e) => { e.stopPropagation(); p.onOpen(); }}>{l.name}</button>
          <span className="card-meta">
            {l.category}{where ? ` · ${where}` : ""}
            {l.rating != null ? <> · {l.rating.toFixed(1)}★ ({l.reviews ?? 0})</> : null}
          </span>
        </div>
        <div className="card-status" onClick={(e) => e.stopPropagation()}>
          <DueChip lead={l} />
          <StatusMenu lead={l} onChange={p.onFollowUp} disabled={p.locked} />
        </div>
      </div>
      <p className="card-why"><span className="chips-inline"><Chips lead={l} /></span>{l.pending ? "Checking its website and contacts…" : l.whyNow}</p>
      <Actions {...p} />
      {p.pitchOpen && (
        <div onClick={(e) => e.stopPropagation()}>
          <PitchBox lead={l} lang={p.lang} setLang={p.setLang} sender={p.sender} draft={p.draft} setDraft={p.setDraft} onSent={p.onSent} autoFocus />
        </div>
      )}
    </article>
  );
}

export function LeadList({
  leads,
  view,
  selected,
  onToggleSelect,
  onToggleAll,
  openId,
  onOpen,
  pitchId,
  onTogglePitch,
  lang,
  setLang,
  sender,
  drafts,
  setDraft,
  onSent,
  onFollowUp,
  locked,
}: {
  leads: Lead[];
  view: "cards" | "table";
  selected: Set<string>;
  onToggleSelect: (id: string) => void;
  onToggleAll: () => void;
  openId: string | null;
  onOpen: (id: string) => void;
  pitchId: string | null;
  onTogglePitch: (id: string) => void;
  lang: Lang;
  setLang: (l: Lang) => void;
  sender: string;
  drafts: Record<string, string>;
  setDraft: (id: string, t: string | undefined) => void;
  onSent: (l: Lead) => void;
  onFollowUp: (l: Lead, p: FollowUpPatch) => void;
  locked: boolean;
}) {
  const row = (l: Lead): RowProps => ({
    lead: l,
    selected: selected.has(l.id),
    onSelect: () => onToggleSelect(l.id),
    open: openId === l.id,
    onOpen: () => onOpen(l.id),
    pitchOpen: pitchId === l.id,
    onTogglePitch: () => onTogglePitch(l.id),
    lang,
    setLang,
    sender,
    draft: drafts[l.id],
    setDraft: (t) => setDraft(l.id, t),
    onSent: () => onSent(l),
    onFollowUp: (p) => onFollowUp(l, p),
    locked,
  });
  const all = leads.length > 0 && leads.every((l) => selected.has(l.id));

  if (view === "cards")
    return (
      <div className="cards">
        {leads.map((l) => <CardRow key={l.id} {...row(l)} />)}
      </div>
    );

  return (
    <div className="table-wrap">
      <table className="leads-table">
        <thead>
          <tr>
            <th className="c-sel"><Check checked={all} onChange={onToggleAll} label="Select all shown" /></th>
            <th className="c-score">Score</th>
            <th>Business</th>
            <th className="c-problem">Problem</th>
            <th className="c-status">Status</th>
            <th className="c-act">Reach out</th>
          </tr>
        </thead>
        <tbody>
          {leads.map((l) => {
            const p = row(l);
            const where = shortAddress(l.address, l.city);
            return (
              <Fragment key={l.id}>
                <tr className={`${p.open ? "active" : ""} ${p.selected ? "picked" : ""} ${l.pending ? "is-pending" : ""}`} onClick={p.onOpen}>
                  <td className="c-sel"><Check checked={p.selected} onChange={p.onSelect} label={`Select ${l.name}`} /></td>
                  <td className="c-score"><ScoreBadge lead={l} size="sm" /></td>
                  <td className="c-biz">
                    <button type="button" className="name-btn" onClick={(e) => { e.stopPropagation(); p.onOpen(); }}>{l.name}</button>
                    <span className="card-meta">{l.category}{where ? ` · ${where}` : ""}</span>
                    <span className="t-chips"><Chips lead={l} max={2} /></span>
                  </td>
                  <td className="c-problem"><span className="chips-col"><Chips lead={l} max={2} /></span></td>
                  <td className="c-status" onClick={(e) => e.stopPropagation()}>
                    <StatusMenu lead={l} onChange={p.onFollowUp} disabled={locked} />
                    <DueChip lead={l} />
                  </td>
                  <td className="c-act"><Actions {...p} /></td>
                </tr>
                {p.pitchOpen && (
                  <tr className="pitch-row">
                    <td colSpan={6}>
                      <PitchBox lead={l} lang={lang} setLang={setLang} sender={sender} draft={p.draft} setDraft={p.setDraft} onSent={p.onSent} autoFocus />
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Grey placeholder rows while the first results are on their way. */
export function Skeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="cards" aria-hidden="true">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="card skel">
          <span className="sk sk-badge" />
          <span className="sk-lines"><span className="sk sk-l1" /><span className="sk sk-l2" /><span className="sk sk-l3" /></span>
        </div>
      ))}
    </div>
  );
}

"use client";

import type { Lead } from "@/lib/types";
import { emailLink, FOLLOW_UP, issueChips, mapsLink, shortAddress, telLink, whatsappLink, type FollowUpStatus, type Lang } from "@/lib/outreach";
import { IconMail, IconMap, IconPhone, IconWhatsApp } from "./icons";

export const TIER_LABEL = { hot: "Hot", warm: "Warm", cold: "Cold" } as const;
export const fmtPhone = (p?: string) => (p && /^\+91\d{10}$/.test(p) ? `+91 ${p.slice(3, 8)} ${p.slice(8)}` : p ?? "");

export function ScoreBadge({ lead }: { lead: Lead }) {
  if (lead.pending) return <span className="score pending" title="Still checking this business">…</span>;
  return (
    <span className={`score ${lead.tier}`} title={`Opportunity score ${lead.score} out of 100`}>
      <b>{lead.score}</b>
      <small>{TIER_LABEL[lead.tier]}</small>
    </span>
  );
}

export function StatusSelect({ lead, onChange, disabled, compact }: { lead: Lead; onChange: (s: FollowUpStatus) => void; disabled?: boolean; compact?: boolean }) {
  const cur = lead.followUp?.status ?? "new";
  return (
    <select
      className={`status-select s-${cur} ${compact ? "compact" : ""}`}
      value={cur}
      onChange={(e) => onChange(e.target.value as FollowUpStatus)}
      disabled={disabled}
      aria-label={`Status of ${lead.name}`}
      title={disabled ? "You can set statuses once the search has finished" : "What you've done with this lead"}
    >
      {FOLLOW_UP.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
    </select>
  );
}

export function LeadCard({
  lead: l,
  active,
  lang,
  sender,
  onOpen,
  onStatus,
  statusDisabled,
}: {
  lead: Lead;
  active: boolean;
  lang: Lang;
  sender: string;
  onOpen: () => void;
  onStatus: (s: FollowUpStatus) => void;
  statusDisabled: boolean;
}) {
  const where = shortAddress(l.address, l.city);
  const chips = issueChips(l);
  const wa = whatsappLink(l, lang, sender);
  const mail = emailLink(l, sender);
  const done = l.followUp?.status && l.followUp.status !== "new";
  return (
    <article className={`card ${active ? "active" : ""} ${l.pending ? "is-pending" : ""} ${done ? "is-done" : ""}`} aria-label={l.name}>
      <button className="card-main" onClick={onOpen} aria-haspopup="dialog" aria-expanded={active}>
        <ScoreBadge lead={l} />
        <span className="card-body">
          <span className="card-title">
            <h3>{l.name}</h3>
            {l.chain && <span className="tag" title={l.chain.reason}>Chain</span>}
          </span>
          <span className="card-meta">
            {l.category}
            {where ? ` · ${where}` : ""}
            {l.rating != null ? <> · <span className="stars">{l.rating.toFixed(1)}★</span> ({l.reviews ?? 0})</> : null}
          </span>
          <span className="signals">
            {l.pending ? <span className="tag">Checking website…</span> : chips.map((c) => <span key={c.label} className={`tag ${c.kind}`}>{c.label}</span>)}
            {l.owner && <span className="tag plain">Owner known</span>}
          </span>
          <span className="card-why">{l.pending ? "Checking its website and contacts…" : l.whyNow}</span>
        </span>
      </button>
      <div className="card-actions">
        {l.phone ? (
          <a className="act" href={telLink(l.phone)} title={`Call ${fmtPhone(l.phone)}`}><IconPhone /><span>{fmtPhone(l.phone)}</span></a>
        ) : (
          <span className="act none">No phone</span>
        )}
        {wa && <a className="act wa" href={wa} target="_blank" rel="noreferrer" title={`WhatsApp with a ready-written message (${lang === "hi" ? "Hinglish" : "English"})`}><IconWhatsApp /><span>WhatsApp</span></a>}
        {mail && <a className="act" href={mail} title={`Email ${l.email}`}><IconMail /><span>Email</span></a>}
        <a className="act icon-only" href={mapsLink(l)} target="_blank" rel="noreferrer" title="Open in Google Maps" aria-label="Open in Google Maps"><IconMap /></a>
        <span className="grow" />
        <StatusSelect lead={l} onChange={onStatus} disabled={statusDisabled} compact />
      </div>
    </article>
  );
}

"use client";

import { useCallback, useEffect, useState } from "react";
import { FOLLOW_UP } from "@/lib/outreach";
import type { FollowUpPatch } from "@/lib/followups";
import { IconClose, IconCopy, IconSend } from "./icons";

/**
 * Pipeline (the mini CRM): every lead that replied, across all searches. Move it along, set the
 * deal value and next date, and hand interested leads to a client (charged in credits). The
 * client's own link tells you how it went: contacted, meeting, won, lost, or not a real lead.
 */

type Column = "replied" | "meeting" | "handed" | "won" | "lost";
const COLUMNS: Array<{ key: Column; label: string }> = [
  { key: "replied", label: "Replied: your turn" },
  { key: "meeting", label: "Meeting" },
  { key: "handed", label: "With a client" },
  { key: "won", label: "Won" },
  { key: "lost", label: "Lost" },
];
const HANDOFF_LABEL: Record<string, string> = { sent: "Sent to client", contacted: "Client contacted them", meeting: "Meeting booked", won: "Won", lost: "Lost", rejected: "Not a real lead" };

type Item = {
  searchId: string;
  search: string;
  column: Column;
  lead: { id: string; name: string; category: string; city?: string; email?: string; phone?: string; phones: string[]; whyNow: string; followUp?: { status: string; note?: string; followUpOn?: string; value?: number; updatedAt: string } };
  handoff?: { id: string; clientName: string; status: string; value?: number; createdAt: string };
};
type Client = { id: string; name: string; email?: string; balance: number; low: boolean; creditsPerLead: number };

const money = (n?: number) => (n ? n.toLocaleString("en-IN") : "");

export function PipelineView({ onOpenLead }: { onOpenLead: (searchId: string, leadId: string) => void }) {
  const [d, setD] = useState<{ leads: Item[]; clients: Client[] } | null>(null);
  const [handing, setHanding] = useState<Item | null>(null);
  const [msg, setMsg] = useState("");
  const load = useCallback(() => fetch("/api/crm").then((r) => r.json()).then(setD).catch(() => setD({ leads: [], clients: [] })), []);
  useEffect(() => void load(), [load]);

  const patch = async (it: Item, p: FollowUpPatch) => {
    const r = await fetch(`/api/searches/${it.searchId}/leads/${it.lead.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(p) });
    setMsg(r.ok ? "" : "Couldn't save that. Try again.");
    load();
  };
  const outcome = async (it: Item, status: string) => {
    const value = status === "won" ? Number(prompt("Deal value (optional)", String(it.handoff?.value ?? "")) || 0) || undefined : undefined;
    const r = await fetch(`/api/crm/handoff/${it.handoff!.id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status, value }) });
    const j = await r.json().catch(() => ({}));
    setMsg(r.ok ? (j.refunded ? "Saved; the lead's credits were refunded." : "") : j.error ?? "Couldn't save");
    load();
  };

  if (!d) return <p className="sub">Loading…</p>;
  const won = d.leads.filter((x) => x.column === "won").reduce((t, x) => t + (x.lead.followUp?.value ?? x.handoff?.value ?? 0), 0);
  return (
    <section className="crm">
      <div className="top">
        <div>
          <h1>Pipeline</h1>
          <p>Everyone who replied, from every search. Book the meeting, hand interested leads to a client, and see what they won. {won ? <b>Won so far: {money(won)}</b> : null}</p>
        </div>
      </div>
      {!!d.clients.length && (
        <div className="row gap wrap">
          {d.clients.map((c) => <span key={c.id} className={`tag ${c.low ? "warn" : ""}`} title={`${c.creditsPerLead} credit${c.creditsPerLead === 1 ? "" : "s"} per lead`}>{c.name}: {c.balance} credits{c.low ? " (low)" : ""}</span>)}
        </div>
      )}
      {msg && <p className="note">{msg}</p>}
      {!d.leads.length ? (
        <div className="panel bsec"><p className="sub">No replies yet. Leads land here when they reply (found in your inbox) or when you set their status to Replied, Meeting, Won or Lost.</p></div>
      ) : (
        <div className="board">
          {COLUMNS.map((col) => {
            const list = d.leads.filter((x) => x.column === col.key);
            return (
              <div className="board-col" key={col.key}>
                <h2>{col.label} <span className="count">{list.length}</span></h2>
                {list.map((it) => (
                  <article className="panel deal" key={`${it.searchId}|${it.lead.id}`}>
                    <button className="linkish deal-name" onClick={() => onOpenLead(it.searchId, it.lead.id)}>{it.lead.name}</button>
                    <span className="sub">{[it.lead.category, it.lead.city].filter(Boolean).join(" · ")}</span>
                    {it.lead.followUp?.note && <span className="sub deal-note">{it.lead.followUp.note}</span>}
                    {it.handoff ? (
                      <label className="field">
                        <span className="lbl">{it.handoff.clientName} <span className="opt">since {it.handoff.createdAt.slice(0, 10)}</span></span>
                        <select value={it.handoff.status} onChange={(e) => outcome(it, e.target.value)}>
                          {Object.entries(HANDOFF_LABEL).map(([k, v]) => <option key={k} value={k} disabled={k === "sent"}>{v}</option>)}
                        </select>
                      </label>
                    ) : (
                      <div className="deal-row">
                        <select aria-label="Status" value={it.lead.followUp?.status ?? "replied"} onChange={(e) => patch(it, { status: e.target.value })}>
                          {FOLLOW_UP.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                        </select>
                        <input aria-label="Next date" type="date" value={it.lead.followUp?.followUpOn ?? ""} onChange={(e) => patch(it, { followUpOn: e.target.value || null })} />
                      </div>
                    )}
                    {col.key === "won" && !it.handoff && (
                      <input aria-label="Deal value" type="number" min={0} placeholder="Deal value" defaultValue={it.lead.followUp?.value ?? ""} onBlur={(e) => patch(it, { value: e.target.value ? Number(e.target.value) : null })} />
                    )}
                    {(col.key === "replied" || col.key === "meeting") && !!d.clients.length && (
                      <button className="btn sm" onClick={() => setHanding(it)}><IconSend /> Hand off to client</button>
                    )}
                  </article>
                ))}
              </div>
            );
          })}
        </div>
      )}
      {handing && <HandoffDialog item={handing} clients={d.clients} onClose={() => { setHanding(null); load(); }} />}
    </section>
  );
}

function HandoffDialog({ item, clients, onClose }: { item: Item; clients: Client[]; onClose: () => void }) {
  const [clientId, setClientId] = useState(clients.find((c) => c.balance >= c.creditsPerLead)?.id ?? clients[0].id);
  const [note, setNote] = useState("");
  const [email, setEmail] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState<{ link?: string; message: { subject: string; text: string }; emailed?: string; emailError?: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const c = clients.find((x) => x.id === clientId)!;
  const send = async () => {
    setBusy(true);
    setError("");
    const r = await fetch("/api/crm/handoff", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ searchId: item.searchId, leadId: item.lead.id, clientId, note, email: email && !!c.email }) });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) return setError(j.error ?? "Couldn't hand it off");
    setDone(j);
  };
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="ho-title">
        <header className="drawer-head">
          <div className="drawer-title"><h2 id="ho-title">Hand off {item.lead.name}</h2><span className="sub">The client gets the lead, what they said and a link to report how it went.</span></div>
          <button className="icon-btn" onClick={onClose} aria-label="Close"><IconClose /></button>
        </header>
        <div className="ho-body">
          {!done ? (
            <>
              <label className="field">
                <span className="lbl">Client</span>
                <select value={clientId} onChange={(e) => setClientId(e.target.value)}>
                  {clients.map((x) => <option key={x.id} value={x.id}>{x.name} ({x.balance} credits)</option>)}
                </select>
              </label>
              <p className="sub">Costs {c.creditsPerLead} credit{c.creditsPerLead === 1 ? "" : "s"}; refunded if they mark it "Not a real lead" within 7 days.</p>
              <label className="field"><span className="lbl">Note for the client <span className="opt">optional</span></span><textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Wants a call Thursday after 3pm" /></label>
              <label className="check"><input type="checkbox" checked={email && !!c.email} disabled={!c.email} onChange={(e) => setEmail(e.target.checked)} /><span><b>Email it to {c.email ?? "the client"}</b><small>{c.email ? "From your first mailbox" : "Add the client's email in their profile to send it from here"}</small></span></label>
              {error && <p className="note">{error}</p>}
              <div className="row gap"><button className="btn primary" disabled={busy} onClick={send}>{busy ? "Handing off…" : "Hand off"}</button><button className="btn" onClick={onClose}>Cancel</button></div>
            </>
          ) : (
            <>
              <p>{done.emailed ? <>Sent to <b>{done.emailed}</b>.</> : done.emailError ? <>Handed off; email not sent ({done.emailError}).</> : "Handed off."} {done.link ? "Their link is in the message." : "Set APP_BASE_URL so the client can report outcomes themselves; until then, update it here."}</p>
              <label className="field"><span className="lbl">Message <span className="opt">copy it to WhatsApp if you like</span></span><textarea rows={10} readOnly value={done.message.text} /></label>
              <div className="row gap">
                <button className="btn" onClick={() => { navigator.clipboard?.writeText(done.message.text); setCopied(true); }}><IconCopy /> {copied ? "Copied" : "Copy"}</button>
                <button className="btn primary" onClick={onClose}>Done</button>
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}

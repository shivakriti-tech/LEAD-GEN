"use client";

import { useCallback, useEffect, useState } from "react";
import { IconClose, IconReport } from "./icons";

/** A client's credits: balance, price per lead, top-ups, exclusive areas, history and statements. */

type Account = { creditsPerLead: number; pricePerCredit: number; currency: string; taxRate: number; taxLabel: string; allowOverdraft: boolean; territories: string[] };
type Entry = { id: string; at: string; kind: "topup" | "charge" | "refund" | "adjust"; credits: number; amount?: number; note?: string; receipt?: string };
type Handoff = { id: string; lead: { name: string }; status: string; value?: number; createdAt: string };
const KIND = { topup: "Top-up", charge: "Lead", refund: "Refund", adjust: "Adjustment" } as const;
const STATUS: Record<string, string> = { sent: "Sent", contacted: "Contacted", meeting: "Meeting", won: "Won", lost: "Lost", rejected: "Not a real lead" };

export function BillingPanel({ client, onClose }: { client: { id: string; name: string }; onClose: () => void }) {
  const [d, setD] = useState<{ account: Account; balance: number; low: boolean; entries: Entry[]; handoffs: Handoff[] } | null>(null);
  const [acc, setAcc] = useState<Account | null>(null);
  const [top, setTop] = useState({ credits: "", amount: "", note: "" });
  const [area, setArea] = useState({ city: "", type: "" });
  const [msg, setMsg] = useState("");
  const month = new Date().toISOString().slice(0, 7);
  const load = useCallback(() => fetch(`/api/billing/${client.id}`).then((r) => r.json()).then((x) => { setD(x); setAcc(x.account); }), [client.id]);
  useEffect(() => void load(), [load]);
  const post = async (body: object, ok: string) => {
    const r = await fetch(`/api/billing/${client.id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    setMsg(r.ok ? ok : j.error ?? "Couldn't save");
    load();
    return r.ok;
  };
  if (!d || !acc) return null;
  const set = <K extends keyof Account>(k: K, v: Account[K]) => setAcc({ ...acc, [k]: v });
  const fmt = (n: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: acc.currency, maximumFractionDigits: 2 }).format(n);
  const won = d.handoffs.filter((h) => h.status === "won");
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className="modal billing" role="dialog" aria-modal="true" aria-labelledby="bill-title">
        <header className="drawer-head">
          <div className="drawer-title">
            <h2 id="bill-title">{client.name}: credits</h2>
            <span className="sub">Each interested lead you hand them costs credits. Leads they mark "Not a real lead" within 7 days are refunded.</span>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close"><IconClose /></button>
        </header>
        <div className="ho-body">
          <div className="bill-kpis">
            <div><b className={d.low ? "warn-text" : ""}>{d.balance}</b><span>credits left{d.low ? " (low)" : ""}</span></div>
            <div><b>{d.handoffs.filter((h) => h.status !== "rejected").length}</b><span>leads handed off</span></div>
            <div><b>{won.length}</b><span>won{won.some((h) => h.value) ? `, ${fmt(won.reduce((t, h) => t + (h.value ?? 0), 0))}` : ""}</span></div>
          </div>
          {msg && <p className="note">{msg}</p>}

          <section className="bsec">
            <h3>Add a top-up</h3>
            <p className="sub">Record a payment you received (bank, UPI, Stripe, Razorpay…). It gets a receipt number on the statement.</p>
            <div className="bill-grid">
              <label className="field"><span className="lbl">Credits</span><input type="number" min={1} value={top.credits} onChange={(e) => setTop({ ...top, credits: e.target.value })} /></label>
              <label className="field"><span className="lbl">Amount paid ({acc.currency})</span><input type="number" min={0} value={top.amount} onChange={(e) => setTop({ ...top, amount: e.target.value })} placeholder={acc.pricePerCredit && top.credits ? String(Number(top.credits) * acc.pricePerCredit) : ""} /></label>
              <label className="field wide"><span className="lbl">Note</span><input type="text" value={top.note} onChange={(e) => setTop({ ...top, note: e.target.value })} placeholder="e.g. UPI ref 4821…" /></label>
            </div>
            <button className="btn primary sm" disabled={!Number(top.credits)} onClick={async () => (await post({ action: "topup", credits: Number(top.credits), amount: top.amount ? Number(top.amount) : undefined, note: top.note }, "Top-up added.")) && setTop({ credits: "", amount: "", note: "" })}>Add top-up</button>
          </section>

          <section className="bsec">
            <h3>Pricing</h3>
            <div className="bill-grid">
              <label className="field"><span className="lbl">Credits per lead</span><input type="number" min={0} value={acc.creditsPerLead} onChange={(e) => set("creditsPerLead", Number(e.target.value))} /></label>
              <label className="field"><span className="lbl">Price per credit</span><input type="number" min={0} value={acc.pricePerCredit} onChange={(e) => set("pricePerCredit", Number(e.target.value))} /></label>
              <label className="field"><span className="lbl">Currency</span><select value={acc.currency} onChange={(e) => set("currency", e.target.value)}>{["INR", "USD", "CAD", "AED", "SAR", "QAR", "KWD", "OMR", "BHD", "AUD", "NZD", "EUR", "GBP"].map((c) => <option key={c}>{c}</option>)}</select></label>
              <label className="field"><span className="lbl">Tax %</span><input type="number" min={0} max={50} value={acc.taxRate} onChange={(e) => set("taxRate", Number(e.target.value))} /></label>
              <label className="field"><span className="lbl">Tax name</span><input type="text" value={acc.taxLabel} onChange={(e) => set("taxLabel", e.target.value)} /></label>
            </div>
            <label className="check"><input type="checkbox" checked={acc.allowOverdraft} onChange={(e) => set("allowOverdraft", e.target.checked)} /><span><b>Keep handing off when credits run out</b><small>The balance goes below zero; settle it later</small></span></label>
            <h3>Exclusive areas</h3>
            <p className="sub">Leads in these city + business type pairs go only to {client.name}.</p>
            <div className="chips">{acc.territories.map((t) => <button key={t} type="button" className="chip" onClick={() => set("territories", acc.territories.filter((x) => x !== t))} title="Remove">{t.replace("|", " · ")} ×</button>)}</div>
            <div className="bill-grid">
              <label className="field"><span className="lbl">City</span><input type="text" value={area.city} onChange={(e) => setArea({ ...area, city: e.target.value })} placeholder="e.g. Houston" /></label>
              <label className="field"><span className="lbl">Business type</span><input type="text" value={area.type} onChange={(e) => setArea({ ...area, type: e.target.value })} placeholder="e.g. Trucking & haulage" /></label>
              <button className="btn sm" disabled={!area.city.trim() || !area.type.trim()} onClick={() => { set("territories", [...acc.territories, `${area.city.trim().toLowerCase()}|${area.type.trim().toLowerCase()}`]); setArea({ city: "", type: "" }); }}>Add area</button>
            </div>
            <button className="btn primary sm" onClick={() => post({ action: "settings", account: acc }, "Saved.")}>Save pricing and areas</button>
          </section>

          <section className="bsec">
            <div className="row between"><h3>History</h3><a className="btn sm" href={`/api/billing/${client.id}/statement?month=${month}`} target="_blank" rel="noreferrer"><IconReport /> This month's statement</a></div>
            {!d.entries.length ? <p className="sub">Nothing yet.</p> : (
              <div className="qlist">{d.entries.slice(0, 50).map((e) => <div className="qrow" key={e.id}><div><b>{KIND[e.kind]}{e.receipt ? ` ${e.receipt}` : ""}</b><span className="sub">{e.note}</span></div><span className={`tag ${e.credits > 0 ? "good" : ""}`}>{e.credits > 0 ? "+" : ""}{e.credits}</span><span className="sub">{e.amount ? fmt(e.amount) : ""} {e.at.slice(0, 10)}</span></div>)}</div>
            )}
            {!!d.handoffs.length && (
              <>
                <h3>Leads handed off</h3>
                <div className="qlist">{d.handoffs.slice(0, 50).map((h) => <div className="qrow" key={h.id}><div><b>{h.lead.name}</b><span className="sub">{h.createdAt.slice(0, 10)}</span></div><span className="tag">{STATUS[h.status] ?? h.status}</span><span className="sub">{h.value ? fmt(h.value) : ""}</span></div>)}</div>
              </>
            )}
          </section>
        </div>
      </div>
    </>
  );
}

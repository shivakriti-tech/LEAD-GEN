"use client";

import { useEffect, useState } from "react";
import { parsePriceList, type BrainInput, type ClientBrain } from "@/lib/brain";
import { CATEGORIES, categoriesFor } from "@/lib/categories";
import { isNiche, NICHE_KEYS, NICHES } from "@/lib/niches";
import { SERVICE_CHIP, SERVICE_ORDER } from "@/lib/score/logistics";
import type { LogisticsService, NicheKey } from "@/lib/types";
import { IconCheck, IconClose, IconEdit, IconPlus, IconSearch } from "./icons";
import { BillingPanel } from "./BillingPanel";

/**
 * Clients: one Business Brain per client you find leads for. Add a client from their website (read by
 * Claude when ANTHROPIC_API_KEY is set, a basic reader otherwise), check the draft, and save.
 */

type Draft = BrainInput & { id?: string };
type Mode = { kind: "list" } | { kind: "add" } | { kind: "edit"; draft: Draft; notes?: string[]; by?: "gpt" | "gemini" | "claude" | "rules"; warning?: string };

const EMPTY: Draft = { name: "", offer: "website_development", services: [], audience: { categories: [], areas: [] }, usps: [], proof: [], rules: { dos: [], donts: [], bannedPhrases: [] }, pitch: { mentionPrice: false }, sender: {} };
const OFFER_LABEL: Record<ClientBrain["offer"], string> = { website_development: "Website clients", logistics: "Logistics", ...(Object.fromEntries(NICHE_KEYS.map((k) => [k, NICHES[k].label])) as Record<NicheKey, string>) };

export function ClientsView({ ai, onFindLeads }: { ai: string | null; onFindLeads: (c: ClientBrain) => void }) {
  const [clients, setClients] = useState<ClientBrain[] | null>(null);
  const [mode, setMode] = useState<Mode>({ kind: "list" });
  const [billing, setBilling] = useState<{ id: string; name: string } | null>(null);
  const [error, setError] = useState("");
  const load = () => fetch("/api/clients").then((r) => r.json()).then((d) => setClients(d.clients ?? [])).catch(() => setClients([]));
  useEffect(() => void load(), []);

  if (mode.kind === "add") return <AddClient ai={ai} onCancel={() => setMode({ kind: "list" })} onDraft={(draft, by, warning) => setMode({ kind: "edit", draft, notes: draft.analysis?.notes, by, warning })} />;
  if (mode.kind === "edit")
    return (
      <BrainEditor
        initial={mode.draft}
        notes={mode.notes}
        by={mode.by}
        warning={mode.warning}
        onCancel={() => setMode({ kind: "list" })}
        onSaved={() => {
          setMode({ kind: "list" });
          load();
        }}
      />
    );

  const remove = async (c: ClientBrain) => {
    if (!confirm(`Delete ${c.name}'s profile? Searches you ran for them stay.`)) return;
    const r = await fetch(`/api/clients/${c.id}`, { method: "DELETE" });
    if (!r.ok) setError((await r.json().catch(() => ({}))).error ?? "Couldn't delete");
    load();
  };

  return (
    <section className="clients">
      <div className="top">
        <div>
          <h1>Clients</h1>
          <p>What each client sells, for how much, who they want as customers and the rules for messages sent in their name. Searches, messages and reports use it.</p>
        </div>
        <button className="btn primary" onClick={() => setMode({ kind: "add" })}><IconPlus /> Add client</button>
      </div>
      {error && <p className="note">{error}</p>}
      {clients === null ? (
        <p className="sub">Loading…</p>
      ) : !clients.length ? (
        <div className="panel empty-clients">
          <b>No clients yet</b>
          <p className="sub">Add a client with their website: we read it and draft their services, prices and message rules for you to check.{ai ? "" : " (Add a free GEMINI_API_KEY for AI reading; without it a basic reader drafts it.)"}</p>
          <button className="btn primary" onClick={() => setMode({ kind: "add" })}><IconPlus /> Add your first client</button>
        </div>
      ) : (
        <div className="client-grid">
          {clients.map((c) => (
            <article className="panel client-card" key={c.id}>
              <div className="row between">
                <span className="tag">{OFFER_LABEL[c.offer]}</span>
                <span className="sub">Updated {new Date(c.updatedAt).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}</span>
              </div>
              <h3>{c.name}</h3>
              <p className="sub">{[c.city, c.website?.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "")].filter(Boolean).join(" · ")}</p>
              {c.summary && <p className="client-sum">{c.summary}</p>}
              <div className="client-facts">
                <span><b>{c.services.length}</b> service{c.services.length === 1 ? "" : "s"}</span>
                <span><b>{c.services.filter((s) => s.price).length}</b> with prices</span>
                <span><b>{c.rules.dos.length + c.rules.donts.length}</b> rules</span>
              </div>
              <div className="row tight">
                <button className="btn sm primary" onClick={() => onFindLeads(c)}><IconSearch /> Find leads</button>
                <button className="btn sm" onClick={() => setMode({ kind: "edit", draft: c, notes: c.analysis?.notes })}><IconEdit /> Edit</button>
                <button className="btn sm" onClick={() => setBilling({ id: c.id, name: c.name })}>Credits</button>
                <span className="grow" />
                <button className="btn sm danger-ghost" onClick={() => remove(c)}>Delete</button>
              </div>
            </article>
          ))}
        </div>
      )}
      {billing && <BillingPanel client={billing} onClose={() => setBilling(null)} />}
    </section>
  );
}

function AddClient({ ai, onCancel, onDraft }: { ai: string | null; onCancel: () => void; onDraft: (d: Draft, by?: "gpt" | "gemini" | "claude" | "rules", warning?: string) => void }) {
  const [website, setWebsite] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const read = async () => {
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/clients/analyze", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ website, name: name || undefined }) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? "Couldn't read the site");
      onDraft(d.draft, d.by, d.warning);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="clients">
      <div className="top">
        <div>
          <h1>Add a client</h1>
          <p>Enter their website. We read their home, services, pricing and about pages and draft their profile. You check it before anything is saved.</p>
        </div>
      </div>
      <form className="panel add-client" onSubmit={(e) => { e.preventDefault(); if (website.trim() && !busy) read(); }}>
        <label className="field">
          <span className="lbl">Their website</span>
          <input type="text" value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="e.g. shreelogistics.in" autoFocus disabled={busy} />
        </label>
        <label className="field">
          <span className="lbl">Company name <span className="opt">optional, if the site shows it differently</span></span>
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Shree Logistics" disabled={busy} />
        </label>
        {error && <p className="note">{error}</p>}
        <p className="sub">{ai ? `Read by ${ai}: services and prices are taken only from their pages; anything missing is listed for you to fill in.` : "No AI key: a basic reader drafts it from their page headings and prices. Add a free GEMINI_API_KEY (Setup) for a much better first draft."}</p>
        <div className="row gap">
          <button className="btn primary" type="submit" disabled={!website.trim() || busy}>{busy ? "Reading their website… (up to a minute)" : "Read their website"}</button>
          <button className="btn" type="button" onClick={() => onDraft({ ...EMPTY, name, website: website || undefined })} disabled={busy}>Fill in by hand</button>
          <span className="grow" />
          <button className="btn" type="button" onClick={onCancel} disabled={busy}>Cancel</button>
        </div>
      </form>
    </section>
  );
}

/** A list edited as one item per line. */
function Lines({ label, hint, value, onChange, rows = 3, placeholder }: { label: string; hint?: string; value: string[] | undefined; onChange: (v: string[]) => void; rows?: number; placeholder?: string }) {
  const [text, setText] = useState((value ?? []).join("\n"));
  return (
    <label className="field">
      <span className="lbl">{label}{hint && <span className="opt">{hint}</span>}</span>
      <textarea rows={rows} value={text} placeholder={placeholder} onChange={(e) => { setText(e.target.value); onChange(e.target.value.split("\n").map((x) => x.trim()).filter(Boolean)); }} />
    </label>
  );
}

function BrainEditor({ initial, notes, by, warning, onCancel, onSaved }: { initial: Draft; notes?: string[]; by?: "gpt" | "gemini" | "claude" | "rules"; warning?: string; onCancel: () => void; onSaved: () => void }) {
  const [b, setB] = useState<Draft>(() => ({ ...EMPTY, ...initial, audience: { ...EMPTY.audience!, ...initial.audience }, rules: { ...EMPTY.rules!, ...initial.rules }, pitch: { ...EMPTY.pitch!, ...initial.pitch }, sender: { ...initial.sender } }));
  const [paste, setPaste] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setB((x) => ({ ...x, [k]: v }));
  const services = b.services ?? [];
  const setService = (i: number, patch: Partial<(typeof services)[number]>) => set("services", services.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const cats = isNiche(b.offer) ? categoriesFor(b.offer) : CATEGORIES.filter((c) => (b.offer === "logistics" ? c.sells === "logistics" : !c.sells));
  const picked = new Set(b.audience?.categories ?? []);
  const logistics = b.offer === "logistics";

  const save = async () => {
    setSaving(true);
    setError("");
    const body = { ...b, services: services.filter((s) => s.name.trim()) };
    delete (body as { id?: string }).id;
    const r = await fetch(initial.id ? `/api/clients/${initial.id}` : "/api/clients", { method: initial.id ? "PUT" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const d = await r.json().catch(() => ({}));
    setSaving(false);
    if (!r.ok) return setError(d.error ?? "Couldn't save");
    onSaved();
  };

  return (
    <section className="clients">
      <div className="top">
        <div>
          <h1>{initial.id ? `Edit ${initial.name}` : "Check the profile"}</h1>
          <p>{by === "gpt" ? "Drafted by GPT from their website. " : by === "gemini" ? "Drafted by Gemini from their website. " : by === "claude" ? "Drafted by Claude from their website. " : by === "rules" ? "Drafted from their website without AI. " : ""}Everything here is used for their searches and messages: fix anything that's off.</p>
        </div>
      </div>
      {warning && <p className="note">{warning}</p>}
      {!!notes?.length && (
        <div className="callout">
          <b>To check</b>
          <ul>{notes.map((n, i) => <li key={i}>{n}</li>)}</ul>
        </div>
      )}
      <div className="brain">
        <section className="panel bsec">
          <h2>Basics</h2>
          <div className="bgrid">
            <label className="field"><span className="lbl">Company name</span><input type="text" value={b.name} onChange={(e) => set("name", e.target.value)} /></label>
            <label className="field"><span className="lbl">Website</span><input type="text" value={b.website ?? ""} onChange={(e) => set("website", e.target.value || undefined)} /></label>
            <label className="field"><span className="lbl">City</span><input type="text" value={b.city ?? ""} onChange={(e) => set("city", e.target.value || undefined)} /></label>
            <label className="field"><span className="lbl">Phone</span><input type="text" value={b.phone ?? ""} onChange={(e) => set("phone", e.target.value || undefined)} /></label>
            <label className="field"><span className="lbl">Email</span><input type="text" value={b.email ?? ""} onChange={(e) => set("email", e.target.value || undefined)} /></label>
            <div className="field">
              <span className="lbl">Leads to find for them</span>
              <select aria-label="Offer" value={b.offer} onChange={(e) => set("offer", e.target.value as ClientBrain["offer"])}>
                {(Object.keys(OFFER_LABEL) as Array<ClientBrain["offer"]>).map((k) => <option key={k} value={k}>{OFFER_LABEL[k]}</option>)}
              </select>
            </div>
          </div>
          <label className="field"><span className="lbl">What they do <span className="opt">one line</span></span><textarea rows={2} value={b.summary ?? ""} onChange={(e) => set("summary", e.target.value || undefined)} /></label>
        </section>

        <section className="panel bsec">
          <h2>Services & prices</h2>
          <p className="sub">Prices as the client says them ("₹9,999", "from ₹15,000 / month", "on request").{logistics ? " Match each service to the app's service so leads get the right \"likely needs\"." : ""}</p>
          <div className="svc-list">
            {services.map((s, i) => (
              <div className={`svc-row ${logistics ? "lg" : ""}`} key={i}>
                <input type="text" aria-label="Service" value={s.name} placeholder="Service" onChange={(e) => setService(i, { name: e.target.value })} />
                <input type="text" aria-label="Price" value={s.price ?? ""} placeholder="Price" onChange={(e) => setService(i, { price: e.target.value || undefined })} />
                {logistics && (
                  <select aria-label="Matches" value={s.logistics ?? ""} onChange={(e) => setService(i, { logistics: (e.target.value || undefined) as LogisticsService | undefined })}>
                    <option value="">Matches…</option>
                    {SERVICE_ORDER.map((k) => <option key={k} value={k}>{SERVICE_CHIP[k]}</option>)}
                  </select>
                )}
                <button type="button" className="icon-btn" aria-label={`Remove ${s.name || "service"}`} onClick={() => set("services", services.filter((_, j) => j !== i))}><IconClose /></button>
              </div>
            ))}
          </div>
          <div className="row gap wrap">
            <button type="button" className="btn sm" onClick={() => set("services", [...services, { name: "" }])}><IconPlus /> Add service</button>
          </div>
          <details className="paste">
            <summary>Paste a price list</summary>
            <textarea rows={4} value={paste} onChange={(e) => setPaste(e.target.value)} placeholder={"Basic website - ₹9,999\nE-commerce site: from ₹35,000\nSEO | ₹5,000 per month"} />
            <button type="button" className="btn sm" disabled={!paste.trim()} onClick={() => { set("services", [...services, ...parsePriceList(paste)]); setPaste(""); }}><IconCheck /> Add these</button>
          </details>
        </section>

        <section className="panel bsec">
          <h2>Who they want as customers</h2>
          <div className="chips">
            {cats.map((c) => (
              <button key={c.key} type="button" className="chip" aria-pressed={picked.has(c.key)} onClick={() => set("audience", { ...b.audience!, categories: picked.has(c.key) ? [...picked].filter((k) => k !== c.key) : [...picked, c.key] })}>
                {picked.has(c.key) && <IconCheck />} {c.label}
              </button>
            ))}
          </div>
          <div className="bgrid">
            <label className="field"><span className="lbl">Areas <span className="opt">comma-separated</span></span><input type="text" value={(b.audience?.areas ?? []).join(", ")} onChange={(e) => set("audience", { ...b.audience!, areas: e.target.value.split(",").map((x) => x.trim()).filter(Boolean) })} placeholder="Alkapuri, Makarpura GIDC" /></label>
            <label className="field"><span className="lbl">Notes</span><input type="text" value={b.audience?.notes ?? ""} onChange={(e) => set("audience", { ...b.audience!, notes: e.target.value || undefined })} placeholder="e.g. exporters shipping 2+ containers a month" /></label>
          </div>
        </section>

        <section className="panel bsec">
          <h2>Why customers pick them</h2>
          <div className="bgrid">
            <Lines label="Reasons" hint="one per line" value={b.usps} onChange={(v) => set("usps", v)} placeholder={"Own customs broker licence\nSame-day shipping bill filing"} />
            <Lines label="Proof" hint="numbers, clients, years" value={b.proof} onChange={(v) => set("proof", v)} placeholder={"300+ exporters served\nISO 9001 certified"} />
          </div>
        </section>

        <section className="panel bsec">
          <h2>Message rules</h2>
          <div className="bgrid">
            <Lines label="Do" hint="one per line" value={b.rules?.dos} onChange={(v) => set("rules", { ...b.rules!, dos: v })} />
            <Lines label="Don't" hint="one per line" value={b.rules?.donts} onChange={(v) => set("rules", { ...b.rules!, donts: v })} />
          </div>
          <label className="field"><span className="lbl">Never say <span className="opt">comma-separated; messages with these are flagged</span></span><input type="text" value={(b.rules?.bannedPhrases ?? []).join(", ")} onChange={(e) => set("rules", { ...b.rules!, bannedPhrases: e.target.value.split(",").map((x) => x.trim()).filter(Boolean) })} placeholder="guaranteed, cheapest, 100%" /></label>
          <div className="bgrid">
            <label className="field"><span className="lbl">Reason to pick them, in messages <span className="opt">one short line</span></span><input type="text" value={b.pitch?.usp ?? ""} onChange={(e) => set("pitch", { ...b.pitch!, usp: e.target.value || undefined })} placeholder="We have our own customs licence, so clearance is same day" /></label>
            <label className="field"><span className="lbl">Price line <span className="opt">optional</span></span><input type="text" value={b.pitch?.priceHook ?? ""} onChange={(e) => set("pitch", { ...b.pitch!, priceHook: e.target.value || undefined })} placeholder="Websites from ₹9,999" /></label>
          </div>
          <label className="check"><input type="checkbox" checked={!!b.pitch?.mentionPrice} onChange={(e) => set("pitch", { ...b.pitch!, mentionPrice: e.target.checked })} /> Put the price line in first messages</label>
          <div className="bgrid">
            <label className="field"><span className="lbl">Messages signed by</span><input type="text" value={b.sender?.name ?? ""} onChange={(e) => set("sender", { ...b.sender, name: e.target.value || undefined })} placeholder="Divy Shah" /></label>
            <label className="field"><span className="lbl">Link in messages <span className="opt">optional</span></span><input type="text" value={b.sender?.link ?? ""} onChange={(e) => set("sender", { ...b.sender, link: e.target.value || undefined })} placeholder="shreelogistics.in" /></label>
          </div>
        </section>
      </div>
      {error && <p className="note">{error}</p>}
      <div className="brain-save">
        <button className="btn" onClick={onCancel} disabled={saving}>Cancel</button>
        <button className="btn primary" onClick={save} disabled={saving || !b.name.trim()}>{saving ? "Saving…" : initial.id ? "Save changes" : "Save client"}</button>
      </div>
    </section>
  );
}

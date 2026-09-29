"use client";

import { useEffect, useRef, useState } from "react";
import type { Lead } from "@/lib/types";
import { EMAIL_KIND_LABEL } from "@/lib/enrich/email";
import { emailLink, localDate, mapsLink, scoreSummary, shortAddress, statusOf, telLink, whatsappNumber } from "@/lib/outreach";
import type { FollowUpPatch, Touched } from "@/lib/followups";
import { fmtPhone } from "./LeadList";
import { usePitch, YourDetails } from "./pitch";
import { DueChip, StatusMenu } from "./StatusMenu";
import { PitchBox } from "./PitchBox";
import { IconCheck, IconClose, IconCopy, IconCross, IconMail, IconMap, IconPhone } from "./icons";

const SOURCE_NAME: Record<string, string> = { google: "Google Maps", osm: "OpenStreetMap", apollo: "Apollo", instagram: "Instagram", facebook: "Facebook", web: "Search engines", gmaps: "Google Maps (scraper)" };
const VIA: Record<string, string> = { source: "Listed by the source", domain_guess: "Found by trying likely web addresses", web_search: "Found by web search", instagram_bio: "Found through its Instagram bio", none_found: "No website found" };

function copy(text: string, done: () => void) {
  navigator.clipboard?.writeText(text).then(done, () => {});
}

function Check({ ok, label, value }: { ok: boolean | undefined; label: string; value?: string }) {
  return (
    <li className={ok === undefined ? "na" : ok ? "ok" : "bad"}>
      <span className="ck">{ok === undefined ? "–" : ok ? <IconCheck /> : <IconCross />}</span>
      <span>{label}</span>
      {value && <span className="sub">{value}</span>}
    </li>
  );
}

const TIER_KICKER = { hot: "Message first", warm: "Worth a try", cold: "Skip for now" } as const;

/**
 * Everything about one lead, with the message ready to send. Beside the list on a wide screen
 * (docked), or sliding in over it on smaller ones.
 */
export function LeadPanel({
  lead: l,
  docked,
  onClose,
  onFollowUp,
  draft,
  setDraft,
  onSent,
  next,
  onNext,
  touched,
}: {
  lead: Lead;
  docked: boolean;
  onClose: () => void;
  onFollowUp: (p: FollowUpPatch) => void;
  draft?: string;
  setDraft: (t: string | undefined) => void;
  onSent: () => void;
  /** The next lead worth messaging in the list, if any. */
  next?: Lead;
  onNext: () => void;
  touched?: Touched;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const [note, setNote] = useState(l.followUp?.note ?? "");
  const [copied, setCopied] = useState("");
  const { me } = usePitch();
  useEffect(() => setNote(l.followUp?.note ?? ""), [l.id, l.followUp?.note]);
  const closeFn = useRef(onClose);
  closeFn.current = onClose;
  // as an overlay: focus it when a lead opens (not on every update while a search streams in); Esc closes
  useEffect(() => {
    if (docked) return;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && closeFn.current();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [l.id, docked]);
  const flash = (what: string) => {
    setCopied(what);
    setTimeout(() => setCopied(""), 1500);
  };

  const a = l.audit;
  const mail = emailLink(l, me);
  const total = l.signals.reduce((t, s) => t + Math.max(0, s.points), 0) || 1;
  const nowYear = new Date().getFullYear();
  const where = shortAddress(l.address, l.city) ?? l.city;

  const body = (
    <>
      <header className="drawer-head">
        <div className="drawer-title">
          <span className="kicker">{l.pending ? "Still checking" : `${TIER_KICKER[l.tier]} · score ${l.score} of 100`}</span>
          <h2 id="drawer-title">{l.name}</h2>
          <span className="sub">
            {l.category}{where ? ` · ${where}` : ""}
            {l.rating != null ? ` · ${l.rating.toFixed(1)}★ from ${l.reviews ?? 0} reviews` : ""}
          </span>
        </div>
        <button ref={closeRef} className="icon-btn" onClick={onClose} aria-label={docked ? "Hide panel" : "Close"} title={docked ? "Hide panel" : "Close"}><IconClose /></button>
      </header>

      <div className="drawer-body">
        <p className={`reason ${l.pending ? "" : l.tier}`}>{l.pending ? "Still checking this business…" : l.whyNow}</p>
        {l.changes?.length ? <p className="note">Changed since it was last checked: <b>{l.changes.join(", ")}</b>.</p> : null}
        {touched && <p className="note">You already marked this business <b>{touched.status}</b> in {touched.search}{touched.at ? ` on ${new Date(touched.at).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}` : ""}. Check before messaging again.</p>}

        <PitchBox lead={l} draft={draft} setDraft={setDraft} onSent={onSent} big />
        <div className="alt">
          {l.phone && <a className="btn" href={telLink(l.phone)}><IconPhone /> Call</a>}
          {mail && <a className="btn" href={mail}><IconMail /> Email</a>}
          <a className="btn" href={mapsLink(l)} target="_blank" rel="noreferrer"><IconMap /> Map</a>
        </div>

        <section className="dsec follow">
          <div className="follow-grid">
            <div className="field">
              <span className="lbl">Status</span>
              <span className="row">
                <StatusMenu lead={l} onChange={onFollowUp} align="left" />
                <DueChip lead={l} />
              </span>
            </div>
            <label className="field fu-date">
              <span className="lbl">Follow up on</span>
              <input type="date" min={localDate()} value={l.followUp?.followUpOn ?? ""} onChange={(e) => onFollowUp({ followUpOn: e.target.value || null })} />
            </label>
          </div>
          {statusOf(l) === "won" && (
            <label className="field deal">
              <span className="lbl">Deal value (₹)</span>
              <input
                key={l.id}
                type="number"
                min="0"
                step="500"
                inputMode="numeric"
                placeholder="e.g. 15000"
                defaultValue={l.followUp?.value ?? ""}
                onBlur={(e) => {
                  const v = e.target.value ? Number(e.target.value) : null;
                  if (v !== (l.followUp?.value ?? null)) onFollowUp({ value: v });
                }}
              />
              <span className="sub">Shows as "Won" on Home.</span>
            </label>
          )}
          <textarea
            aria-label="Your note"
            placeholder="Your note, e.g. “Spoke to Dr. Shah, call back Monday”"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            onBlur={() => note !== (l.followUp?.note ?? "") && onFollowUp({ note })}
            rows={2}
          />
        </section>

        {next && (
          <button type="button" className="next" onClick={onNext}>
            <span className="sub">Next to message</span>
            <b>{next.name}</b>
            <span aria-hidden="true">→</span>
          </button>
        )}

        <YourDetails />

        <section className="dsec">
          <h3>Why this score</h3>
          <p className="sub">{scoreSummary(l)}</p>
          <ul className="points">
            {l.signals.map((s) => (
              <li key={s.key}>
                <span>{s.label}</span>
                <span className={`pts ${s.points < 0 ? "neg" : ""}`}>{s.points > 0 ? "+" : ""}{s.points}</span>
                {s.points > 0 && <i style={{ width: `${Math.round((s.points / total) * 100)}%` }} />}
              </li>
            ))}
            {!l.signals.length && <li className="sub">Nothing counted yet.</li>}
          </ul>
        </section>

        <section className="dsec">
          <h3>Reach them</h3>
          <div className="reach">
            {l.phones.length ? (
              l.phones.map((p) => (
                <div className="reach-row" key={p}>
                  <span className="mono">{fmtPhone(p)}</span>
                  {p === whatsappNumber(l) && <span className="tag good">WhatsApp</span>}
                  <span className="grow" />
                  <a className="act" href={telLink(p)}><IconPhone /><span>Call</span></a>
                  <button className="act icon-only" onClick={() => copy(p, () => flash(p))} aria-label={`Copy ${p}`} title="Copy">{copied === p ? <IconCheck /> : <IconCopy />}</button>
                </div>
              ))
            ) : (
              <div className="sub">No phone number found.</div>
            )}
            {l.emailInfo?.length
              ? l.emailInfo.map((e) => (
                  <div className="reach-row" key={e.email}>
                    <span className="email">{e.email}</span>
                    <span className={`tag ${e.deliverable === false ? "bad" : e.kind === "own_named" || e.kind === "personal" ? "good" : ""}`}>{e.deliverable === false ? "can't receive mail" : EMAIL_KIND_LABEL[e.kind]}</span>
                    <span className="grow" />
                    <button className="act icon-only" onClick={() => copy(e.email, () => flash(e.email))} aria-label={`Copy ${e.email}`} title="Copy">{copied === e.email ? <IconCheck /> : <IconCopy />}</button>
                  </div>
                ))
              : l.emails.map((e) => <div className="reach-row" key={e}><span className="email">{e}</span></div>)}
            {!l.emails.length && <div className="sub">No email found.</div>}
            {l.owner && <div className="reach-row"><span>Owner: <b>{l.owner.name}</b></span><span className="sub">from {l.owner.via === "google_maps" ? "Google Maps" : "their website"}</span></div>}
            <div className="links">
              {l.website && <a href={l.website} target="_blank" rel="noreferrer">{l.website.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "")}</a>}
              {l.social?.instagram && <a href={l.social.instagram.url} target="_blank" rel="noreferrer">Instagram @{l.social.instagram.handle}{l.social.instagram.followers != null ? ` · ${l.social.instagram.followers.toLocaleString("en-IN")} followers` : ""}</a>}
              {l.social?.facebook && <a href={l.social.facebook.url} target="_blank" rel="noreferrer">Facebook</a>}
              <a href={mapsLink(l)} target="_blank" rel="noreferrer"><IconMap /> Google Maps</a>
            </div>
          </div>
        </section>

        <section className="dsec">
          <h3>Their website</h3>
          <p className="sub">{VIA[l.websiteCheck?.via ?? "none_found"]}{l.websiteCheck?.evidence ? `: ${l.websiteCheck.evidence}` : ""}</p>
          {a && a.status !== "none" ? (
            <ul className="checks">
              <Check ok={a.status === "ok"} label={a.status === "social_only" ? "Uses a social page instead of a website" : "Website loads"} value={a.status === "down" ? a.error : undefined} />
              {a.status === "ok" && (
                <>
                  <Check ok={a.https} label="Secure (HTTPS)" />
                  <Check ok={a.mobileViewport} label="Mobile-friendly" />
                  <Check ok={a.pageSpeed ? a.pageSpeed.score >= 50 : undefined} label="Fast on mobile" value={a.pageSpeed ? `${a.pageSpeed.score}/100${a.pageSpeed.lcp ? ` · loads in ${a.pageSpeed.lcp}` : ""}` : "not checked"} />
                  <Check ok={a.copyrightYear ? nowYear - a.copyrightYear < 3 : undefined} label="Updated recently" value={a.copyrightYear ? `© ${a.copyrightYear}` : "no date on the site"} />
                  <Check ok={a.freeSubdomain ? false : a.builder ? true : undefined} label={a.freeSubdomain ? "On a free builder address" : "Own web address"} value={a.builder} />
                </>
              )}
            </ul>
          ) : (
            <p className="sub">They have no website: the strongest reason to pitch.</p>
          )}
          {(a?.designedBy || a?.foundedYear) && (
            <p className="sub">{[a?.designedBy && `Built by ${a.designedBy}`, a?.foundedYear && `Running since ${a.foundedYear}`].filter(Boolean).join(" · ")}</p>
          )}
        </section>

        {(l.rating != null || l.priceRange || l.orderLinks?.length || l.photos) && (
          <section className="dsec">
            <h3>On Google</h3>
            <p>
              {[l.rating != null && `${l.rating.toFixed(1)}★ from ${l.reviews ?? 0} reviews`, l.priceRange && `price ${l.priceRange}`, l.photos && `${l.photos} photos`].filter(Boolean).join(" · ")}
            </p>
            {l.orderLinks?.length ? (
              <p className="sub">Takes orders/bookings through {l.orderLinks.map((o, i) => <span key={o.url}>{i ? ", " : ""}<a href={o.url} target="_blank" rel="noreferrer">{o.source}</a></span>)}</p>
            ) : null}
          </section>
        )}

        <section className="dsec">
          <details>
            <summary>How we checked</summary>
            <p className="sub">Found on {l.sources.map((s) => SOURCE_NAME[s] ?? s).join(" + ")}.{l.chain ? ` Chain: ${l.chain.reason}.` : ""}{l.checkedAt ? ` Last checked ${new Date(l.checkedAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}.` : ""}</p>
            <ul className="tried">{(l.websiteCheck?.tried ?? []).map((t, i) => <li key={i}>{t}</li>)}</ul>
          </details>
        </section>
        {docked && <p className="keys sub">Keys: <kbd>J</kbd>/<kbd>K</kbd> next/previous · <kbd>W</kbd> WhatsApp · <kbd>C</kbd> mark contacted</p>}
      </div>
    </>
  );

  if (docked) return <aside className="desk" aria-label={`Lead: ${l.name}`}>{body}</aside>;
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-modal="true" aria-labelledby="drawer-title">{body}</aside>
    </>
  );
}

"use client";

import { useEffect, useState } from "react";
import type { Lead } from "@/lib/types";
import { pitchText, toneFor, TONES, whatsappLinkWith, type Tone } from "@/lib/outreach";
import { usePitch } from "./pitch";
import { bannedIn } from "@/lib/brain";
import { IconCheck, IconCopy, IconWhatsApp } from "./icons";

/**
 * The message for one lead, ready to send: pick a tone and language, edit it if you like,
 * then WhatsApp or copy it. Your edits stay (per lead) until you change tone or language.
 */
export function PitchBox({
  lead,
  draft,
  setDraft,
  onSent,
  autoFocus,
  big,
}: {
  lead: Lead;
  draft?: string;
  setDraft: (text: string | undefined) => void;
  onSent: () => void;
  autoFocus?: boolean;
  /** In the lead panel: a full-width send button. */
  big?: boolean;
}) {
  const { lang, setLang, tone: preferred, setTone, me, send, banned, clientName } = usePitch();
  const [tone, setLocalTone] = useState<Tone>(() => toneFor(lead, preferred));
  const [copied, setCopied] = useState(false);
  // a different lead (or its status changed): start from its own tone again
  useEffect(() => setLocalTone(toneFor(lead, preferred)), [lead.id, lead.followUp?.status, preferred]); // eslint-disable-line react-hooks/exhaustive-deps
  const text = draft ?? pitchText(lead, lang, tone, send ?? me);
  const wa = whatsappLinkWith(lead, text);
  const flagged = banned?.length ? bannedIn(text, banned) : [];
  const pickTone = (t: Tone) => {
    setDraft(undefined);
    setLocalTone(t);
    if (t !== "follow") setTone(t);
  };
  const copy = () =>
    navigator.clipboard?.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }, () => {});
  return (
    <div className={`pitch ${big ? "big" : ""}`}>
      <div className="pitch-head">
        <span className="lbl">Your message</span>
        <div className="seg" role="group" aria-label="Tone">
          {TONES.map((t) => (
            <button key={t.key} type="button" aria-pressed={tone === t.key} onClick={() => pickTone(t.key)}>{t.label}</button>
          ))}
        </div>
        <div className="seg" role="group" aria-label="Message language">
          <button type="button" aria-pressed={lang === "en"} onClick={() => { setDraft(undefined); setLang("en"); }}>English</button>
          <button type="button" aria-pressed={lang === "hi"} onClick={() => { setDraft(undefined); setLang("hi"); }}>Hinglish</button>
        </div>
      </div>
      <textarea
        className="pitch-text"
        value={text}
        onChange={(e) => setDraft(e.target.value)}
        rows={big ? 7 : 4}
        aria-label={`Message to ${lead.name}`}
        autoFocus={autoFocus}
      />
      {flagged.length > 0 && <p className="pitch-warn">{clientName ?? "This client"} never says: {flagged.map((x) => `"${x}"`).join(", ")}. Change it before sending.</p>}
      <div className="pitch-foot">
        {lead.followUp?.optedOut ? (
          <span className="pitch-warn">Asked not to be contacted: don't message them.</span>
        ) : wa ? (
          <a className={`btn wa ${big ? "send" : ""}`} href={wa} target="_blank" rel="noreferrer" onClick={onSent}><IconWhatsApp /> Send on WhatsApp</a>
        ) : (
          <span className="sub">No mobile number for WhatsApp: copy it and send another way.</span>
        )}
        <button type="button" className="btn" onClick={copy}>{copied ? <IconCheck /> : <IconCopy />} {copied ? "Copied" : "Copy"}</button>
        {draft !== undefined && <button type="button" className="linkish" onClick={() => setDraft(undefined)}>Undo my edits</button>}
        {!me.name && !big && <span className="sub">Tip: add your name under <i>Your details</i> in a lead's panel.</span>}
      </div>
    </div>
  );
}

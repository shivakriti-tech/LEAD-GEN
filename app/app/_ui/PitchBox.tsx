"use client";

import { useState } from "react";
import type { Lead } from "@/lib/types";
import { firstMessage, whatsappLinkWith, type Lang } from "@/lib/outreach";
import { IconCheck, IconCopy, IconWhatsApp } from "./icons";

/**
 * The pitch for one lead, ready to send: edit it if you like, then WhatsApp or copy it.
 * Your edits are kept (per lead) until you switch language.
 */
export function PitchBox({
  lead,
  lang,
  setLang,
  sender,
  draft,
  setDraft,
  onSent,
  autoFocus,
}: {
  lead: Lead;
  lang: Lang;
  setLang: (l: Lang) => void;
  sender: string;
  draft?: string;
  setDraft: (text: string | undefined) => void;
  onSent: () => void;
  autoFocus?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const text = draft ?? firstMessage(lead, lang, sender);
  const wa = whatsappLinkWith(lead, text);
  const copy = () =>
    navigator.clipboard?.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }, () => {});
  return (
    <div className="pitch">
      <div className="pitch-head">
        <span className="lbl">Your message</span>
        <div className="seg" role="group" aria-label="Message language">
          <button type="button" aria-pressed={lang === "en"} onClick={() => { setDraft(undefined); setLang("en"); }}>English</button>
          <button type="button" aria-pressed={lang === "hi"} onClick={() => { setDraft(undefined); setLang("hi"); }}>Hinglish</button>
        </div>
      </div>
      <textarea
        className="pitch-text"
        value={text}
        onChange={(e) => setDraft(e.target.value)}
        rows={4}
        aria-label={`Message to ${lead.name}`}
        autoFocus={autoFocus}
      />
      <div className="pitch-foot">
        {wa ? (
          <a className="btn wa" href={wa} target="_blank" rel="noreferrer" onClick={onSent}><IconWhatsApp /> Send on WhatsApp</a>
        ) : (
          <span className="sub">No mobile number for WhatsApp: copy and send another way.</span>
        )}
        <button type="button" className="btn" onClick={copy}>{copied ? <IconCheck /> : <IconCopy />} {copied ? "Copied" : "Copy pitch"}</button>
        {draft !== undefined && <button type="button" className="linkish" onClick={() => setDraft(undefined)}>Reset</button>}
        {!sender && <span className="sub">Tip: set your name in a lead's details so it signs the message.</span>}
      </div>
    </div>
  );
}

"use client";

import { createContext, useContext, useState } from "react";
import type { Lang, Sender, Tone } from "@/lib/outreach";

/** How you like your messages written: language, tone and how they introduce you. Saved in this browser. */
export interface PitchPrefs {
  lang: Lang;
  setLang: (l: Lang) => void;
  tone: Exclude<Tone, "follow">;
  setTone: (t: Exclude<Tone, "follow">) => void;
  me: Sender;
  setMe: (s: Sender) => void;
  /** Who messages in the open search are from: your details, with the client's Business Brain on top. */
  send?: Sender;
  /** The client's "never say" phrases, flagged in the message box. */
  banned?: string[];
  clientName?: string;
}

export const PitchCtx = createContext<PitchPrefs>({
  lang: "en",
  setLang: () => {},
  tone: "friendly",
  setTone: () => {},
  me: {},
  setMe: () => {},
});
export const usePitch = () => useContext(PitchCtx);

/** Your name, what you do, your city and a link to your work: every message introduces you with these. */
export function YourDetails({ compact, plain }: { compact?: boolean; plain?: boolean }) {
  const { me, setMe } = usePitch();
  const [open, setOpen] = useState(!me.name);
  const set = (k: keyof Sender, v: string) => setMe({ ...me, [k]: v });
  const fields = (
    <div className="you-grid">
      <label className="field">
        <span className="lbl">Your name</span>
        <input type="text" value={me.name ?? ""} onChange={(e) => set("name", e.target.value)} placeholder="e.g. Divy" autoComplete="name" />
      </label>
      <label className="field">
        <span className="lbl">What you do</span>
        <input type="text" value={me.work ?? ""} onChange={(e) => set("work", e.target.value)} placeholder="web developer" />
      </label>
      <label className="field">
        <span className="lbl">Your city</span>
        <input type="text" value={me.city ?? ""} onChange={(e) => set("city", e.target.value)} placeholder="e.g. Vadodara" />
      </label>
      <label className="field">
        <span className="lbl">Link to your work <span className="opt">optional</span></span>
        <input type="text" value={me.link ?? ""} onChange={(e) => set("link", e.target.value)} placeholder="yoursite.com or an Instagram page" inputMode="url" />
      </label>
      <label className="field wide">
        <span className="lbl">Business postal address <span className="opt">needed in emails to the US and Canada (their law)</span></span>
        <input type="text" value={me.address ?? ""} onChange={(e) => set("address", e.target.value)} placeholder="e.g. 4th floor, Alkapuri Arcade, Vadodara 390007, India" autoComplete="street-address" />
      </label>
    </div>
  );
  if (plain) return fields;
  return (
    <details className={`you ${compact ? "compact" : ""}`} open={open} onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
      <summary>
        <b>Your details</b>
        <span className="sub">{me.name ? `${me.name}${me.work ? `, ${me.work}` : ""}${me.city ? `, ${me.city}` : ""}` : "Add your name so messages introduce you"}</span>
      </summary>
      {fields}
    </details>
  );
}

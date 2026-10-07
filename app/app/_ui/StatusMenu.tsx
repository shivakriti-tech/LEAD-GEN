"use client";

import { useEffect, useRef, useState } from "react";
import type { Lead } from "@/lib/types";
import { addDays, dueLabel, FOLLOW_UP, localDate, statusOf, type FollowUpStatus } from "@/lib/outreach";
import type { FollowUpPatch } from "@/lib/followups";

/** A colour-coded status pill. One tap opens a small menu: pick a status or a follow-up date. */
export function StatusMenu({ lead, onChange, disabled, align = "right" }: { lead: Lead; onChange: (p: FollowUpPatch) => void; disabled?: boolean; align?: "left" | "right" }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const st = statusOf(lead);
  const label = FOLLOW_UP.find((s) => s.key === st)!.label;
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);
  const pick = (p: FollowUpPatch) => {
    onChange(p);
    setOpen(false);
  };
  const due = lead.followUp?.followUpOn;
  return (
    <div className="status-wrap" ref={ref}>
      <button
        type="button"
        className={`pill s-${st}`}
        onClick={() => setOpen(!open)}
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        title={disabled ? "You can update leads once the search has finished" : "Change status or set a follow-up"}
      >
        <i className="pill-dot" />
        {label}
      </button>
      {open && (
        <div className={`menu ${align}`} role="menu" aria-label={`Status of ${lead.name}`}>
          <div className="menu-lbl">Status</div>
          <div className="menu-statuses">
            {FOLLOW_UP.map((s) => (
              <button key={s.key} role="menuitemradio" aria-checked={st === s.key} className={`pill s-${s.key}`} onClick={() => pick({ status: s.key as FollowUpStatus })}>
                <i className="pill-dot" />
                {s.label}
              </button>
            ))}
          </div>
          <div className="menu-lbl">Follow up {due && <span className="sub">· now {dueLabel(due)}</span>}</div>
          <div className="menu-dates">
            <button role="menuitem" onClick={() => pick({ followUpOn: addDays(1) })}>Tomorrow</button>
            <button role="menuitem" onClick={() => pick({ followUpOn: addDays(3) })}>In 3 days</button>
            <button role="menuitem" onClick={() => pick({ followUpOn: addDays(7) })}>Next week</button>
            <label className="date-pick">
              <span className="sr-only">Pick a date</span>
              <input type="date" min={localDate()} defaultValue={due} onChange={(e) => e.target.value && pick({ followUpOn: e.target.value })} />
            </label>
            {due && <button role="menuitem" className="muted" onClick={() => pick({ followUpOn: null })}>Clear</button>}
          </div>
        </div>
      )}
    </div>
  );
}

/** "Follow up Tomorrow" chip shown next to the status when a date is set. */
export function DueChip({ lead }: { lead: Lead }) {
  const d = lead.followUp?.followUpOn;
  if (!d || ["won", "lost"].includes(statusOf(lead))) return null;
  const today = localDate();
  return <span className={`due ${d < today ? "late" : d === today ? "today" : ""}`} title={`Follow up: ${d}`}>{dueLabel(d, today)}</span>;
}

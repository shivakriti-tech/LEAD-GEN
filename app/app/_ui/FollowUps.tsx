"use client";

import { useState } from "react";
import type { DueLead } from "@/lib/followups";
import type { FollowUpPatch } from "@/lib/followups";
import type { Lead } from "@/lib/types";
import { addDays, dueLabel, followUpMessage, localDate, whatsappLinkWith } from "@/lib/outreach";
import { usePitch } from "./pitch";
import { IconWhatsApp } from "./icons";

/** "Follow up today": leads from any search whose follow-up date is today or overdue. */
export function FollowUpsToday({
  due,
  onUpdate,
  onOpen,
}: {
  due: DueLead[];
  onUpdate: (searchId: string, lead: DueLead["lead"], p: FollowUpPatch) => void;
  onOpen: (searchId: string, leadId: string) => void;
}) {
  const [open, setOpen] = useState(true);
  const { lang, me } = usePitch();
  if (!due.length) return null;
  const today = localDate();
  const late = due.filter((d) => d.lead.followUp!.followUpOn! < today).length;
  return (
    <section className="panel followups" aria-label="Follow up today">
      <button type="button" className="fu-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <b>Follow up today</b>
        <span className="count">{due.length}</span>
        {late > 0 && <span className="due late">{late} overdue</span>}
        <span className="grow" />
        <span className="sub">{open ? "Hide" : "Show"}</span>
      </button>
      {open && (
        <ul className="fu-list">
          {due.map((d) => {
            const wa = whatsappLinkWith(d.lead as Lead, followUpMessage(d.lead as Lead, lang, me));
            const when = d.lead.followUp!.followUpOn!;
            return (
              <li key={`${d.searchId}/${d.lead.id}`}>
                <button type="button" className="fu-name" onClick={() => onOpen(d.searchId, d.lead.id)}>
                  <b>{d.lead.name}</b>
                  <span className="sub">{d.lead.category} · {d.search}</span>
                </button>
                <span className={`due ${when < today ? "late" : "today"}`}>{dueLabel(when, today)}</span>
                {d.lead.followUp?.note && <span className="fu-note" title={d.lead.followUp.note}>{d.lead.followUp.note}</span>}
                <span className="grow" />
                <div className="actions">
                  {wa && (
                    <a className="btn wa sm" href={wa} target="_blank" rel="noreferrer" onClick={() => onUpdate(d.searchId, d.lead, { followUpOn: addDays(3) })} title="Send a follow-up on WhatsApp; the next reminder moves 3 days out">
                      <IconWhatsApp /> Follow up
                    </a>
                  )}
                  <button type="button" className="btn sm" onClick={() => onUpdate(d.searchId, d.lead, { followUpOn: addDays(1) })}>Tomorrow</button>
                  <button type="button" className="btn sm" onClick={() => onUpdate(d.searchId, d.lead, { followUpOn: null })} title="Remove the reminder">Done</button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

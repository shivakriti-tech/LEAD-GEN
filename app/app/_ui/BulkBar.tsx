"use client";

import { useState } from "react";
import { addDays, FOLLOW_UP, type FollowUpStatus } from "@/lib/outreach";
import type { FollowUpPatch } from "@/lib/followups";
import { IconClose, IconDownload } from "./icons";

/** Appears at the bottom when leads are ticked: act on all of them at once. */
export function BulkBar({
  count,
  onPatch,
  onExport,
  onDelete,
  onClear,
  locked,
}: {
  count: number;
  onPatch: (p: FollowUpPatch) => void;
  onExport: () => void;
  onDelete: () => void;
  onClear: () => void;
  locked: boolean;
}) {
  const [confirm, setConfirm] = useState(false);
  if (!count) return null;
  return (
    <div className="bulk" role="region" aria-label="Actions for selected leads">
      <b>{count} selected</b>
      {confirm ? (
        <>
          <span>Delete {count} lead{count > 1 ? "s" : ""} from this search? This can't be undone.</span>
          <button type="button" className="btn danger sm" onClick={() => { setConfirm(false); onDelete(); }}>Delete</button>
          <button type="button" className="btn sm" onClick={() => setConfirm(false)}>Cancel</button>
        </>
      ) : (
        <>
          <button type="button" className="btn sm primary" onClick={() => onPatch({ status: "contacted" })} disabled={locked}>Mark contacted</button>
          <select
            className="sm"
            value=""
            disabled={locked}
            aria-label="Set status"
            onChange={(e) => e.target.value && onPatch({ status: e.target.value as FollowUpStatus })}
          >
            <option value="">Set status…</option>
            {FOLLOW_UP.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
          <select
            className="sm"
            value=""
            disabled={locked}
            aria-label="Set follow-up"
            onChange={(e) => e.target.value && onPatch({ followUpOn: e.target.value === "clear" ? null : e.target.value })}
          >
            <option value="">Follow up…</option>
            <option value={addDays(1)}>Tomorrow</option>
            <option value={addDays(3)}>In 3 days</option>
            <option value={addDays(7)}>Next week</option>
            <option value="clear">Clear date</option>
          </select>
          <button type="button" className="btn sm" onClick={onExport}><IconDownload /> Export</button>
          <button type="button" className="btn sm danger-ghost" onClick={() => setConfirm(true)} disabled={locked}>Delete</button>
        </>
      )}
      <span className="grow" />
      <button type="button" className="icon-btn" onClick={onClear} aria-label="Clear selection"><IconClose /></button>
    </div>
  );
}

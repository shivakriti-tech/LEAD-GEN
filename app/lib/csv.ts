import { EMAIL_KIND_LABEL } from "./enrich/email";
import { MAILBOX_LABEL } from "./enrich/mailboxLabel";
import { followUpLabel, linkedinOf } from "./outreach";
import type { Lead } from "./types";
import { phoneKind, PHONE_KIND_LABEL } from "./util";
import { needLabels } from "./score/agency";

const COLS: Array<[string, (l: Lead) => unknown]> = [
  ["Score", (l) => l.score],
  ["Status", (l) => followUpLabel(l.followUp?.status)],
  ["Note", (l) => l.followUp?.note],
  ["Tier", (l) => l.tier],
  ["Business", (l) => l.name],
  ["Type", (l) => l.category],
  ["Address", (l) => l.address],
  ["City", (l) => l.city],
  ["Phone", (l) => l.phone],
  ["Phone type", (l) => { const k = phoneKind(l.phone); return k && PHONE_KIND_LABEL[k]; }],
  ["Other phones", (l) => l.phones.filter((p) => p !== l.phone).join(" ")],
  ["WhatsApp", (l) => l.audit?.whatsapp],
  ["Email", (l) => l.email],
  ["Email type", (l) => (l.emailInfo?.[0] && l.email ? EMAIL_KIND_LABEL[l.emailInfo[0].kind] : undefined)],
  ["Email check", (l) => { const i = l.email ? l.emailInfo?.find((x) => x.email === l.email) : undefined; return !i ? undefined : i.mailbox && i.mailbox !== "unknown" ? MAILBOX_LABEL[i.mailbox] : i.deliverable ? "domain accepts mail" : "not checked"; }],
  ["Owner", (l) => l.owner?.name],
  ["Website", (l) => l.website],
  ["Website status", (l) => l.audit?.status],
  ["Mobile speed", (l) => l.audit?.pageSpeed?.score],
  ["Running since", (l) => l.audit?.foundedYear],
  ["Website built by", (l) => l.audit?.designedBy],
  ["Price range", (l) => l.priceRange],
  ["Orders/bookings via", (l) => l.orderLinks?.map((o) => o.source).join(" ")],
  ["Rating", (l) => l.rating],
  ["Reviews", (l) => l.reviews],
  ["Why now", (l) => l.whyNow],
  ["Likely needs", (l) => needLabels(l.pitchFor).join("; ")],
  ["Exports to", (l) => l.audit?.trade?.countries?.join(" ")],
  ["Listed on", (l) => l.audit?.trade?.b2b?.join(" ")],
  ["Signals", (l) => l.signals.map((s) => s.label).join("; ")],
  ["Instagram", (l) => l.social?.instagram?.url ?? l.audit?.socials.instagram],
  ["Instagram followers", (l) => l.social?.instagram?.followers],
  ["Instagram last post", (l) => l.social?.instagram?.lastPostAt?.slice(0, 10)],
  ["Facebook", (l) => l.social?.facebook?.url ?? l.audit?.socials.facebook],
  ["LinkedIn", (l) => linkedinOf(l)?.url],
  ["Google Maps", (l) => l.mapsUrl],
  ["Sources", (l) => l.sources.join(" + ")],
  ["Checked", (l) => (l.pending ? "no (search stopped before this one was checked)" : "yes")],
];

const cell = (v: unknown) => {
  const s = v == null ? "" : String(v);
  // guard against spreadsheet formula injection; plain numbers and phone numbers (+91 98…) stay as they are
  const safe = /^[=+\-@\t\r]/.test(s) && !/^[+-]?[\d\s().-]+$/.test(s) ? `'${s}` : s;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

export function leadsToCsv(leads: Lead[]): string {
  return "﻿" + [COLS.map((c) => c[0]).join(","), ...leads.map((l) => COLS.map(([, f]) => cell(f(l))).join(","))].join("\r\n");
}

import type { Lead, SearchRecord } from "./types";
import { categoryByKey } from "./categories";
import { issueChips } from "./outreach";
import { SERVICE_LABEL } from "./score/logistics";

/**
 * A one-page report of a search's best leads, to send to your client: a summary, then each
 * business with why it fits and how to reach it. Self-contained HTML (no scripts, no web fonts),
 * so it opens anywhere and prints cleanly to PDF.
 */

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const fmtPhone = (p?: string) => (p && /^\+91\d{10}$/.test(p) ? `+91 ${p.slice(3, 8)} ${p.slice(8)}` : p ?? "");
const safeUrl = (u?: string) => (u && /^https?:\/\//i.test(u) ? u : undefined);

export function leadsReport(opts: { search: SearchRecord; leads: Lead[]; by?: string; all?: boolean; now?: Date }): string {
  const { search, by, all } = opts;
  const p = search.params;
  const logistics = p.sells === "logistics";
  const place = p.area ? `${p.area}, ${p.city}` : p.city;
  const when = (opts.now ?? new Date()).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" });
  const usable = opts.leads.filter((l) => !l.pending && !l.signals.some((s) => s.key === "competitor"));
  const shown = usable.filter((l) => all || l.tier !== "cold").sort((a, b) => b.score - a.score).slice(0, 100);
  const types = p.categories.map((k) => categoryByKey(k)?.label ?? k).join(", ");
  const has = (k: string) => usable.filter((l) => l.signals.some((s) => s.key === k)).length;
  const client = p.client?.name?.trim();
  const title = logistics ? (client ? `Leads for ${client}` : "Businesses that ship goods") : "Businesses that need a website";
  const kpis: Array<[number, string]> = logistics
    ? [[usable.length, "Businesses checked"], [usable.filter((l) => l.tier === "hot").length, "Strong leads"], [has("exports"), "Exporters"], [has("industrial"), "In industrial areas"]]
    : [[usable.length, "Businesses checked"], [usable.filter((l) => l.tier === "hot").length, "Strong leads"], [usable.filter((l) => ["none", "social_only", "down"].includes(l.audit?.status ?? "none")).length, "No working website"], [usable.filter((l) => l.phone || l.phones.length).length, "With a phone number"]];

  const rows = shown
    .map((l, i) => {
      const chips = issueChips(l).map((c) => `<span class="chip ${c.kind}">${esc(c.label)}</span>`).join("");
      const needs = l.pitchFor?.needs.length ? `<div class="needs">Likely needs: ${esc(l.pitchFor.needs.map((n) => SERVICE_LABEL[n]).join(", "))}</div>` : "";
      const phone = l.phone ?? l.phones[0];
      const site = safeUrl(l.audit?.finalUrl ?? l.website);
      const contact = [
        phone && `<div>${esc(fmtPhone(phone))}</div>`,
        l.email && `<div><a href="mailto:${esc(l.email)}">${esc(l.email)}</a></div>`,
        site && `<div><a href="${esc(site)}">${esc(site.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, ""))}</a></div>`,
        l.owner?.name && `<div class="muted">Owner: ${esc(l.owner.name)}</div>`,
      ].filter(Boolean).join("") || `<span class="muted">Not found</span>`;
      return `<tr>
  <td class="n">${i + 1}</td>
  <td><b>${esc(l.name)}</b><div class="muted">${esc([l.category, l.address ?? l.city].filter(Boolean).join(" · "))}</div>${l.rating != null ? `<div class="muted">${esc(l.rating.toFixed(1))}★ · ${esc(l.reviews ?? 0)} reviews</div>` : ""}</td>
  <td><div class="chips">${chips}</div><div>${esc(l.pitchFor ? l.whyNow.replace(/\s*Likely needs [^.]*\.$/, "") : l.whyNow)}</div>${needs}</td>
  <td class="contact">${contact}</td>
  <td class="score"><span class="s ${l.tier}">${l.score}</span></td>
</tr>`;
    })
    .join("\n");

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} · ${esc(place)}</title>
<style>
:root { --ink:#1A1714; --muted:#6E685F; --line:#E7E3DB; --tray:#EEEBE5; --ground:#F6F5F2; --accent:#D2461A; --dark:#2A1F18; --good:#1E7B46; --bad:#B42318; }
* { box-sizing: border-box; }
body { margin: 0; background: var(--ground); color: var(--ink); font: 14px/1.5 -apple-system, "Segoe UI", Inter, Roboto, Helvetica, Arial, sans-serif; }
.page { max-width: 1100px; margin: 0 auto; padding: 40px 32px 56px; }
.top { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; }
.brand { display: flex; align-items: center; gap: 8px; font-weight: 800; letter-spacing: -.02em; }
.mark { width: 22px; height: 22px; border-radius: 7px; background: var(--dark); position: relative; }
.mark::after { content: ""; position: absolute; left: 12px; top: 5px; width: 5px; height: 12px; border-radius: 2px; background: #F0561D; }
.brand span { color: var(--accent); }
.kicker { color: var(--accent); font-weight: 700; font-size: 13px; margin-top: 28px; }
h1 { font-size: 34px; line-height: 1.15; letter-spacing: -.03em; margin: 4px 0 6px; }
.meta { color: var(--muted); }
.kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin: 24px 0; }
.kpi { background: #fff; border-radius: 18px; padding: 16px 18px; }
.kpi b { display: block; font-size: 30px; letter-spacing: -.03em; line-height: 1.1; }
.kpi span { color: var(--muted); font-size: 13px; }
.kpi:first-child { background: var(--dark); color: #fff; }
.kpi:first-child span { color: #C4B3A5; }
.card { background: #fff; border-radius: 22px; padding: 6px; }
table { width: 100%; border-collapse: collapse; }
th { text-align: left; font-size: 12px; color: var(--muted); font-weight: 600; padding: 12px; border-bottom: 1px solid var(--line); }
td { padding: 12px; border-bottom: 1px solid #F3F1EC; vertical-align: top; }
tr:last-child td { border-bottom: 0; }
td.n { color: var(--muted); width: 28px; }
td.contact { font-size: 13px; white-space: nowrap; }
td.score { text-align: right; width: 56px; }
.s { display: inline-block; min-width: 38px; text-align: center; padding: 4px 8px; border-radius: 10px; font-weight: 700; background: var(--tray); color: var(--muted); }
.s.hot { background: var(--dark); color: #FFB08F; }
.s.warm { background: #FDEBE2; color: #B63C10; }
.muted { color: var(--muted); font-size: 12.5px; }
.chips { display: flex; gap: 4px; flex-wrap: wrap; margin-bottom: 4px; }
.chip { font-size: 11.5px; font-weight: 600; padding: 1px 8px; border-radius: 999px; background: var(--tray); color: #3D3831; }
.chip.good { background: #E8F5ED; color: var(--good); }
.chip.bad { background: #FDECEA; color: var(--bad); }
.chip.warn { background: #FFF3DC; color: #8A5A05; }
.needs { margin-top: 4px; font-size: 12.5px; font-weight: 600; color: #B63C10; }
a { color: inherit; }
.foot { color: var(--muted); font-size: 12px; margin-top: 18px; }
.print { border: 0; background: var(--accent); color: #fff; font-weight: 700; padding: 10px 18px; border-radius: 999px; cursor: pointer; font-size: 14px; }
@media (max-width: 760px) { .kpis { grid-template-columns: 1fr 1fr; } td.contact { white-space: normal; } .page { padding: 24px 14px; } }
@media print { body { background: #fff; } .page { padding: 0; } .print { display: none; } .kpi { border: 1px solid var(--line); } .card { padding: 0; } tr { break-inside: avoid; } @page { margin: 14mm; } }
</style></head>
<body><div class="page">
<div class="top"><div class="brand"><i class="mark"></i>Lead<span>Autopilot</span></div><button class="print" onclick="window.print()">Save as PDF</button></div>
<div class="kicker">Lead report</div>
<h1>${esc(title)}</h1>
<div class="meta">${esc(types)} in ${esc(place)} · ${esc(when)}${by ? ` · prepared by ${esc(by)}` : ""}${logistics && p.client?.services.length ? `<br>Services: ${esc(p.client.services.map((s) => SERVICE_LABEL[s]).join(", "))}` : ""}</div>
<div class="kpis">${kpis.map(([n, l]) => `<div class="kpi"><b>${n}</b><span>${esc(l)}</span></div>`).join("")}</div>
<div class="card"><table>
<thead><tr><th>#</th><th>Business</th><th>Why they fit</th><th>Contact</th><th style="text-align:right">Score</th></tr></thead>
<tbody>
${rows || `<tr><td colspan="5" class="muted">No leads to show yet.</td></tr>`}
</tbody></table></div>
<p class="foot">${all ? "All leads" : "Strong and possible leads"}, best first (${shown.length} of ${usable.length}${logistics ? "; transport and courier companies left out" : ""}). Contacts come from public business listings (Google Maps, OpenStreetMap) and the businesses' own websites, checked on ${esc(when)}.</p>
</div></body></html>`;
}

import type { Lead, SearchRecord } from "./types";
import { categoryByKey } from "./categories";
import { issueChips, linkedinOf } from "./outreach";
import { SERVICE_LABEL } from "./score/logistics";
import { AGENCY_CHIP, needLabels } from "./score/agency";
import { marketOf } from "./markets";

/**
 * A one-page report of a search's best leads, to send to your client: a summary, then each
 * business with why it fits and how to reach it. Self-contained HTML (no scripts, no web fonts),
 * so it opens anywhere and prints cleanly to PDF.
 */

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const fmtPhone = (p?: string) => (p && /^\+91\d{10}$/.test(p) ? `+91 ${p.slice(3, 8)} ${p.slice(8)}` : p ?? "");
/** Text for a CSS string (the printed page footer): no quotes, backslashes, tags or line breaks. */
const cssText = (s: string) => s.replace(/[\\"'<>\r\n]/g, " ").slice(0, 120);
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const safeUrl = (u?: string) => (u && /^https?:\/\//i.test(u) ? u : undefined);

export function leadsReport(opts: { search: SearchRecord; leads: Lead[]; by?: string; all?: boolean; now?: Date; pdfHref?: string; notice?: string }): string {
  const { search, by, all } = opts;
  const p = search.params;
  const logistics = p.sells === "logistics";
  const agency = p.sells === "agency";
  const country = p.country && p.country !== "IN" ? marketOf(p.country).name : "";
  const place = [p.area, p.city, country].filter(Boolean).join(", ");
  const when = (opts.now ?? new Date()).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" });
  const usable = opts.leads.filter((l) => !l.pending && !l.signals.some((s) => s.key === "competitor"));
  const shown = usable.filter((l) => all || l.tier !== "cold").sort((a, b) => b.score - a.score).slice(0, 100);
  const types = p.categories.map((k) => categoryByKey(k)?.label ?? k).join(", ");
  const has = (k: string) => usable.filter((l) => l.signals.some((s) => s.key === k)).length;
  const client = p.client?.name?.trim();
  const title = logistics ? (client ? `Leads for ${client}` : "Businesses that ship goods") : agency ? (client ? `Leads for ${client}` : "Businesses to build for") : "Businesses that need a website";
  const needing = (...xs: string[]) => usable.filter((l) => l.pitchFor?.kind === "agency" && l.pitchFor.needs.some((n) => xs.includes(n))).length;
  const kpis: Array<[number, string]> = agency
    ? [[usable.length, "Businesses checked"], [usable.filter((l) => l.tier === "hot").length, "Strong leads"], [needing("ecommerce"), "Need a store"], [needing("crm_erp", "ai_automation"), "Need CRM / ERP or automation"]]
    : logistics
    ? [[usable.length, "Businesses checked"], [usable.filter((l) => l.tier === "hot").length, "Strong leads"], [has("exports"), "Exporters"], [has("industrial"), "In industrial areas"]]
    : [[usable.length, "Businesses checked"], [usable.filter((l) => l.tier === "hot").length, "Strong leads"], [usable.filter((l) => ["none", "social_only", "down"].includes(l.audit?.status ?? "none")).length, "No working website"], [usable.filter((l) => l.phone || l.phones.length).length, "With a phone number"]];

  const strong = shown.filter((l) => l.tier === "hot");
  const rest = shown.filter((l) => l.tier !== "hot");
  let n = 0;
  const card = (l: Lead) => {
    n++;
    const chips = issueChips(l).map((c) => `<span class="chip ${c.kind}">${esc(c.label)}</span>`).join("");
    const why = l.pitchFor ? l.whyNow.replace(/\s*Likely needs [^.]*\.$/, "") : l.whyNow;
    const needs = l.pitchFor?.needs.length ? `<p class="needs"><span>Likely needs:</span> ${esc(needLabels(l.pitchFor).join(", "))}</p>` : "";
    const phone = l.phone ?? l.phones[0];
    const site = safeUrl(l.audit?.finalUrl ?? l.website);
    const li = linkedinOf(l);
    const line = (label: string, v: string) => `<div class="c"><dt>${label}</dt><dd>${v}</dd></div>`;
    const contact = [
      phone && line("Phone", `<a href="tel:${esc(phone)}">${esc(fmtPhone(phone))}</a>`),
      l.email && line("Email", `<a href="mailto:${esc(l.email)}">${esc(l.email)}</a>`),
      site && line("Website", `<a href="${esc(site)}">${esc(site.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, ""))}</a>`),
      li && line("LinkedIn", `<a href="${esc(li.url)}">${esc(li.url.replace(/^https:\/\/www\.linkedin\.com\//, ""))}</a>`),
      l.owner?.name && line("Owner", esc(l.owner.name)),
    ].filter(Boolean).join("") || `<div class="c"><dd class="muted">No contact found</dd></div>`;
    const meta = [l.category, l.address ?? l.city].filter(Boolean).map(esc).join(" · ") + (l.rating != null ? ` · ${esc(l.rating.toFixed(1))}★ (${esc(l.reviews ?? 0)})` : "");
    return `<li class="lead">
  <div class="main">
    <div class="name"><span class="rank">${n}</span><h3>${esc(l.name)}</h3><span class="s ${l.tier}" title="Score out of 100">${l.score}</span></div>
    <p class="meta">${meta}</p>
    ${chips ? `<div class="chips">${chips}</div>` : ""}
    <p class="why">${esc(why)}</p>
    ${needs}
  </div>
  <dl class="contact">${contact}</dl>
</li>`;
  };
  const section = (head: string, note: string, list: Lead[]) =>
    list.length ? `<section><div class="sh"><h2>${head} <span>${list.length}</span></h2><p>${note}</p></div><ol class="leads">${list.map(card).join("\n")}</ol></section>` : "";
  const facts: Array<[string, string]> = [
    ["Area", place],
    ["Date", when],
    ["Prepared by", by ?? ""],
    ["Business types", types],
    ...(!logistics && client ? [["For", client] as [string, string]] : []),
    ...(agency && p.agency?.services.length ? [["Services", p.agency.services.map((x) => AGENCY_CHIP[x]).join(", ")] as [string, string]] : []),
    ...(logistics && p.client?.services.length ? [["Services", cap(p.client.services.map((x) => SERVICE_LABEL[x]).join(", "))] as [string, string]] : []),
  ];

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} · ${esc(place)}</title>
<style>
:root { --ink:#1A1714; --muted:#6E685F; --line:#E7E3DB; --soft:#F1EEE8; --tray:#EEEBE5; --ground:#F6F5F2; --accent:#D2461A; --accent-ink:#B63C10; --dark:#2A1F18; --good:#1E7B46; --bad:#B42318; }
* { box-sizing: border-box; }
html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body { margin: 0; background: var(--ground); color: var(--ink); font: 14px/1.5 -apple-system, "Segoe UI", Inter, Roboto, Helvetica, Arial, sans-serif; }
p, h1, h2, h3, ol, dl, dd { margin: 0; padding: 0; }
a { color: inherit; text-decoration-color: #C9C2B6; text-underline-offset: 2px; }
.page { max-width: 980px; margin: 0 auto; padding: 36px 28px 56px; }
.bar { display: flex; justify-content: space-between; align-items: center; gap: 16px; }
.brand { display: flex; align-items: center; gap: 8px; font-weight: 800; letter-spacing: -.02em; }
.mark { width: 22px; height: 22px; border-radius: 7px; background: var(--dark); position: relative; flex: none; }
.mark::after { content: ""; position: absolute; left: 12px; top: 5px; width: 5px; height: 12px; border-radius: 2px; background: #F0561D; }
.brand span { color: var(--accent); }
.print { display: inline-block; text-decoration: none; border: 0; background: var(--accent); color: #fff; font: inherit; font-weight: 700; padding: 9px 18px; border-radius: 999px; cursor: pointer; }
.notice { margin-top: 14px; padding: 10px 14px; border-radius: 12px; background: #FFF3DC; color: #8A5A05; font-size: 13px; }
.hero { background: #fff; border-radius: 22px; padding: 26px 28px; margin-top: 22px; }
.kicker { color: var(--accent-ink); font-weight: 700; font-size: 12px; letter-spacing: .06em; text-transform: uppercase; }
h1 { font-size: 30px; line-height: 1.15; letter-spacing: -.03em; margin: 6px 0 18px; }
.facts { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px 24px; padding-top: 16px; border-top: 1px solid var(--line); }
.facts dt { font-size: 11.5px; color: var(--muted); font-weight: 600; }
.facts dd { font-size: 13.5px; font-weight: 600; }
.facts .wide { grid-column: 1 / -1; }
.kpis { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; margin: 12px 0 28px; }
.kpi { background: #fff; border-radius: 18px; padding: 14px 16px; }
.kpi b { display: block; font-size: 26px; letter-spacing: -.03em; line-height: 1.1; }
.kpi span { color: var(--muted); font-size: 12.5px; }
.kpi:first-child { background: var(--dark); color: #fff; }
.kpi:first-child span { color: #C4B3A5; }
section + section { margin-top: 28px; }
.sh { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; margin: 0 4px 10px; }
h2 { font-size: 18px; letter-spacing: -.02em; }
h2 span { display: inline-block; min-width: 24px; padding: 0 7px; margin-left: 4px; border-radius: 999px; background: var(--tray); color: var(--muted); font-size: 12.5px; text-align: center; vertical-align: 2px; }
.sh p { color: var(--muted); font-size: 12.5px; }
.leads { list-style: none; background: #fff; border-radius: 22px; overflow: hidden; }
.lead { display: grid; grid-template-columns: minmax(0, 1fr) 250px; gap: 24px; padding: 18px 22px; border-top: 1px solid var(--soft); }
.lead:first-child { border-top: 0; }
.name { display: flex; align-items: flex-start; gap: 10px; }
.rank { flex: none; width: 24px; height: 24px; border-radius: 8px; background: var(--tray); color: var(--muted); font-size: 12px; font-weight: 700; display: grid; place-items: center; margin-top: 1px; }
h3 { font-size: 16px; line-height: 1.35; letter-spacing: -.01em; flex: 1; min-width: 0; }
.s { flex: none; min-width: 38px; text-align: center; padding: 2px 8px; border-radius: 9px; font-weight: 700; font-size: 13px; background: var(--tray); color: var(--muted); }
.s.hot { background: var(--dark); color: #FFB08F; }
.s.warm { background: #FDEBE2; color: var(--accent-ink); }
.meta { color: var(--muted); font-size: 12.5px; margin: 2px 0 0 34px; }
.chips, .why, .needs { margin-left: 34px; }
.chips { display: flex; gap: 4px; flex-wrap: wrap; margin-top: 10px; }
.chip { font-size: 11.5px; font-weight: 600; padding: 1px 8px; border-radius: 999px; background: var(--tray); color: #3D3831; }
.chip.good { background: #E8F5ED; color: var(--good); }
.chip.bad { background: #FDECEA; color: var(--bad); }
.chip.warn { background: #FFF3DC; color: #8A5A05; }
.why { margin-top: 8px; }
.needs { margin-top: 6px; font-size: 13px; font-weight: 600; color: var(--accent-ink); }
.needs span { color: var(--muted); font-weight: 600; }
.contact { display: grid; gap: 6px; align-content: start; align-self: start; padding: 12px 14px; background: var(--ground); border-radius: 14px; font-size: 13px; }
.contact .c { display: grid; grid-template-columns: 58px minmax(0, 1fr); gap: 8px; }
.contact dt { color: var(--muted); font-size: 11.5px; padding-top: 1px; }
.contact dd { overflow-wrap: anywhere; }
.muted { color: var(--muted); }
.foot { margin-top: 22px; padding: 16px 4px 0; border-top: 1px solid var(--line); color: var(--muted); font-size: 12px; display: grid; gap: 6px; }
.foot b { color: var(--ink); }
@media screen and (max-width: 760px) {
  .page { padding: 18px 14px 40px; }
  .hero { padding: 20px; border-radius: 18px; }
  h1 { font-size: 25px; }
  .facts { grid-template-columns: 1fr 1fr; }
  .kpis { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .sh { flex-direction: column; gap: 2px; }
  .lead { grid-template-columns: 1fr; gap: 12px; padding: 16px; }
  .meta, .chips, .why, .needs { margin-left: 0; }
  .meta { margin-top: 4px; }
}
@page { size: A4; margin: 12mm 12mm 14mm; @bottom-left { content: "${cssText(`${title} · ${place}`)}"; font: 8pt sans-serif; color: #6E685F; } @bottom-right { content: "Page " counter(page) " of " counter(pages); font: 8pt sans-serif; color: #6E685F; } }
@media print {
  body { background: #fff; font-size: 10pt; }
  .page { max-width: none; padding: 0; }
  .print, .notice { display: none; }
  .hero { padding: 0 0 4mm; border-radius: 0; margin-top: 5mm; }
  h1 { font-size: 20pt; margin-bottom: 4mm; }
  .facts { grid-template-columns: repeat(3, 1fr); gap: 2mm 6mm; padding-top: 3mm; }
  .facts dd { font-size: 9.5pt; }
  .kpis { gap: 3mm; margin: 2mm 0 6mm; padding: 0 1px; }
  .kpi { box-shadow: inset 0 0 0 1px var(--line); border-radius: 3mm; padding: 2.5mm 3.5mm; }
  .kpi b { font-size: 16pt; }
  .kpi span { font-size: 8.5pt; }
  section + section { margin-top: 6mm; }
  .sh { break-after: avoid; margin: 0 0 2mm; }
  h2 { font-size: 13pt; }
  .leads { border-radius: 0; overflow: visible; border-top: 1.5px solid var(--ink); }
  .lead { grid-template-columns: minmax(0, 1fr) 58mm; gap: 5mm; padding: 3.5mm 0; border-top: 1px solid var(--line); break-inside: avoid; }
  .lead:first-child { border-top: 0; }
  h3 { font-size: 11pt; }
  .meta, .contact, .needs { font-size: 8.5pt; }
  .chip { font-size: 7.5pt; }
  .contact { padding: 2.5mm 3mm; border-radius: 2mm; }
  .contact .c { grid-template-columns: 13mm minmax(0, 1fr); gap: 2mm; }
  .contact dt { font-size: 7.5pt; }
  a { text-decoration: none; }
  .foot { font-size: 8pt; break-inside: avoid; }
}
</style></head>
<body><div class="page">
<div class="bar"><div class="brand"><i class="mark"></i>Lead<span>Autopilot</span></div>${opts.pdfHref ? `<a class="print" href="${esc(opts.pdfHref)}">Download PDF</a>` : `<button class="print" onclick="window.print()">Print</button>`}</div>
${opts.notice ? `<p class="notice">${esc(opts.notice)}</p>` : ""}
<header class="hero">
  <div class="kicker">Lead report</div>
  <h1>${esc(title)}</h1>
  <dl class="facts">${facts.filter(([, v]) => v).map(([k, v], i) => `<div${i > 2 || (i === 2 && !by) ? ` class="wide"` : ""}><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join("")}</dl>
</header>
<div class="kpis">${kpis.map(([k, l]) => `<div class="kpi"><b>${k}</b><span>${esc(l)}</span></div>`).join("")}</div>
${section("Strong leads", "Best fit. Contact these first.", strong)}
${section(all ? "Other leads" : "Possible leads", all ? "Everything else we checked, best first." : "Good fit, worth a call after the strong ones.", rest)}
${shown.length ? "" : `<p class="muted">No leads to show yet.</p>`}
<footer class="foot">
  <p><b>Score</b> is out of 100: ${logistics || agency ? "60" : "65"} and above is a strong lead, ${logistics || agency ? "30 to 59" : "40 to 64"} a possible one. ${logistics ? "It is higher for factories and exporters in industrial areas that supply across India, counting only the services offered." : agency ? "It is higher for brands without a store of their own or on an outdated one, and for companies with an old website, no customer portal and manual office work, counting only the services offered." : "It is higher for busy, well-rated businesses with no website or a weak one."}</p>
  <p>${all ? "All leads" : "Strong and possible leads"}, best first (${shown.length} of ${usable.length}${logistics ? "; transport and courier companies left out" : agency ? "; web and software companies left out" : ""}). Contacts come from public business listings (Google Maps, OpenStreetMap) and the businesses' own websites, checked on ${esc(when)}.</p>
</footer>
</div></body></html>`;
}

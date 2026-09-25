import type { RawPlace } from "../types";

/**
 * Google Maps via the open-source gosom/google-maps-scraper, running in Docker on your own computer.
 *
 * TESTING ONLY. It reads the Google Maps website directly, which is against Google's terms,
 * and Google blocks the connection if it's overused. The app refuses to use it in a production
 * build; the live product uses the official Places API instead.
 *
 * API (see app/gmaps-scraper/README): POST /api/v1/jobs → poll GET /api/v1/jobs/{id}
 * until Status is "ok" → GET /api/v1/jobs/{id}/download (CSV).
 */

/** Only when configured AND not a production build. */
export function gmapsScraperUrl(env: Record<string, string | undefined> = process.env): string | undefined {
  const url = (env.GMAPS_SCRAPER_URL || "").trim();
  if (!url) return undefined;
  if (env.NODE_ENV === "production" || env.VERCEL || env.RENDER) return undefined;
  return url.replace(/\/+$/, "");
}

/** Small CSV parser: quoted fields, doubled quotes, commas and newlines inside quotes. */
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  const s = text.replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && s[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some((x) => x !== "")) rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== "" || row.length) { row.push(field); if (row.some((x) => x !== "")) rows.push(row); }
  const [head, ...body] = rows;
  if (!head) return [];
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h.trim(), (r[i] ?? "").trim()])));
}

const num = (v?: string) => {
  const n = Number(String(v ?? "").replace(/,/g, ""));
  return Number.isFinite(n) && v !== "" ? n : undefined;
};

export function rowToRaw(r: Record<string, string>, category: string, city: string): RawPlace | null {
  const name = r.title?.trim();
  if (!name) return null;
  const status = (r.status || "").toLowerCase();
  const email = (r.emails || "").split(/[,;\s]+/).map((e) => e.trim().toLowerCase()).find((e) => /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/.test(e));
  return {
    source: "gmaps",
    sourceId: r.place_id || r.data_id || r.cid || r.link || name,
    name,
    category,
    address: r.address || undefined,
    city,
    lat: num(r.latitude),
    lng: num(r.longitude),
    phone: r.phone || undefined,
    website: r.website || undefined,
    email,
    rating: num(r.review_rating),
    reviews: num(r.review_count),
    businessStatus: /permanently closed|closed permanently/.test(status)
      ? "CLOSED_PERMANENTLY"
      : /temporarily closed|closed temporarily/.test(status)
        ? "CLOSED_TEMPORARILY"
        : undefined,
    mapsUrl: r.link || undefined,
  };
}

export interface ScrapeRequest {
  category: string; // our label, e.g. "Furniture shop"
  keyword: string; // "furniture shop in Vadodara"
}

export interface ScrapeResult {
  category: string;
  places: RawPlace[];
  error?: string;
}

export interface GmapsDeps {
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

/**
 * Runs one scraper job per business type, ONE AT A TIME.
 * The scraper itself works through its queue one job after another, so queuing all of them at once
 * only made the later ones hit our time limit before they had even started.
 * `max` sets how far the scraper scrolls the results (about 15 per scroll).
 */
export async function gmapsScrapeBatch(
  opts: { baseUrl: string; city: string; requests: ScrapeRequest[]; max: number; onProgress?: (msg: string) => void },
  deps: GmapsDeps = {},
): Promise<ScrapeResult[]> {
  const f = deps.fetch ?? fetch;
  const sleep = deps.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const now = deps.now ?? Date.now;
  const depth = Math.min(10, Math.max(1, Math.ceil(opts.max / 15)));
  const maxTimeSec = Math.min(900, 90 + depth * 45); // scraper stops itself after this
  const notRunning = `scraper not running at ${opts.baseUrl} (start it with docker compose up -d in app/gmaps-scraper)`;
  const del = (id: string) => f(`${opts.baseUrl}/api/v1/jobs/${id}`, { method: "DELETE" }).catch(() => {});

  // 0. clear our own leftover jobs from an earlier search that was stopped, or they run first
  try {
    const r = await f(`${opts.baseUrl}/api/v1/jobs`);
    if (r.ok) {
      const list = (await r.json().catch(() => [])) as Array<Record<string, unknown>>;
      const stale = (Array.isArray(list) ? list : []).filter((j) => {
        const st = String(j.Status ?? j.status ?? "").toLowerCase();
        return String(j.Name ?? j.name ?? "").startsWith("lead-autopilot") && (st === "pending" || st === "working");
      });
      for (const j of stale) await del(String(j.ID ?? j.id));
      if (stale.length) opts.onProgress?.(`Google Maps scraper: cleared ${stale.length} unfinished job(s) from an earlier search.`);
    }
  } catch {}

  const out: ScrapeResult[] = [];
  let down = false;
  for (let i = 0; i < opts.requests.length; i++) {
    const req = opts.requests[i];
    const tag = `Google Maps scraper ${i + 1}/${opts.requests.length} (${req.category})`;
    if (down) { out.push({ category: req.category, places: [], error: notRunning }); continue; }

    // 1. queue the job
    let id: string;
    try {
      const res = await f(`${opts.baseUrl}/api/v1/jobs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: `lead-autopilot ${req.keyword}`, keywords: [req.keyword], lang: "en", depth, email: true, max_time: maxTimeSec, zoom: 15 }),
      });
      const j = (await res.json().catch(() => ({}))) as { id?: string; message?: string };
      if (!res.ok || !j.id) throw new Error(j.message || `HTTP ${res.status}`);
      id = j.id;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/fetch failed|ECONNREFUSED|ENOTFOUND/i.test(msg)) down = true;
      out.push({ category: req.category, places: [], error: down ? notRunning : msg });
      continue;
    }

    // 2. wait for it (a job that never starts is given up on sooner)
    const started = now();
    const deadline = started + (maxTimeSec + 90) * 1000;
    let st = "";
    let lastReport = started;
    opts.onProgress?.(`${tag}: searching "${req.keyword}"…`);
    while (!["ok", "failed"].includes(st) && now() < deadline) {
      await sleep(5000);
      try {
        const r = await f(`${opts.baseUrl}/api/v1/jobs/${id}`);
        const body = (await r.json()) as Record<string, unknown>;
        st = String(body.Status ?? body.status ?? "").toLowerCase() || st;
      } catch {}
      if (st === "pending" && now() - started > 120_000) break; // scraper is stuck on something else
      if (now() - lastReport >= 60_000) {
        lastReport = now();
        opts.onProgress?.(`${tag}: still ${st || "waiting"} (${Math.round((now() - started) / 1000)} s)…`);
      }
    }

    // 3. download
    if (st === "failed") { out.push({ category: req.category, places: [], error: "the scraper reported the job failed (Google may be blocking it)" }); del(id); continue; }
    if (st !== "ok") {
      out.push({ category: req.category, places: [], error: st === "pending" ? "the scraper never started this job (open http://localhost:8090 to see what it's busy with)" : `timed out after ${Math.round((now() - started) / 60000)} min` });
      del(id);
      continue;
    }
    try {
      const r = await f(`${opts.baseUrl}/api/v1/jobs/${id}/download`);
      if (!r.ok) throw new Error(`download HTTP ${r.status}`);
      const rows = parseCsv(await r.text());
      const places = rows.map((row) => rowToRaw(row, req.category, opts.city)).filter((x): x is RawPlace => !!x).slice(0, opts.max);
      out.push({ category: req.category, places, error: rows.length ? undefined : "no results (Google may be showing the scraper a captcha)" });
      opts.onProgress?.(`${tag}: ${places.length} businesses.`);
    } catch (e) {
      out.push({ category: req.category, places: [], error: e instanceof Error ? e.message : String(e) });
    }
    del(id); // tidy up the scraper's job list
  }
  return out;
}

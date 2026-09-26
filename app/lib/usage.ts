import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

/**
 * Counts calls to each outside service per day and per month, so a free allowance is never
 * exceeded by accident, and the app can show how much is left. Kept in .data/usage.json.
 */

export interface Limit {
  n: number;
  per: "day" | "month";
}

export interface UsageBook {
  used(id: string, per: "day" | "month"): number;
  add(id: string): void;
}

interface Entry {
  day: string;
  dayCount: number;
  month: string;
  monthCount: number;
}

function book(load: () => Record<string, Entry>, save: (d: Record<string, Entry>) => void, now: () => Date): UsageBook {
  let data: Record<string, Entry> | null = null;
  const get = () => (data ??= load());
  const today = () => now().toISOString().slice(0, 10);
  const entry = (id: string): Entry => {
    const d = today(), m = d.slice(0, 7);
    const e = get()[id] ?? { day: d, dayCount: 0, month: m, monthCount: 0 };
    if (e.day !== d) Object.assign(e, { day: d, dayCount: 0 });
    if (e.month !== m) Object.assign(e, { month: m, monthCount: 0 });
    return (get()[id] = e);
  };
  return {
    used: (id, per) => (per === "day" ? entry(id).dayCount : entry(id).monthCount),
    add: (id) => {
      const e = entry(id);
      e.dayCount++;
      e.monthCount++;
      save(get());
    },
  };
}

export function fileUsage(file = path.join(process.cwd(), ".data", "usage.json"), now = () => new Date()): UsageBook {
  return book(
    () => {
      try {
        return JSON.parse(readFileSync(file, "utf8"));
      } catch {
        return {};
      }
    },
    (d) => {
      try {
        mkdirSync(path.dirname(file), { recursive: true });
        writeFileSync(file, JSON.stringify(d));
      } catch {
        // counting is best-effort; the service itself still enforces its own limit
      }
    },
    now,
  );
}

export function memoryUsage(now = () => new Date()): UsageBook {
  let d: Record<string, Entry> = {};
  return book(() => d, (x) => (d = x), now);
}

/** "google_cse=100/day,tavily=1000/month" → { google_cse: {n:100, per:"day"}, … } */
export function parseLimits(s = ""): Record<string, Limit> {
  const out: Record<string, Limit> = {};
  for (const part of s.split(",")) {
    const m = part.trim().match(/^([a-z_]+)\s*=\s*(\d+)\s*\/\s*(day|month)$/i);
    if (m) out[m[1].toLowerCase()] = { n: Number(m[2]), per: m[3].toLowerCase() as Limit["per"] };
  }
  return out;
}

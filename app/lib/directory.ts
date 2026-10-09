import { promises as fs } from "node:fs";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Lead } from "./types";
import { supabase, writeAtomic } from "./store";

/**
 * The saved lead directory: businesses already found and checked, per city, area and business type.
 * Filled by searches and by `npm run prefill`, so a later search starts from checked data and only
 * has to recheck what's old and look for what's new. Stored in Supabase, or as JSON files in .data/directory.
 *
 * Only public business facts are kept here. Your statuses, notes and scores stay with each search.
 */

export const DAY = 86_400_000;
/** Saved data older than this isn't used; the search runs fully live instead. */
export const DIRECTORY_MAX_AGE = 30 * DAY;
/** A saved business checked longer ago than this is checked again during the search. */
export const RECHECK_AFTER = 7 * DAY;

export interface DirectoryEntry {
  city: string;
  area?: string;
  category: string; // preset key
  savedAt: string;
  /** Sources that found these businesses; a search with more sources runs the missing ones live. */
  sources?: string[];
  leads: Lead[];
}

export interface Directory {
  get(city: string, area: string | undefined, category: string): Promise<DirectoryEntry | undefined>;
  put(entry: DirectoryEntry): Promise<void>;
  list(city?: string): Promise<Array<Omit<DirectoryEntry, "leads"> & { count: number }>>;
}

const slug = (s?: string) => (s ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "_all";

/** What the directory keeps of a lead: the facts, not anything about your outreach. */
export function forDirectory(l: Lead, now = new Date()): Lead {
  const { followUp, pitchFor, pending, changes, ...facts } = l;
  void followUp; void pitchFor; void pending; void changes;
  return { ...facts, checkedAt: l.checkedAt ?? now.toISOString() };
}

export function localDirectory(root = () => path.join(/*turbopackIgnore: true*/ process.cwd(), ".data", "directory")): Directory {
  const file = (city: string, area: string | undefined, category: string) => path.join(root(), slug(city), slug(area), `${slug(category)}.json`);
  return {
    async get(city, area, category) {
      try {
        const e = JSON.parse(await fs.readFile(/*turbopackIgnore: true*/ file(city, area, category), "utf8")) as DirectoryEntry;
        return Date.now() - Date.parse(e.savedAt) < DIRECTORY_MAX_AGE && e.leads.length ? e : undefined;
      } catch {
        return undefined;
      }
    },
    async put(entry) {
      const f = file(entry.city, entry.area, entry.category);
      await fs.mkdir(path.dirname(f), { recursive: true });
      await writeAtomic(f, JSON.stringify(entry));
    },
    async list(city) {
      const out: Array<Omit<DirectoryEntry, "leads"> & { count: number }> = [];
      const base = root();
      const cities = city ? [slug(city)] : await fs.readdir(/*turbopackIgnore: true*/ base).catch(() => [] as string[]);
      for (const c of cities) {
        for (const a of await fs.readdir(/*turbopackIgnore: true*/ path.join(/*turbopackIgnore: true*/ base, c)).catch(() => [] as string[])) {
          for (const f of await fs.readdir(/*turbopackIgnore: true*/ path.join(/*turbopackIgnore: true*/ base, c, a)).catch(() => [] as string[])) {
            try {
              const e = JSON.parse(await fs.readFile(/*turbopackIgnore: true*/ path.join(/*turbopackIgnore: true*/ base, c, a, f), "utf8")) as DirectoryEntry;
              out.push({ city: e.city, area: e.area, category: e.category, savedAt: e.savedAt, count: e.leads.length });
            } catch {}
          }
        }
      }
      return out.sort((x, y) => y.savedAt.localeCompare(x.savedAt));
    },
  };
}

/** One row per city/area/business type in Supabase's `directory` table. */
export function supabaseDirectory(db: SupabaseClient): Directory {
  const key = (c: string, a: string | undefined, cat: string) => `${slug(c)}/${slug(a)}/${slug(cat)}`;
  return {
    async get(city, area, category) {
      const { data, error } = await db.from("directory").select("data").eq("key", key(city, area, category)).maybeSingle();
      if (error) throw new Error(`Supabase: ${error.message}`);
      const e = (data as { data: DirectoryEntry } | null)?.data;
      return e && Date.now() - Date.parse(e.savedAt) < DIRECTORY_MAX_AGE && e.leads.length ? e : undefined;
    },
    async put(e) {
      const { error } = await db.from("directory").upsert({
        key: key(e.city, e.area, e.category), city: e.city, area: e.area ?? null, category: e.category, saved_at: e.savedAt, count: e.leads.length, data: e,
      });
      if (error) throw new Error(`Supabase: ${error.message}`);
    },
    async list(city) {
      let q = db.from("directory").select("key, city, area, category, saved_at, count").order("saved_at", { ascending: false }).limit(2000);
      if (city) q = q.like("key", `${slug(city)}/%`);
      const { data, error } = await q;
      if (error) throw new Error(`Supabase: ${error.message}`);
      return (data ?? []).map((r: any) => ({ city: r.city, area: r.area ?? undefined, category: r.category, savedAt: new Date(r.saved_at).toISOString(), count: r.count }));
    },
  };
}

/** The app's directory: Supabase when it's set up, otherwise .data/directory. */
export function getDirectory(): Directory {
  const db = supabase();
  return db ? supabaseDirectory(db) : localDirectory();
}

/** For tests and the prefill script's dry runs: a directory that lives in memory. */
export function memoryDirectory(): Directory & { entries: Map<string, DirectoryEntry> } {
  const entries = new Map<string, DirectoryEntry>();
  const k = (c: string, a: string | undefined, cat: string) => `${slug(c)}/${slug(a)}/${slug(cat)}`;
  return {
    entries,
    async get(c, a, cat) {
      const e = entries.get(k(c, a, cat));
      return e && Date.now() - Date.parse(e.savedAt) < DIRECTORY_MAX_AGE ? structuredClone(e) : undefined;
    },
    async put(e) {
      entries.set(k(e.city, e.area, e.category), structuredClone(e));
    },
    async list() {
      return [...entries.values()].map(({ leads, ...e }) => ({ ...e, count: leads.length }));
    },
  };
}

/** What changed between a saved business and a fresh check of it, in plain words. */
export function whatChanged(before: Pick<Lead, "website" | "phone" | "audit">, after: Pick<Lead, "website" | "phone" | "audit">): string[] {
  const out: string[] = [];
  const b = before.audit?.status ?? "none", a = after.audit?.status ?? "none";
  const host = (u?: string) => (u ?? "").replace(/^https?:\/\/(www\.)?/, "").split("/")[0].toLowerCase();
  if ((b === "none" || b === "social_only") && a === "ok") out.push("Now has a website");
  else if (b === "ok" && a === "down") out.push("Website stopped working");
  else if (b === "down" && a === "ok") out.push("Website working again");
  else if (b === "ok" && a === "ok" && before.website && after.website && host(before.website) !== host(after.website)) out.push("Moved to a new website");
  if (before.phone && after.phone && before.phone !== after.phone) out.push("New phone number");
  return out;
}

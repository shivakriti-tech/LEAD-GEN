import { promises as fs } from "node:fs";
import path from "node:path";
import { supabase, writeAtomic } from "./store";

/**
 * One JSON document the app keeps between restarts (the email queue, the inbox, the WhatsApp log…).
 * In Supabase's `app_state` table when Supabase is set up, otherwise in .data/<name>.json.
 * Each kind of document has a single writer in the app (its own update chain), so a plain
 * read-change-write is enough.
 */
export interface SavedDoc<T> {
  read(): Promise<T>;
  write(d: T): Promise<void>;
}

/**
 * The last copy read from or written to Supabase, per document. The app is the only writer, so a
 * recent copy is as good as a fresh one, and the email worker (every 30 seconds) doesn't download
 * the whole queue each time: that was most of the Supabase egress.
 */
const g = globalThis as unknown as { __savedDocs?: Map<string, { at: number; value: unknown }> };
const docCache = (g.__savedDocs ??= new Map());
const DOC_CACHE_MS = 2 * 60_000;

export function savedDoc<T>(name: string, empty: () => T): SavedDoc<T> {
  const db = supabase();
  if (!db) return fileDoc(() => path.join(/*turbopackIgnore: true*/ process.cwd(), ".data", `${name}.json`), empty);
  return {
    async read() {
      const hit = docCache.get(name);
      if (hit && Date.now() - hit.at < DOC_CACHE_MS) return structuredClone(hit.value as T);
      const { data, error } = await db.from("app_state").select("value").eq("key", name).maybeSingle();
      if (error) throw new Error(`Supabase: ${error.message}`);
      const value = data ? ((data as { value: T }).value) : empty();
      docCache.set(name, { at: Date.now(), value: structuredClone(value) });
      return value;
    },
    async write(d) {
      docCache.delete(name);
      const { error } = await db.from("app_state").upsert({ key: name, value: d, updated_at: new Date().toISOString() });
      if (error) throw new Error(`Supabase: ${error.message}`);
      docCache.set(name, { at: Date.now(), value: structuredClone(d) });
    },
  };
}

export function fileDoc<T>(file: () => string, empty: () => T): SavedDoc<T> {
  return {
    async read() {
      try {
        return JSON.parse(await fs.readFile(/*turbopackIgnore: true*/ file(), "utf8")) as T;
      } catch {
        return empty();
      }
    },
    async write(d) {
      await fs.mkdir(path.dirname(file()), { recursive: true });
      await writeAtomic(file(), JSON.stringify(d));
    },
  };
}

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

export function savedDoc<T>(name: string, empty: () => T): SavedDoc<T> {
  const db = supabase();
  if (!db) return fileDoc(() => path.join(/*turbopackIgnore: true*/ process.cwd(), ".data", `${name}.json`), empty);
  return {
    async read() {
      const { data, error } = await db.from("app_state").select("value").eq("key", name).maybeSingle();
      if (error) throw new Error(`Supabase: ${error.message}`);
      return data ? ((data as { value: T }).value) : empty();
    },
    async write(d) {
      const { error } = await db.from("app_state").upsert({ key: name, value: d, updated_at: new Date().toISOString() });
      if (error) throw new Error(`Supabase: ${error.message}`);
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

/**
 * Copy what this computer has in .data into Supabase, once, before going live.
 *
 *   npm run to-supabase            copies searches, clients, the lead directory and outreach data
 *   npm run to-supabase -- --force also overwrites outreach data Supabase already has
 *
 * Needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local, and the latest supabase/schema.sql
 * run in Supabase. Searches and clients already in Supabase are left as they are.
 */
try {
  process.loadEnvFile(".env.local");
} catch {}

import { promises as fs } from "node:fs";
import path from "node:path";
import { getClientStore, getStore, supabase } from "../lib/store";
import { savedDoc } from "../lib/saved";
import { supabaseDirectory, type DirectoryEntry } from "../lib/directory";
import type { ClientBrain } from "../lib/brain";
import type { Lead, SearchRecord } from "../lib/types";

const force = process.argv.includes("--force");
const data = path.join(/*turbopackIgnore: true*/ process.cwd(), ".data");
const readJson = async <T>(f: string): Promise<T | undefined> => {
  try {
    return JSON.parse(await fs.readFile(f, "utf8")) as T;
  } catch {
    return undefined;
  }
};
const files = async (dir: string) => (await fs.readdir(dir).catch(() => [] as string[])).filter((n) => n.endsWith(".json"));

async function main() {
  const db = supabase();
  if (!db) throw new Error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local first.");

  const store = getStore();
  let n = 0;
  for (const f of await files(path.join(data, "searches"))) {
    const s = await readJson<{ search: SearchRecord; leads: Lead[] }>(path.join(data, "searches", f));
    if (!s || (await store.getSearch(s.search.id))) continue;
    await store.saveSearch(s.search);
    await store.saveLeads(s.search.id, s.leads);
    n++;
  }
  console.log(`Searches copied: ${n}`);

  const clients = getClientStore();
  n = 0;
  for (const f of await files(path.join(data, "clients"))) {
    const c = await readJson<ClientBrain>(path.join(data, "clients", f));
    if (!c || (await clients.getClient(c.id))) continue;
    await clients.saveClient(c);
    n++;
  }
  console.log(`Clients copied: ${n}`);

  const dir = supabaseDirectory(db);
  n = 0;
  const root = path.join(data, "directory");
  for (const city of await fs.readdir(root).catch(() => [] as string[])) {
    for (const area of await fs.readdir(path.join(root, city)).catch(() => [] as string[])) {
      for (const f of await files(path.join(root, city, area))) {
        const e = await readJson<DirectoryEntry>(path.join(root, city, area, f));
        if (e) await dir.put(e), n++;
      }
    }
  }
  console.log(`Lead directory sets copied: ${n}`);

  for (const name of ["outreach/email", "outreach/inbox", "outreach/linkedin", "outreach/whatsapp", "usage", "handoffs", "billing"]) {
    const local = await readJson<unknown>(path.join(data, `${name}.json`));
    if (local === undefined) continue;
    const { data: row, error } = await db.from("app_state").select("key").eq("key", name).maybeSingle();
    if (error) throw new Error(`Supabase: ${error.message}`);
    if (row && !force) {
      console.log(`${name}: Supabase already has it, skipped (use --force to overwrite)`);
      continue;
    }
    await savedDoc<unknown>(name, () => null).write(local);
    console.log(`${name}: copied`);
  }

  // Links in emails already sent are signed with this, so they keep working once live.
  const secret = (await fs.readFile(path.join(data, "unsubscribe-secret"), "utf8").catch(() => "")).trim();
  if (secret && !process.env.UNSUBSCRIBE_SECRET?.trim()) {
    const doc = savedDoc<{ secret?: string }>("unsubscribe-secret", () => ({}));
    if (force || !(await doc.read()).secret) {
      await doc.write({ secret });
      console.log("unsubscribe-secret: copied");
    }
  }
  console.log("Done.");
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});

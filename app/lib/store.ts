import { randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { FollowUp, Lead, SearchRecord } from "./types";
import type { ClientBrain } from "./brain";

/**
 * Saves searches and leads to Supabase when it's configured,
 * otherwise to JSON files in ./.data (fine for trying things out locally).
 */
export interface Store {
  kind: "supabase" | "local";
  saveSearch(s: SearchRecord): Promise<void>;
  saveLeads(searchId: string, leads: Lead[]): Promise<void>;
  listSearches(): Promise<SearchRecord[]>;
  getSearch(id: string): Promise<{ search: SearchRecord; leads: Lead[] } | null>;
  /** Save follow-up status/note/date on some leads of a search. Returns the leads that were updated. */
  updateFollowUps(searchId: string, updates: Array<{ id: string; followUp: FollowUp }>): Promise<Lead[]>;
  /** Remove leads from a search. Returns how many were removed. */
  deleteLeads(searchId: string, ids: string[]): Promise<number>;
}

/** Business Brains: one per client you find leads for. Same place as searches (Supabase or .data). */
export interface ClientStore {
  listClients(): Promise<ClientBrain[]>;
  getClient(id: string): Promise<ClientBrain | null>;
  saveClient(c: ClientBrain): Promise<void>;
  deleteClient(id: string): Promise<boolean>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

let db: SupabaseClient | null | undefined;
/** The Supabase client when SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are set, otherwise null (use .data). */
export function supabase(): SupabaseClient | null {
  if (db !== undefined) return db;
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return (db = url && key ? createClient(url, key, { auth: { persistSession: false } }) : null);
}

let cached: Store | null = null;
export function getStore(): Store {
  if (cached) return cached;
  const db = supabase();
  cached = db ? supabaseStore(db) : localStore();
  return cached;
}

/** Writes a file whole or not at all: a crash mid-write leaves the old file, never half of one. */
export async function writeAtomic(file: string, data: string): Promise<void> {
  const tmp = `${file}.${randomBytes(4).toString("hex")}.tmp`;
  await fs.writeFile(/*turbopackIgnore: true*/ tmp, data);
  try {
    await fs.rename(/*turbopackIgnore: true*/ tmp, file);
  } catch (e) {
    await fs.unlink(/*turbopackIgnore: true*/ tmp).catch(() => {});
    throw e;
  }
}

/**
 * Runs changes to the same file one after another. Without this, two status changes made at the
 * same moment both read the file, and the second write silently undoes the first.
 */
const queues = new Map<string, Promise<unknown>>();
export function oneAtATime<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const run = (queues.get(key) ?? Promise.resolve()).then(fn, fn);
  const tail = run.catch(() => {});
  queues.set(key, tail);
  void tail.then(() => queues.get(key) === tail && queues.delete(key));
  return run;
}

export function localStore(dir = path.join(/*turbopackIgnore: true*/ process.cwd(), ".data", "searches")): Store {
  const file = (id: string) => path.join(dir, `${id.replace(/[^a-z0-9-]/gi, "")}.json`);
  async function read(id: string): Promise<{ search: SearchRecord; leads: Lead[] } | null> {
    try {
      return JSON.parse(await fs.readFile(/*turbopackIgnore: true*/ file(id), "utf8"));
    } catch {
      return null;
    }
  }
  const write = (id: string, d: { search: SearchRecord; leads: Lead[] }) => writeAtomic(file(id), JSON.stringify(d));
  return {
    kind: "local",
    saveSearch: (s) =>
      oneAtATime(file(s.id), async () => {
        await fs.mkdir(/*turbopackIgnore: true*/ dir, { recursive: true });
        const cur = await read(s.id);
        await write(s.id, { search: s, leads: cur?.leads ?? [] });
      }),
    saveLeads: (id, leads) =>
      oneAtATime(file(id), async () => {
        await fs.mkdir(/*turbopackIgnore: true*/ dir, { recursive: true });
        const cur = await read(id);
        if (!cur) throw new Error("Search not found");
        await write(id, { search: cur.search, leads });
      }),
    async listSearches() {
      try {
        const names = await fs.readdir(/*turbopackIgnore: true*/ dir);
        const all = await Promise.all(names.filter((n) => n.endsWith(".json")).map((n) => read(n.slice(0, -5))));
        return all.filter(Boolean).map((x) => x!.search).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      } catch {
        return [];
      }
    },
    getSearch: read,
    updateFollowUps: (searchId, updates) =>
      oneAtATime(file(searchId), async () => {
        const cur = await read(searchId);
        if (!cur) return [];
        const byId = new Map(updates.map((u) => [u.id, u.followUp]));
        const changed = cur.leads.filter((l) => byId.has(l.id));
        for (const l of changed) l.followUp = byId.get(l.id);
        if (changed.length) await write(searchId, cur);
        return changed;
      }),
    deleteLeads: (searchId, ids) =>
      oneAtATime(file(searchId), async () => {
        const cur = await read(searchId);
        if (!cur) return 0;
        const drop = new Set(ids);
        const before = cur.leads.length;
        cur.leads = cur.leads.filter((l) => !drop.has(l.id));
        if (cur.leads.length !== before) await write(searchId, cur);
        return before - cur.leads.length;
      }),
  };
}

function supabaseStore(db: SupabaseClient): Store {
  const toRow = (searchId: string, l: Lead) => ({
    id: l.id,
    search_id: searchId,
    name: l.name,
    category: l.category,
    address: l.address ?? null,
    city: l.city ?? null,
    lat: l.lat ?? null,
    lng: l.lng ?? null,
    phone: l.phone ?? null,
    email: l.email ?? l.emails[0] ?? null,
    website: l.website ?? null,
    website_status: l.audit?.status ?? null,
    sources: l.sources,
    place_id: l.placeId ?? null,
    osm_id: l.osmId ?? null,
    rating: l.rating ?? null,
    reviews: l.reviews ?? null,
    business_status: l.businessStatus ?? null,
    score: l.score,
    tier: l.tier,
    why_now: l.whyNow,
    signals: l.signals,
    data: l, // full lead for the UI
  });
  const fromSearch = (r: any): SearchRecord => ({ id: r.id, createdAt: r.created_at, params: r.params, status: r.status, counts: r.counts, error: r.error ?? undefined });
  return {
    kind: "supabase",
    async saveSearch(s) {
      const { error } = await db.from("searches").upsert({ id: s.id, created_at: s.createdAt, params: s.params, status: s.status, counts: s.counts, error: s.error ?? null });
      if (error) throw new Error(`Supabase: ${error.message}`);
    },
    async saveLeads(id, leads) {
      const del = await db.from("leads").delete().eq("search_id", id);
      if (del.error) throw new Error(`Supabase: ${del.error.message}`);
      for (let i = 0; i < leads.length; i += 200) {
        const { error } = await db.from("leads").insert(leads.slice(i, i + 200).map((l) => toRow(id, l)));
        if (error) throw new Error(`Supabase: ${error.message}`);
      }
    },
    async listSearches() {
      const { data, error } = await db.from("searches").select("*").order("created_at", { ascending: false }).limit(50);
      if (error) throw new Error(`Supabase: ${error.message}`);
      return (data ?? []).map(fromSearch);
    },
    async getSearch(id) {
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return null;
      const { data: s, error: sErr } = await db.from("searches").select("*").eq("id", id).maybeSingle();
      if (sErr) throw new Error(`Supabase: ${sErr.message}`);
      if (!s) return null;
      const { data: rows, error } = await db.from("leads").select("data").eq("search_id", id).order("score", { ascending: false });
      if (error) throw new Error(`Supabase: ${error.message}`);
      return { search: fromSearch(s), leads: (rows ?? []).map((r: any) => r.data as Lead) };
    },
    async updateFollowUps(searchId, updates) {
      const out: Lead[] = [];
      for (const { id, followUp } of updates) {
        const { data: row, error } = await db.from("leads").select("data").eq("search_id", searchId).eq("id", id).maybeSingle();
        if (error) throw new Error(`Supabase: ${error.message}`);
        if (!row) continue;
        const lead = { ...(row.data as Lead), followUp };
        const up = await db.from("leads").update({ data: lead }).eq("search_id", searchId).eq("id", id);
        if (up.error) throw new Error(`Supabase: ${up.error.message}`);
        out.push(lead);
      }
      return out;
    },
    async deleteLeads(searchId, ids) {
      if (!ids.length) return 0;
      const { error, count } = await db.from("leads").delete({ count: "exact" }).eq("search_id", searchId).in("id", ids);
      if (error) throw new Error(`Supabase: ${error.message}`);
      return count ?? 0;
    },
  };
}

function localClients(): ClientStore {
  const clientDir = path.join(/*turbopackIgnore: true*/ process.cwd(), ".data", "clients");
  const getClient = async (id: string): Promise<ClientBrain | null> => {
    if (!UUID.test(id)) return null;
    try {
      return JSON.parse(await fs.readFile(/*turbopackIgnore: true*/ path.join(clientDir, `${id}.json`), "utf8")) as ClientBrain;
    } catch {
      return null;
    }
  };
  return {
    getClient,
    async listClients() {
      const names = await fs.readdir(/*turbopackIgnore: true*/ clientDir).catch(() => [] as string[]);
      const all = await Promise.all(names.filter((n) => n.endsWith(".json")).map((n) => getClient(n.slice(0, -5))));
      return all.filter((c): c is ClientBrain => !!c).sort((a, b) => a.name.localeCompare(b.name));
    },
    async saveClient(c) {
      if (!UUID.test(c.id)) throw new Error("Bad client id");
      await fs.mkdir(/*turbopackIgnore: true*/ clientDir, { recursive: true });
      await writeAtomic(path.join(clientDir, `${c.id}.json`), JSON.stringify(c, null, 1));
    },
    async deleteClient(id) {
      if (!UUID.test(id)) return false;
      return fs.unlink(/*turbopackIgnore: true*/ path.join(clientDir, `${id}.json`)).then(() => true, () => false);
    },
  };
}

function supabaseClients(db: SupabaseClient): ClientStore {
  return {
    async listClients() {
      const { data, error } = await db.from("clients").select("data").order("name").limit(500);
      if (error) throw new Error(`Supabase: ${error.message}`);
      return (data ?? []).map((r: any) => r.data as ClientBrain);
    },
    async getClient(id) {
      if (!UUID.test(id)) return null;
      const { data, error } = await db.from("clients").select("data").eq("id", id).maybeSingle();
      if (error) throw new Error(`Supabase: ${error.message}`);
      return data ? (data as any).data as ClientBrain : null;
    },
    async saveClient(c) {
      const { error } = await db.from("clients").upsert({ id: c.id, name: c.name, created_at: c.createdAt, updated_at: c.updatedAt, data: c });
      if (error) throw new Error(`Supabase: ${error.message}`);
    },
    async deleteClient(id) {
      if (!UUID.test(id)) return false;
      const { error, count } = await db.from("clients").delete({ count: "exact" }).eq("id", id);
      if (error) throw new Error(`Supabase: ${error.message}`);
      return (count ?? 0) > 0;
    },
  };
}

let cachedClients: ClientStore | null = null;
export function getClientStore(): ClientStore {
  if (cachedClients) return cachedClients;
  const db = supabase();
  cachedClients = db ? supabaseClients(db) : localClients();
  return cachedClients;
}

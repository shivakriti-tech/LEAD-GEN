import { promises as fs } from "node:fs";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Lead, SearchRecord } from "./types";

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
}

let cached: Store | null = null;
export function getStore(): Store {
  if (cached) return cached;
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  cached = url && key ? supabaseStore(createClient(url, key, { auth: { persistSession: false } })) : localStore();
  return cached;
}

function localStore(): Store {
  const dir = path.join(process.cwd(), ".data", "searches");
  const file = (id: string) => path.join(dir, `${id.replace(/[^a-z0-9-]/gi, "")}.json`);
  async function read(id: string): Promise<{ search: SearchRecord; leads: Lead[] } | null> {
    try {
      return JSON.parse(await fs.readFile(file(id), "utf8"));
    } catch {
      return null;
    }
  }
  return {
    kind: "local",
    async saveSearch(s) {
      await fs.mkdir(dir, { recursive: true });
      const cur = await read(s.id);
      await fs.writeFile(file(s.id), JSON.stringify({ search: s, leads: cur?.leads ?? [] }));
    },
    async saveLeads(id, leads) {
      await fs.mkdir(dir, { recursive: true });
      const cur = await read(id);
      if (!cur) throw new Error("Search not found");
      await fs.writeFile(file(id), JSON.stringify({ search: cur.search, leads }));
    },
    async listSearches() {
      try {
        const names = await fs.readdir(dir);
        const all = await Promise.all(names.filter((n) => n.endsWith(".json")).map((n) => read(n.slice(0, -5))));
        return all.filter(Boolean).map((x) => x!.search).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      } catch {
        return [];
      }
    },
    getSearch: read,
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
      await db.from("leads").delete().eq("search_id", id);
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
      const { data: s } = await db.from("searches").select("*").eq("id", id).maybeSingle();
      if (!s) return null;
      const { data: rows, error } = await db.from("leads").select("data").eq("search_id", id).order("score", { ascending: false });
      if (error) throw new Error(`Supabase: ${error.message}`);
      return { search: fromSearch(s), leads: (rows ?? []).map((r: any) => r.data as Lead) };
    },
  };
}

-- Lead Autopilot · Module 1 (Lead Finder)
-- Run this once in Supabase: Dashboard → SQL Editor → New query → paste → Run.

create table if not exists public.searches (
  id uuid primary key,
  created_at timestamptz not null default now(),
  params jsonb not null,
  status text not null check (status in ('running','done','failed','stopped')),
  counts jsonb not null default '{}'::jsonb,
  error text
);

create table if not exists public.leads (
  id uuid primary key,
  search_id uuid not null references public.searches(id) on delete cascade,
  name text not null,
  category text,
  address text,
  city text,
  lat double precision,
  lng double precision,
  phone text,
  email text,
  website text,
  website_status text,
  sources text[] not null default '{}',
  place_id text,          -- Google place id (safe to keep long term)
  osm_id text,
  rating real,
  reviews int,
  business_status text,
  score int not null default 0,
  tier text not null default 'cold',
  why_now text,
  signals jsonb not null default '[]'::jsonb,
  data jsonb not null,    -- full lead as the app uses it
  created_at timestamptz not null default now()
);

create index if not exists leads_search_score_idx on public.leads (search_id, score desc);
create index if not exists leads_phone_idx on public.leads (phone);
create index if not exists leads_place_idx on public.leads (place_id);

-- The app talks to these tables with the service role key from the server only.
alter table public.searches enable row level security;
alter table public.leads enable row level security;

-- Already created the tables before "stopped" existed? Run this once:
-- alter table public.searches drop constraint if exists searches_status_check;
-- alter table public.searches add constraint searches_status_check check (status in ('running','done','failed','stopped'));

-- Module 2 (Business Brain): one row per client you find leads for.
create table if not exists public.clients (
  id uuid primary key,
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  data jsonb not null     -- the full brain as the app uses it
);
alter table public.clients enable row level security;

-- Outreach and app state (email queue, inbox, LinkedIn tasks, WhatsApp log, usage counts,
-- unsubscribe secret): one JSON document per key, so nothing lives on the server's disk.
create table if not exists public.app_state (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.app_state enable row level security;

-- The lead directory: checked businesses per city / area / business type, reused by later searches.
create table if not exists public.directory (
  key text primary key,   -- city/area/category
  city text not null,
  area text,
  category text not null,
  saved_at timestamptz not null,
  count int not null default 0,
  data jsonb not null     -- the full entry as the app uses it
);
create index if not exists directory_saved_idx on public.directory (saved_at desc);
alter table public.directory enable row level security;

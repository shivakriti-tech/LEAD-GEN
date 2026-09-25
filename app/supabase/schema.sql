-- Lead Autopilot · Module 1 (Lead Finder)
-- Run this once in Supabase: Dashboard → SQL Editor → New query → paste → Run.

create table if not exists public.searches (
  id uuid primary key,
  created_at timestamptz not null default now(),
  params jsonb not null,
  status text not null check (status in ('running','done','failed')),
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

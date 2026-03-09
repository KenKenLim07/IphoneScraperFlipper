-- 1) Extend raw listings table for description + run tracking.
alter table if exists public.iaase_raw_listings
  add column if not exists description text,
  add column if not exists run_id uuid,
  add column if not exists location_raw text,
  add column if not exists location_id bigint,
  add column if not exists listing_status text not null default 'active',
  add column if not exists content_hash text,
  add column if not exists first_seen_at timestamptz,
  add column if not exists last_seen_at timestamptz,
  add column if not exists last_seen_run_id uuid,
  add column if not exists last_changed_at timestamptz,
  add column if not exists sold_at timestamptz,
  add column if not exists missing_run_count integer not null default 0,
  add column if not exists is_active boolean not null default true;

-- 1.1) Normalized locations table.
create table if not exists public.iaase_locations (
  id bigserial primary key,
  location_key text not null unique,
  location_raw text not null,
  barangay text,
  municipality text,
  province text,
  region_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'iaase_raw_listings_location_id_fkey'
  ) then
    alter table public.iaase_raw_listings
      add constraint iaase_raw_listings_location_id_fkey
      foreign key (location_id) references public.iaase_locations(id);
  end if;
end
$$;

create index if not exists iaase_raw_listings_location_id_idx
  on public.iaase_raw_listings (location_id);
create index if not exists iaase_raw_listings_status_idx
  on public.iaase_raw_listings (listing_status);
create index if not exists iaase_raw_listings_last_seen_at_idx
  on public.iaase_raw_listings (last_seen_at desc);

-- 1.2) Immutable listing change history.
create table if not exists public.iaase_listing_versions (
  id bigserial primary key,
  listing_id text not null,
  run_id uuid not null,
  scraped_at timestamptz not null,
  content_hash text not null,
  listing_status text not null default 'active',
  title text,
  description text,
  price_raw text,
  location_raw text,
  location_id bigint,
  url text,
  changed_fields jsonb not null default '[]'::jsonb
);

create index if not exists iaase_listing_versions_listing_id_idx
  on public.iaase_listing_versions (listing_id, scraped_at desc);
create index if not exists iaase_listing_versions_run_id_idx
  on public.iaase_listing_versions (run_id);

-- 2) Per-run scrape logging table.
create table if not exists public.iaase_scrape_runs (
  run_id uuid primary key,
  started_at timestamptz not null,
  finished_at timestamptz not null,
  status text not null check (status in ('success', 'failed')),
  query_url text not null,
  browser_channel text not null,
  headless boolean not null default false,
  use_stealth boolean not null default false,
  dry_run boolean not null default false,
  max_cards integer not null,
  cards_seen integer not null default 0,
  rows_extracted integer not null default 0,
  rows_upserted integer not null default 0,
  rows_failed integer not null default 0,
  rows_enriched_description integer not null default 0,
  rows_enriched_location integer not null default 0,
  rows_detected_sold integer not null default 0,
  rows_detected_unavailable integer not null default 0,
  locations_upserted integer not null default 0,
  rows_changed integer not null default 0,
  versions_inserted integer not null default 0,
  rows_missing_seen integer not null default 0,
  rows_marked_not_seen integer not null default 0,
  error_count integer not null default 0,
  error_details jsonb not null default '[]'::jsonb
);

alter table if exists public.iaase_scrape_runs
  add column if not exists rows_enriched_description integer not null default 0,
  add column if not exists rows_enriched_location integer not null default 0,
  add column if not exists rows_detected_sold integer not null default 0,
  add column if not exists rows_detected_unavailable integer not null default 0,
  add column if not exists locations_upserted integer not null default 0,
  add column if not exists rows_changed integer not null default 0,
  add column if not exists versions_inserted integer not null default 0,
  add column if not exists rows_missing_seen integer not null default 0,
  add column if not exists rows_marked_not_seen integer not null default 0;

create index if not exists iaase_scrape_runs_started_at_idx
  on public.iaase_scrape_runs (started_at desc);

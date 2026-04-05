-- Adds `posted_at` (best-effort inferred Marketplace posted timestamp) to core tables.
-- Run this once in Supabase SQL editor.

alter table if exists public.listings
  add column if not exists posted_at timestamptz;

create index if not exists listings_posted_at_idx
  on public.listings (posted_at desc);

alter table if exists public.listing_versions
  add column if not exists posted_at timestamptz;

create index if not exists listing_versions_posted_at_idx
  on public.listing_versions (posted_at desc);


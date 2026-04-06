-- Adds a canonical scraped "Condition" field to listings.
-- Run this once in Supabase SQL editor.

alter table if exists public.listings
  add column if not exists condition_raw text null;


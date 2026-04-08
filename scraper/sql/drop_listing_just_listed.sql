-- Drops the GraphQL "just listed" flag from listings.
-- Run this once in Supabase SQL editor if the column was created.

alter table if exists public.listings
  drop column if exists listing_just_listed;

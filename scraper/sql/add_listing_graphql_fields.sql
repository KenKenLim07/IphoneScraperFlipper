-- Adds Marketplace GraphQL-derived fields to listings.
-- Run this once in Supabase SQL editor.

alter table if exists public.listings
  add column if not exists listing_price_amount numeric null,
  add column if not exists listing_price_formatted text null,
  add column if not exists listing_strikethrough_price text null,
  add column if not exists listing_is_live boolean null,
  add column if not exists listing_is_sold boolean null,
  add column if not exists listing_is_pending boolean null,
  add column if not exists listing_is_hidden boolean null,
  add column if not exists listing_seller_id text null,
  add column if not exists listing_location_city text null,
  add column if not exists listing_location_state text null;

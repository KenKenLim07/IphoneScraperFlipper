-- Drops the GraphQL "amount_with_offset" field from listings.
-- Run this once in Supabase SQL editor if the column was created.

alter table if exists public.listings
  drop column if exists listing_price_amount_with_offset;

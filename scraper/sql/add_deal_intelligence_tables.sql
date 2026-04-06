-- Adds comps-based deal intelligence tables.
-- Run this once in Supabase SQL editor.

create table if not exists public.listing_features (
  listing_id text primary key references public.listings(listing_id) on delete cascade,
  model_family text not null,
  variant text not null,
  storage_gb int null,
  battery_health int null,
  openline boolean null,
  condition_text text null,
  region_code text null,
  risk_flags jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create index if not exists listing_features_group_idx
  on public.listing_features (model_family, variant, storage_gb, region_code);

create table if not exists public.deal_metrics (
  listing_id text primary key references public.listings(listing_id) on delete cascade,
  asking_price_php numeric null,
  comp_region_code text null,
  comp_sample_size int not null default 0,
  comp_p25 numeric null,
  comp_p50 numeric null,
  comp_p75 numeric null,
  below_market_pct numeric null,
  deal_score text not null default 'NA',
  confidence text not null default 'low',
  est_profit_php numeric null,
  reasons jsonb not null default '[]'::jsonb,
  computed_at timestamptz not null default now()
);

create index if not exists deal_metrics_score_conf_idx
  on public.deal_metrics (deal_score, confidence);

create index if not exists deal_metrics_computed_at_idx
  on public.deal_metrics (computed_at desc);


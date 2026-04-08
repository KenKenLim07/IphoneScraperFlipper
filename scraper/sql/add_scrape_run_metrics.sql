-- Adds a lightweight per-run metrics table for discovery/monitor runs.
-- Run this once in Supabase SQL editor.

create table if not exists public.scrape_run_metrics (
  id bigserial primary key,
  run_id uuid not null,
  phase text not null,
  status text not null default 'success',
  started_at timestamptz not null,
  finished_at timestamptz not null,
  metrics jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists scrape_run_metrics_run_id_idx
  on public.scrape_run_metrics (run_id);

create index if not exists scrape_run_metrics_phase_started_at_idx
  on public.scrape_run_metrics (phase, started_at desc);

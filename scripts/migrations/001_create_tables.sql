-- Macro Dashboard: initial schema
-- Run this in the Supabase SQL editor before running any sync scripts.

-- -----------------------------------------------------------------------
-- macro_indicators
-- One row per indicator, upserted on each sync.
-- -----------------------------------------------------------------------
create table if not exists macro_indicators (
  id              serial primary key,
  indicator       text not null unique,   -- slug, e.g. "gold_usd" — upsert key
  value           numeric,
  previous_value  numeric,
  change_pct      numeric,
  currency        text,                   -- e.g. "USD", "GBP", "%", "Index"
  last_updated    timestamptz,
  source          text                    -- "stooq" or "fred"
);

-- -----------------------------------------------------------------------
-- macro_sync_log
-- One row per sync run, for audit and "last synced" display.
-- -----------------------------------------------------------------------
create table if not exists macro_sync_log (
  id                  serial primary key,
  started_at          timestamptz not null default now(),
  finished_at         timestamptz,
  status              text,               -- "running" | "completed" | "partial_success" | "failed"
  indicators_updated  integer,
  errors              jsonb,
  notes               text
);

-- Macro Dashboard v2: signal columns, history table, correlations table
-- Run this in the Supabase SQL editor after 002_enable_rls.sql

-- -----------------------------------------------------------------------
-- Add signal columns to macro_indicators
-- -----------------------------------------------------------------------
ALTER TABLE macro_indicators ADD COLUMN IF NOT EXISTS ma_20          NUMERIC;
ALTER TABLE macro_indicators ADD COLUMN IF NOT EXISTS ma_50          NUMERIC;
ALTER TABLE macro_indicators ADD COLUMN IF NOT EXISTS ma_200         NUMERIC;
ALTER TABLE macro_indicators ADD COLUMN IF NOT EXISTS rsi_14         NUMERIC;
ALTER TABLE macro_indicators ADD COLUMN IF NOT EXISTS macd_line      NUMERIC;
ALTER TABLE macro_indicators ADD COLUMN IF NOT EXISTS macd_signal    NUMERIC;
ALTER TABLE macro_indicators ADD COLUMN IF NOT EXISTS macd_hist      NUMERIC;
ALTER TABLE macro_indicators ADD COLUMN IF NOT EXISTS macd_state     TEXT;
ALTER TABLE macro_indicators ADD COLUMN IF NOT EXISTS ema_trend      TEXT;
ALTER TABLE macro_indicators ADD COLUMN IF NOT EXISTS adx            NUMERIC;
ALTER TABLE macro_indicators ADD COLUMN IF NOT EXISTS dmi_trend      TEXT;
ALTER TABLE macro_indicators ADD COLUMN IF NOT EXISTS signal_label   TEXT;
ALTER TABLE macro_indicators ADD COLUMN IF NOT EXISTS signal_confidence TEXT;

-- -----------------------------------------------------------------------
-- macro_history
-- One row per (indicator, date). Used for signal and correlation maths.
-- -----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS macro_history (
  id        SERIAL PRIMARY KEY,
  indicator TEXT    NOT NULL,
  date      DATE    NOT NULL,
  value     NUMERIC,
  UNIQUE (indicator, date)
);

ALTER TABLE macro_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "public read macro_history"
  ON macro_history FOR SELECT
  USING (true);

-- -----------------------------------------------------------------------
-- macro_correlations
-- One row per pair, updated on each history sync.
-- -----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS macro_correlations (
  id           SERIAL PRIMARY KEY,
  pair         TEXT        NOT NULL UNIQUE,
  label        TEXT,
  cor_90d      NUMERIC,
  last_updated TIMESTAMPTZ
);

ALTER TABLE macro_correlations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "public read macro_correlations"
  ON macro_correlations FOR SELECT
  USING (true);

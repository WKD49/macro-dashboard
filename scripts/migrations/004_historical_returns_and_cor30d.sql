-- Macro Dashboard v2.1: historical return columns + 30-day correlation
-- Run in Supabase SQL editor after 003_signals_and_history.sql

-- -----------------------------------------------------------------------
-- Add historical return columns to macro_indicators
-- chg_Nd = % change from N trading days ago to today
-- Populated by sync:history
-- -----------------------------------------------------------------------
ALTER TABLE macro_indicators ADD COLUMN IF NOT EXISTS chg_5d   NUMERIC;
ALTER TABLE macro_indicators ADD COLUMN IF NOT EXISTS chg_21d  NUMERIC;
ALTER TABLE macro_indicators ADD COLUMN IF NOT EXISTS chg_63d  NUMERIC;
ALTER TABLE macro_indicators ADD COLUMN IF NOT EXISTS chg_252d NUMERIC;

-- -----------------------------------------------------------------------
-- Add 30-day correlation to macro_correlations
-- -----------------------------------------------------------------------
ALTER TABLE macro_correlations ADD COLUMN IF NOT EXISTS cor_30d NUMERIC;

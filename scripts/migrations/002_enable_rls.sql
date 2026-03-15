-- Macro Dashboard: Row Level Security
-- Run this after 001_create_tables.sql.
-- This allows the frontend (anon key) to read data, but only the service role can write.

alter table macro_indicators enable row level security;
alter table macro_sync_log enable row level security;

-- Allow anyone (anon key) to read all rows
create policy "public read macro_indicators"
  on macro_indicators for select
  using (true);

create policy "public read macro_sync_log"
  on macro_sync_log for select
  using (true);

-- Only service role can insert / update / delete (scripts use service role key)
-- No additional policy needed — service role bypasses RLS by default in Supabase.

import { getAnonClient } from "@/lib/supabase-server";
import type { MacroIndicatorRow, MacroSyncLogRow } from "@/lib/macro/types";

export async function fetchAllIndicators(): Promise<MacroIndicatorRow[]> {
  const supabase = getAnonClient();
  const { data, error } = await supabase
    .from("macro_indicators")
    .select("*")
    .order("indicator", { ascending: true });

  if (error) throw new Error(`fetchAllIndicators: ${error.message}`);
  return (data ?? []) as MacroIndicatorRow[];
}

export async function fetchLastSync(): Promise<MacroSyncLogRow | null> {
  const supabase = getAnonClient();
  const { data, error } = await supabase
    .from("macro_sync_log")
    .select("*")
    .in("status", ["completed", "partial_success"])
    .order("finished_at", { ascending: false })
    .limit(1)
    .single();

  if (error) return null;
  return data as MacroSyncLogRow;
}

import { getAnonClient } from "@/lib/supabase-server";
import type { MacroIndicatorRow, MacroCorrelationRow, MacroSyncLogRow } from "@/lib/macro/types";

export async function fetchAllIndicators(): Promise<MacroIndicatorRow[]> {
  const supabase = getAnonClient();
  const { data, error } = await supabase
    .from("macro_indicators")
    .select("*")
    .order("indicator", { ascending: true });

  if (error) throw new Error(`fetchAllIndicators: ${error.message}`);
  return (data ?? []) as MacroIndicatorRow[];
}

export async function fetchYieldCurveHistory(): Promise<{ indicator: string; date: string; value: number }[]> {
  const supabase = getAnonClient();
  // 280 days × 5 indicators ≈ 1000 trading-day rows — explicit limit overrides Supabase's 1000-row default.
  const startDate = new Date(Date.now() - 280 * 86400_000).toISOString().slice(0, 10);
  const { data, error } = await supabase
    .from("macro_history")
    .select("indicator, date, value")
    .in("indicator", ["us_2s10s_spread", "us_yield_spread", "uk_yield_curve", "de_yield_curve", "jp_yield_curve"])
    .gte("date", startDate)
    .order("date", { ascending: true })
    .limit(1500);

  if (error) throw new Error(`fetchYieldCurveHistory: ${error.message}`);
  return (data ?? []) as { indicator: string; date: string; value: number }[];
}

export async function fetchSpreadHistory(): Promise<{ indicator: string; date: string; value: number }[]> {
  const supabase = getAnonClient();
  // 400 days × 3 indicators ≈ 840 rows — under the server row cap.
  const startDate = new Date(Date.now() - 400 * 86400_000).toISOString().slice(0, 10);
  const { data, error } = await supabase
    .from("macro_history")
    .select("indicator, date, value")
    .in("indicator", ["us_uk_spread", "us_de_spread", "us_jp_spread"])
    .gte("date", startDate)
    .order("date", { ascending: true });

  if (error) throw new Error(`fetchSpreadHistory: ${error.message}`);
  return (data ?? []) as { indicator: string; date: string; value: number }[];
}

export async function fetchCorrelations(): Promise<MacroCorrelationRow[]> {
  const supabase = getAnonClient();
  const { data, error } = await supabase
    .from("macro_correlations")
    .select("*")
    .order("pair", { ascending: true });

  if (error) throw new Error(`fetchCorrelations: ${error.message}`);
  return (data ?? []) as MacroCorrelationRow[];
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

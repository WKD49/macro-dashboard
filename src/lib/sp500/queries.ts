import { getAnonClient } from "@/lib/supabase-server";
import { SP500CompanyRow } from "./types";

export async function fetchAllSP500Companies(): Promise<SP500CompanyRow[]> {
  const supabase = getAnonClient();

  const { data, error } = await supabase
    .from("earnings_companies")
    .select("*")
    .order("report_date", { ascending: false, nullsFirst: false });

  if (error) throw new Error(`fetchAllSP500Companies: ${error.message}`);
  return (data ?? []) as SP500CompanyRow[];
}

export async function getLastSP500SyncInfo() {
  const supabase = getAnonClient();

  const { data, error } = await supabase
    .from("earnings_sync_log")
    .select("*")
    .order("started_at", { ascending: false })
    .limit(1)
    .single();

  if (error || !data) return null;

  return {
    id: data.id,
    startedAt: data.started_at,
    finishedAt: data.finished_at ?? null,
    status: data.status as "running" | "completed" | "partial_success" | "failed",
    symbolsUpdated: data.symbols_updated ?? null,
    symbolsTarget: data.symbols_target ?? null,
  };
}

import { getAnonClient } from "@/lib/supabase-server";
import { EuropeanCompanyRow } from "./types";

export async function fetchAllEuropeanCompanies(): Promise<EuropeanCompanyRow[]> {
  const supabase = getAnonClient();

  const { data, error } = await supabase
    .from("eu_earnings_companies")
    .select("*")
    .order("index_weight", { ascending: false, nullsFirst: false });

  if (error) throw new Error(`fetchAllEuropeanCompanies: ${error.message}`);
  return (data ?? []) as EuropeanCompanyRow[];
}

export async function getLastEuropeSyncInfo() {
  const supabase = getAnonClient();

  const { data, error } = await supabase
    .from("eu_earnings_sync_log")
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

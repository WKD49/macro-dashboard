/**
 * sync-sp500-earnings.ts
 * Fetches earnings dates (Alpha Vantage calendar) and EPS actuals for S&P 500 companies.
 * Upserts all 503 companies as a baseline, then enriches the 24 oldest rows with detail.
 *
 * Requires ALPHA_VANTAGE_API_KEY in .env.local (free tier: 25 calls/day).
 *
 * Run: npm run sync:sp500-earnings
 */

import { getServiceRoleClient } from "@/lib/supabase-server";
import { normaliseSector } from "@/lib/sp500/types";
import { SP500_LIST } from "@/lib/sp500/sp500-list";
import {
  fetchCompanyEarnings,
  fetchEarningsCalendar12Month,
  getApiCallCount,
  resetApiCallCount,
} from "@/lib/sp500/av-client";

type EarningsCompanyUpsert = {
  symbol: string;
  name: string;
  sector: string;
  report_date: string | null;
  eps_estimate: number | null;
  revenue_estimate: number | null;
  num_analysts: number;
  eps_revision_up: number;
  eps_revision_down: number;
  eps_actual: number | null;
  eps_surprise: number | null;
  eps_surprise_pct: number | null;
  last_synced_at: string;
};

function toNum(v: any): number | null {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function isoNow() {
  return new Date().toISOString();
}

async function main() {
  resetApiCallCount();

  const supabase = getServiceRoleClient();

  // 1) Start a sync log row
  const { data: logRow, error: logErr } = await supabase
    .from("earnings_sync_log")
    .insert({
      status: "running",
      api_calls: 0,
      symbols_updated: 0,
      symbols_target: 0,
      errors: [],
      notes: null,
    })
    .select("*")
    .single();

  if (logErr || !logRow) {
    throw new Error(`Failed to create sync log row: ${logErr?.message ?? "unknown"}`);
  }

  const logId = logRow.id as number;
  const errors: any[] = [];
  let symbolsUpdated = 0;

  try {
    console.log(`[sp500-earnings] Using static S&P 500 list: ${SP500_LIST.length} constituents`);

    // 2) Fetch earnings calendar (1 API call)
    console.log(`[sp500-earnings] Fetching earnings calendar (12-month horizon)...`);
    const calRes = await fetchEarningsCalendar12Month();
    if (calRes.error || !calRes.data) {
      throw new Error(`Calendar fetch failed: ${calRes.error ?? "no data"}`);
    }

    const calendar = calRes.data;
    console.log(`[sp500-earnings] Calendar: ${calendar.length} total entries`);

    const nextReportDate = new Map<string, string>();
    for (const entry of calendar) {
      const sym = entry.symbol?.trim();
      const date = entry.reportDate?.trim();
      if (!sym || !date) continue;
      const existing = nextReportDate.get(sym);
      if (!existing || date < existing) nextReportDate.set(sym, date);
    }

    const sp500Symbols = new Set(SP500_LIST.map((c) => c.symbol));
    const inCalendar = Array.from(nextReportDate.keys()).filter((s) => sp500Symbols.has(s));
    console.log(`[sp500-earnings] ${inCalendar.length} S&P 500 companies in calendar`);

    // 3) Upsert baseline rows for ALL 503
    const baselineNow = isoNow();
    const baseline: EarningsCompanyUpsert[] = SP500_LIST.map((c) => ({
      symbol: c.symbol,
      name: c.name,
      sector: normaliseSector(c.sector),
      report_date: nextReportDate.get(c.symbol) ?? null,
      eps_estimate: null,
      revenue_estimate: null,
      num_analysts: 0,
      eps_revision_up: 0,
      eps_revision_down: 0,
      eps_actual: null,
      eps_surprise: null,
      eps_surprise_pct: null,
      last_synced_at: baselineNow,
    }));

    const chunkSize = 250;
    for (let i = 0; i < baseline.length; i += chunkSize) {
      const chunk = baseline.slice(i, i + chunkSize);
      const { error } = await supabase.from("earnings_companies").upsert(chunk, {
        onConflict: "symbol",
      });
      if (error) throw new Error(`Baseline upsert failed: ${error.message}`);
    }

    // 4) Select the 24 oldest rows to enrich today
    const { data: targets, error: targetErr } = await supabase
      .from("earnings_companies")
      .select("symbol,last_synced_at")
      .order("last_synced_at", { ascending: true })
      .limit(24);

    if (targetErr) throw new Error(`Target select failed: ${targetErr.message}`);

    const symbolsTarget = (targets ?? []).map((r: any) => r.symbol).filter(Boolean);
    console.log(`[sp500-earnings] Fetching detailed earnings for ${symbolsTarget.length} symbols`);

    // 5) Fetch details
    for (const symbol of symbolsTarget) {
      const res = await fetchCompanyEarnings(symbol);
      if (res.error || !res.data) {
        errors.push({ symbol, error: res.error ?? "no data" });
        continue;
      }

      const q = Array.isArray(res.data.quarterlyEarnings) ? res.data.quarterlyEarnings : [];
      const latest = q
        .filter((x) => x?.reportedDate)
        .sort((a, b) => (a.reportedDate < b.reportedDate ? 1 : -1))[0];

      const { error } = await supabase
        .from("earnings_companies")
        .update({
          symbol,
          eps_actual: latest ? toNum(latest.reportedEPS) : null,
          eps_estimate: latest ? toNum(latest.estimatedEPS) : null,
          eps_surprise: latest ? toNum(latest.surprise) : null,
          eps_surprise_pct: latest ? toNum(latest.surprisePercentage) : null,
          last_synced_at: isoNow(),
        })
        .eq("symbol", symbol);

      if (error) {
        errors.push({ symbol, error: error.message });
        continue;
      }

      symbolsUpdated++;
    }

    // 6) Finish sync log
    const apiCalls = getApiCallCount();
    const status =
      errors.length === 0 ? "completed" : symbolsUpdated > 0 ? "partial_success" : "failed";

    await supabase
      .from("earnings_sync_log")
      .update({
        finished_at: isoNow(),
        status,
        api_calls: apiCalls,
        symbols_updated: symbolsUpdated,
        symbols_target: symbolsTarget.length,
        errors,
      })
      .eq("id", logId);

    console.log(
      `[sp500-earnings] ${status}: ${SP500_LIST.length} rows upserted (baseline), ${symbolsUpdated} detailed, ${apiCalls} API calls, ${errors.length} errors`,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    errors.push({ fatal: true, error: msg });

    await supabase
      .from("earnings_sync_log")
      .update({
        finished_at: isoNow(),
        status: "failed",
        api_calls: getApiCallCount(),
        symbols_updated: symbolsUpdated,
        symbols_target: 24,
        errors,
      })
      .eq("id", logId);

    console.error(`[sp500-earnings] failed: ${msg}`);
    process.exitCode = 1;
  }
}

main();

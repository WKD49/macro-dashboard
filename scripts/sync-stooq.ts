/**
 * sync-stooq.ts
 * Fetches energy, metals, currencies, and VIX from Stooq free CSV API.
 * Calculates GBP metal prices from USD price ÷ GBP/USD rate.
 * Upserts results into macro_indicators and logs the run to macro_sync_log.
 *
 * Run: npm run sync:stooq
 */

import { getServiceRoleClient } from "@/lib/supabase-server";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type DailyBar = {
  date: string;
  close: number;
};

type IndicatorRow = {
  indicator: string;
  value: number;
  previous_value: number;
  change_pct: number;
  currency: string;
  last_updated: string;
  source: "stooq";
};

// ---------------------------------------------------------------------------
// Stooq tickers
// Each entry: [indicator slug, stooq ticker, currency label]
// ---------------------------------------------------------------------------

const STOOQ_INDICATORS: Array<[string, string, string]> = [
  // Energy
  ["brent_crude_usd", "brent",   "USD/bbl"],
  ["wti_crude_usd",   "wti",     "USD/bbl"],
  ["natural_gas_usd", "natgas",  "USD/MMBtu"],

  // Metals (USD) — GBP versions calculated separately
  ["gold_usd",   "xauusd", "USD/oz"],
  ["silver_usd", "xagusd", "USD/oz"],
  ["copper_usd", "copper", "USD/lb"],

  // Currencies (also used to derive GBP metal prices)
  ["dxy",     "dxy",     "Index"],
  ["gbp_usd", "gbpusd",  "Rate"],
  ["eur_usd", "eurusd",  "Rate"],
  ["gbp_eur", "gbpeur",  "Rate"],
  ["usd_jpy", "usdjpy",  "Rate"],

  // Volatility
  ["vix", "vix.us", "Index"],
];

// ---------------------------------------------------------------------------
// Stooq CSV fetcher
// ---------------------------------------------------------------------------

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function parseCsv(text: string): DailyBar[] {
  const lines = text.trim().split("\n");
  if (lines.length < 2) return [];

  const bars: DailyBar[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",");
    if (cols.length < 5) continue;
    const date = cols[0].trim();
    const close = parseFloat(cols[4].trim());
    if (!date || !Number.isFinite(close) || close <= 0) continue;
    bars.push({ date, close });
  }

  // Sort newest first
  bars.sort((a, b) => (a.date < b.date ? 1 : -1));
  return bars;
}

async function fetchStooq(ticker: string): Promise<DailyBar[] | null> {
  const url = `https://stooq.com/q/d/l/?s=${encodeURIComponent(ticker)}&i=d`;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; macro-dashboard/1.0)" },
    });
    if (!res.ok) {
      console.warn(`[stooq] HTTP ${res.status} for ticker: ${ticker}`);
      return null;
    }
    const text = await res.text();
    if (/exceeded the daily hits limit/i.test(text)) {
      console.warn(`[stooq] Daily rate limit hit — try again tomorrow`);
      return null;
    }
    if (/no data/i.test(text) || text.trim() === "") {
      console.warn(`[stooq] No data returned for ticker: ${ticker}`);
      return null;
    }
    const bars = parseCsv(text);
    if (bars.length < 2) {
      console.warn(`[stooq] Fewer than 2 bars for ticker: ${ticker}`);
      return null;
    }
    return bars;
  } catch (err) {
    console.warn(`[stooq] Fetch error for ${ticker}: ${err}`);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const supabase = getServiceRoleClient();
  const now = new Date().toISOString();

  // Create sync log entry
  const { data: logRow, error: logErr } = await supabase
    .from("macro_sync_log")
    .insert({ status: "running", notes: "stooq sync" })
    .select("id")
    .single();

  if (logErr || !logRow) {
    throw new Error(`[stooq] Could not create sync log: ${logErr?.message}`);
  }

  const logId = logRow.id;
  console.log(`[stooq] Sync started — log id: ${logId}`);

  const rows: IndicatorRow[] = [];
  const errors: Array<{ indicator: string; error: string }> = [];

  // Fetch raw bars for each indicator
  const rawData = new Map<string, DailyBar[]>();

  for (const [slug, ticker] of STOOQ_INDICATORS) {
    console.log(`[stooq] Fetching ${slug} (${ticker})...`);
    const bars = await fetchStooq(ticker);
    if (bars) {
      rawData.set(slug, bars);
    } else {
      errors.push({ indicator: slug, error: `no data from stooq ticker ${ticker}` });
    }
    await sleep(400); // be polite to Stooq
  }

  // Build indicator rows from raw data
  for (const [slug, _ticker, currency] of STOOQ_INDICATORS) {
    const bars = rawData.get(slug);
    if (!bars) continue;

    const value = bars[0].close;
    const previous_value = bars[1].close;
    const change_pct = ((value - previous_value) / previous_value) * 100;

    rows.push({
      indicator: slug,
      value,
      previous_value,
      change_pct,
      currency,
      last_updated: now,
      source: "stooq",
    });
  }

  // Derive GBP metal prices using live GBP/USD rate
  const gbpUsdBars = rawData.get("gbp_usd");
  if (gbpUsdBars) {
    const gbpUsd = gbpUsdBars[0].close;
    const gbpUsdPrev = gbpUsdBars[1].close;

    const metalPairs: Array<[string, string, string]> = [
      ["gold_usd",   "gold_gbp",   "GBP/oz"],
      ["silver_usd", "silver_gbp", "GBP/oz"],
      ["copper_usd", "copper_gbp", "GBP/lb"],
    ];

    for (const [usdSlug, gbpSlug, gbpCurrency] of metalPairs) {
      const usdBars = rawData.get(usdSlug);
      if (!usdBars) {
        errors.push({ indicator: gbpSlug, error: `missing USD source (${usdSlug})` });
        continue;
      }

      const value = usdBars[0].close / gbpUsd;
      const previous_value = usdBars[1].close / gbpUsdPrev;
      const change_pct = ((value - previous_value) / previous_value) * 100;

      rows.push({
        indicator: gbpSlug,
        value,
        previous_value,
        change_pct,
        currency: gbpCurrency,
        last_updated: now,
        source: "stooq",
      });
    }
  } else {
    errors.push({ indicator: "gbp metals", error: "gbp_usd data missing — cannot derive GBP metal prices" });
    console.warn("[stooq] GBP/USD data missing — skipping GBP metal price calculation");
  }

  // Upsert all rows
  let updated = 0;
  for (const row of rows) {
    const { error: upErr } = await supabase
      .from("macro_indicators")
      .upsert(row, { onConflict: "indicator" });

    if (upErr) {
      errors.push({ indicator: row.indicator, error: upErr.message });
    } else {
      updated++;
    }
  }

  // Update sync log
  const status = errors.length === 0 ? "completed" : updated > 0 ? "partial_success" : "failed";
  await supabase
    .from("macro_sync_log")
    .update({
      finished_at: new Date().toISOString(),
      status,
      indicators_updated: updated,
      errors: errors.length > 0 ? errors : null,
    })
    .eq("id", logId);

  console.log(`[stooq] Done — updated: ${updated} | errors: ${errors.length} | status: ${status}`);
  if (errors.length > 0) {
    console.log("[stooq] Errors:", errors);
  }
}

main().catch((e) => {
  console.error(`[stooq] fatal: ${e instanceof Error ? e.message : String(e)}`);
  process.exitCode = 1;
});

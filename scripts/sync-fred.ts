/**
 * sync-fred.ts
 * Fetches bond yield data from the FRED API (Federal Reserve).
 * Covers: US 10yr, US 2yr, UK 10yr Gilt, German 10yr Bund.
 * Calculates the US yield spread (10yr − 2yr).
 * Upserts results into macro_indicators and logs the run to macro_sync_log.
 *
 * Run: npm run sync:fred
 */

import { getServiceRoleClient } from "@/lib/supabase-server";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type FredObservation = {
  date: string;
  value: string; // FRED returns strings, including "." for missing data
};

type FredResponse = {
  observations: FredObservation[];
};

type IndicatorRow = {
  indicator: string;
  value: number;
  previous_value: number;
  change_pct: number;
  currency: string;
  last_updated: string;
  source: "fred";
};

// ---------------------------------------------------------------------------
// FRED series to fetch
// Each entry: [indicator slug, FRED series ID, currency label]
//
// Notes on series IDs:
//   DGS10 — US 10yr Treasury (daily)
//   DGS2  — US 2yr Treasury (daily)
//   IRLTLT01GBM156N — UK 10yr Gilt (monthly harmonised; most recent available)
//   IRLTLT01DEM156N — German 10yr Bund (monthly harmonised; most recent available)
//
// If you need more frequent UK/DE data, search fred.stlouisfed.org for
// daily series — availability varies. Monthly is the standard free option.
// ---------------------------------------------------------------------------

const FRED_SERIES: Array<[string, string, string]> = [
  ["us_10yr_yield", "DGS10",             "%"],
  ["us_2yr_yield",  "DGS2",              "%"],
  ["uk_10yr_yield", "IRLTLT01GBM156N",   "%"],
  ["de_10yr_yield", "IRLTLT01DEM156N",   "%"],
];

// ---------------------------------------------------------------------------
// FRED API fetcher
// Returns the two most recent non-missing observations (newest first).
// ---------------------------------------------------------------------------

async function fetchFredSeries(seriesId: string, apiKey: string): Promise<[number, number] | null> {
  // Fetch last 10 observations to ensure we can find at least 2 valid ones
  // (FRED sometimes returns "." for recent dates not yet published)
  const url = new URL("https://api.stlouisfed.org/fred/series/observations");
  url.searchParams.set("series_id", seriesId);
  url.searchParams.set("api_key", apiKey);
  url.searchParams.set("sort_order", "desc");
  url.searchParams.set("limit", "10");
  url.searchParams.set("file_type", "json");

  try {
    const res = await fetch(url.toString());
    if (!res.ok) {
      console.warn(`[fred] HTTP ${res.status} for series: ${seriesId}`);
      return null;
    }

    const json = (await res.json()) as FredResponse;
    const valid = json.observations
      .filter((o) => o.value !== "." && o.value.trim() !== "")
      .map((o) => parseFloat(o.value))
      .filter((v) => Number.isFinite(v));

    if (valid.length < 2) {
      console.warn(`[fred] Not enough valid observations for ${seriesId} (got ${valid.length})`);
      return null;
    }

    return [valid[0], valid[1]]; // [current, previous]
  } catch (err) {
    console.warn(`[fred] Fetch error for ${seriesId}: ${err}`);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const apiKey = process.env.FRED_API_KEY;
  if (!apiKey) throw new Error("FRED_API_KEY environment variable is required");

  const supabase = getServiceRoleClient();
  const now = new Date().toISOString();

  // Create sync log entry
  const { data: logRow, error: logErr } = await supabase
    .from("macro_sync_log")
    .insert({ status: "running", notes: "fred sync" })
    .select("id")
    .single();

  if (logErr || !logRow) {
    throw new Error(`[fred] Could not create sync log: ${logErr?.message}`);
  }

  const logId = logRow.id;
  console.log(`[fred] Sync started — log id: ${logId}`);

  const rows: IndicatorRow[] = [];
  const errors: Array<{ indicator: string; error: string }> = [];
  const fetchedValues = new Map<string, [number, number]>(); // slug → [current, previous]

  for (const [slug, seriesId, currency] of FRED_SERIES) {
    console.log(`[fred] Fetching ${slug} (${seriesId})...`);
    const result = await fetchFredSeries(seriesId, apiKey);

    if (!result) {
      errors.push({ indicator: slug, error: `no valid data from FRED series ${seriesId}` });
      continue;
    }

    const [value, previous_value] = result;
    const change_pct = ((value - previous_value) / previous_value) * 100;
    fetchedValues.set(slug, [value, previous_value]);

    rows.push({
      indicator: slug,
      value,
      previous_value,
      change_pct,
      currency,
      last_updated: now,
      source: "fred",
    });
  }

  // Derive yield spread (US 10yr − US 2yr)
  const us10 = fetchedValues.get("us_10yr_yield");
  const us2  = fetchedValues.get("us_2yr_yield");

  if (us10 && us2) {
    const value = us10[0] - us2[0];
    const previous_value = us10[1] - us2[1];
    const change_pct = previous_value !== 0
      ? ((value - previous_value) / Math.abs(previous_value)) * 100
      : 0;

    rows.push({
      indicator: "us_yield_spread",
      value,
      previous_value,
      change_pct,
      currency: "%",
      last_updated: now,
      source: "fred",
    });
  } else {
    errors.push({ indicator: "us_yield_spread", error: "cannot calculate — US 10yr or 2yr data missing" });
    console.warn("[fred] Cannot calculate yield spread — US 10yr or 2yr data missing");
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

  console.log(`[fred] Done — updated: ${updated} | errors: ${errors.length} | status: ${status}`);
  if (errors.length > 0) {
    console.log("[fred] Errors:", errors);
  }
}

main().catch((e) => {
  console.error(`[fred] fatal: ${e instanceof Error ? e.message : String(e)}`);
  process.exitCode = 1;
});

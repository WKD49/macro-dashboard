/**
 * sync-fred.ts
 * Fetches bond yield data from the FRED API (Federal Reserve).
 * Covers: US 10yr, US 2yr, UK/DE/JP 10yr, UK/DE/JP 3M interbank rates.
 * Calculates US yield spread, cross-country spreads, and non-US yield curve shapes.
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
  source: string;
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
  // Long-term government bond yields
  ["us_10yr_yield", "DGS10",             "%"],
  ["us_2yr_yield",  "DGS2",              "%"],
  // uk/de/jp 10yr are fetched from official daily sources below (BoE, Bundesbank, MOF)
  // Short-term rates for yield curve shape (10yr − 3M for all four countries)
  // US: 3M T-bill (daily). UK/DE/JP: 3M interbank (monthly harmonised).
  // Using 3M for all four ensures consistent methodology across countries.
  // Note: NY Fed recession model also uses 10yr vs 3M T-bill.
  ["us_3m_rate",    "DGS3MO",            "%"],
  ["uk_3m_rate",    "IR3TIB01GBM156N",   "%"],
  ["de_3m_rate",    "IR3TIB01DEM156N",   "%"],
  ["jp_3m_rate",    "IR3TIB01JPM156N",   "%"],
  // ---------------------------------------------------------------------------
  // Credit spreads — ICE BofA Option-Adjusted Spread (OAS) series
  // All values in % (e.g. 0.90 = 90 bps). Displayed as bps on the dashboard.
  //
  // CONFIRMED:
  ["us_corp_ig_spread", "BAMLC0A0CM",         "%"], // ICE BofA US Corporate (IG) OAS
  ["us_hy_spread",      "BAMLH0A0HYM2",       "%"], // ICE BofA US High Yield OAS
  //
  // TODO: verify series ID — may be Euro IG OAS, not Global. If confirmed wrong, replace with ETF proxy.
  ["global_corp_ig_spread", "BAMLHE00EHYIOAS", "%"],
  //
  // global_hy_spread, em_usd_spread, em_lc_spread are sourced via Yahoo Finance ETF proxies
  // (HYXU, EMB, EMLC) in sync-stooq.ts — not FRED.
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
// Daily official sources for UK / DE / JP 10yr yields
// ---------------------------------------------------------------------------

function formatBoEDate(d: Date): string {
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return `${String(d.getDate()).padStart(2,"0")}/${months[d.getMonth()]}/${d.getFullYear()}`;
}

/** Bank of England — UK 10yr nominal par gilt (series IUDMNPY, daily) */
async function fetchBoECurrent(seriesCode: string): Promise<[number, number] | null> {
  const today = new Date();
  const from = new Date(today.getTime() - 30 * 86400_000); // last 30 calendar days
  const url = `https://www.bankofengland.co.uk/boeapps/database/_iadb-FromShowColumns.asp?csv.x=yes&SeriesCodes=${seriesCode}&UsingCodes=Y&CSVF=TN&Datefrom=${formatBoEDate(from)}&Dateto=${formatBoEDate(today)}`;

  try {
    const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (compatible; macro-dashboard/1.0)" } });
    if (!res.ok) { console.warn(`[fred] BoE HTTP ${res.status}`); return null; }
    const text = await res.text();

    const MON: Record<string, string> = {
      Jan:"01",Feb:"02",Mar:"03",Apr:"04",May:"05",Jun:"06",
      Jul:"07",Aug:"08",Sep:"09",Oct:"10",Nov:"11",Dec:"12",
    };

    const vals: number[] = [];
    for (const line of text.trim().split("\n").slice(1)) {
      const cols = line.split(",");
      if (cols.length < 2) continue;
      const parts = cols[0].trim().split(" ");
      if (parts.length !== 3 || !MON[parts[1]]) continue;
      const val = parseFloat(cols[1].trim());
      if (!Number.isFinite(val)) continue;
      vals.push(val);
    }

    // vals are oldest-first from BoE; reverse to get newest-first
    vals.reverse();
    if (vals.length < 2) { console.warn(`[fred] BoE: not enough valid rows for ${seriesCode}`); return null; }
    return [vals[0], vals[1]];
  } catch (err) {
    console.warn(`[fred] BoE fetch error: ${err}`);
    return null;
  }
}

/** Bundesbank — DE 10yr Bund (daily, semicolon-separated CSV) */
async function fetchBundesbankCurrent(): Promise<[number, number] | null> {
  const url = "https://api.statistiken.bundesbank.de/rest/download/BBSSY/D.REN.EUR.A630.000000WT1010.A?format=csv&lang=en";

  try {
    const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (compatible; macro-dashboard/1.0)" } });
    if (!res.ok) { console.warn(`[fred] Bundesbank HTTP ${res.status}`); return null; }
    const text = await res.text();

    const vals: number[] = [];
    for (const line of text.trim().split("\n")) {
      let cols = line.split(";");
      if (cols.length < 2) cols = line.split(",");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(cols[0].trim())) continue;
      const rawVal = cols[1].trim();
      if (rawVal === "." || rawVal === "") continue;
      const val = parseFloat(rawVal);
      if (!Number.isFinite(val)) continue;
      vals.push(val);
    }

    // vals are oldest-first; take last two
    if (vals.length < 2) { console.warn(`[fred] Bundesbank: not enough valid rows`); return null; }
    return [vals[vals.length - 1], vals[vals.length - 2]];
  } catch (err) {
    console.warn(`[fred] Bundesbank fetch error: ${err}`);
    return null;
  }
}

/** MOF Japan — JP 10yr JGB (rolling recent CSV, column index 10 = 10Y) */
async function fetchMofJapanCurrent(): Promise<[number, number] | null> {
  const url = "https://www.mof.go.jp/english/policy/jgbs/reference/interest_rate/jgbcme.csv";

  try {
    const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (compatible; macro-dashboard/1.0)" } });
    if (!res.ok) { console.warn(`[fred] MOF Japan HTTP ${res.status}`); return null; }
    const text = await res.text();

    const vals: number[] = [];
    for (const line of text.trim().split("\n").slice(1)) {
      const cols = line.split(",");
      if (cols.length < 11) continue;
      const rawVal = cols[10].trim();
      if (rawVal === "-" || rawVal === "") continue;
      const val = parseFloat(rawVal);
      if (!Number.isFinite(val)) continue;
      vals.push(val);
    }

    // vals are oldest-first; take last two
    if (vals.length < 2) { console.warn(`[fred] MOF Japan: not enough valid rows`); return null; }
    return [vals[vals.length - 1], vals[vals.length - 2]];
  } catch (err) {
    console.warn(`[fred] MOF Japan fetch error: ${err}`);
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

  // UK 10yr — Bank of England (daily)
  console.log("[fred] Fetching uk_10yr_yield from Bank of England...");
  const ukYield = await fetchBoECurrent("IUDMNPY");
  if (ukYield) {
    const [value, previous_value] = ukYield;
    const change_pct = previous_value !== 0 ? ((value - previous_value) / Math.abs(previous_value)) * 100 : 0;
    fetchedValues.set("uk_10yr_yield", ukYield);
    rows.push({ indicator: "uk_10yr_yield", value, previous_value, change_pct, currency: "%", last_updated: now, source: "boe" });
  } else {
    errors.push({ indicator: "uk_10yr_yield", error: "no valid data from Bank of England" });
  }

  // DE 10yr — Bundesbank (daily)
  console.log("[fred] Fetching de_10yr_yield from Bundesbank...");
  const deYield = await fetchBundesbankCurrent();
  if (deYield) {
    const [value, previous_value] = deYield;
    const change_pct = previous_value !== 0 ? ((value - previous_value) / Math.abs(previous_value)) * 100 : 0;
    fetchedValues.set("de_10yr_yield", deYield);
    rows.push({ indicator: "de_10yr_yield", value, previous_value, change_pct, currency: "%", last_updated: now, source: "bundesbank" });
  } else {
    errors.push({ indicator: "de_10yr_yield", error: "no valid data from Bundesbank" });
  }

  // JP 10yr — MOF Japan (daily)
  console.log("[fred] Fetching jp_10yr_yield from MOF Japan...");
  const jpYield = await fetchMofJapanCurrent();
  if (jpYield) {
    const [value, previous_value] = jpYield;
    const change_pct = previous_value !== 0 ? ((value - previous_value) / Math.abs(previous_value)) * 100 : 0;
    fetchedValues.set("jp_10yr_yield", jpYield);
    rows.push({ indicator: "jp_10yr_yield", value, previous_value, change_pct, currency: "%", last_updated: now, source: "mof" });
  } else {
    errors.push({ indicator: "jp_10yr_yield", error: "no valid data from MOF Japan" });
  }

  // Cross-country yield spreads (US 10yr minus each foreign 10yr)
  const us10 = fetchedValues.get("us_10yr_yield");
  const spreadPairs: Array<[string, string, string]> = [
    ["us_uk_spread", "uk_10yr_yield", "US-UK yield spread"],
    ["us_de_spread", "de_10yr_yield", "US-DE yield spread"],
    ["us_jp_spread", "jp_10yr_yield", "US-JP yield spread"],
  ];

  for (const [slug, foreignSlug] of spreadPairs) {
    const foreign = fetchedValues.get(foreignSlug);
    if (us10 && foreign) {
      const value = us10[0] - foreign[0];
      const previous_value = us10[1] - foreign[1];
      const change_pct = previous_value !== 0
        ? ((value - previous_value) / Math.abs(previous_value)) * 100
        : 0;
      rows.push({ indicator: slug, value, previous_value, change_pct, currency: "%pts", last_updated: now, source: "fred" });
    } else {
      errors.push({ indicator: slug, error: `cannot calculate — ${foreignSlug} data missing` });
    }
  }

  // Yield curve shapes (10yr − 3M for all four countries — consistent methodology)
  const curvePairs: Array<[string, string, string]> = [
    ["us_yield_spread", "us_10yr_yield", "us_3m_rate"],
    ["uk_yield_curve",  "uk_10yr_yield", "uk_3m_rate"],
    ["de_yield_curve",  "de_10yr_yield", "de_3m_rate"],
    ["jp_yield_curve",  "jp_10yr_yield", "jp_3m_rate"],
  ];

  for (const [slug, longSlug, shortSlug] of curvePairs) {
    const longEnd  = fetchedValues.get(longSlug);
    const shortEnd = fetchedValues.get(shortSlug);
    if (longEnd && shortEnd) {
      const value = longEnd[0] - shortEnd[0];
      const previous_value = longEnd[1] - shortEnd[1];
      const change_pct = previous_value !== 0
        ? ((value - previous_value) / Math.abs(previous_value)) * 100
        : 0;
      rows.push({ indicator: slug, value, previous_value, change_pct, currency: "%pts", last_updated: now, source: "fred" });
    } else {
      errors.push({ indicator: slug, error: `cannot calculate — ${longSlug} or ${shortSlug} data missing` });
    }
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

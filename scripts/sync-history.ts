/**
 * sync-history.ts
 * Fetches 200 days of daily history for all macro indicators,
 * stores them in macro_history, computes MACD/EMA/DMI signals,
 * and calculates 90-day correlations for 4 key macro pairs.
 *
 * Run: npm run sync:history
 * Should be run after sync:stooq and sync:fred have populated macro_indicators.
 */

// @ts-ignore
import YahooFinance from "yahoo-finance2";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { computeMacroSignals } from "@/lib/macro/signals";
import { pearsonCorrelation, CORRELATION_PAIRS, interpretCorrelation } from "@/lib/macro/correlations";

const yf = new YahooFinance({ suppressNotices: ["yahooSurvey", "ripHistorical"] });

// ---------------------------------------------------------------------------
// Data source map
// Each indicator slug → { source, ticker }
// ---------------------------------------------------------------------------

type HistorySource =
  | { type: "yahoo"; ticker: string }
  | { type: "stooq"; ticker: string }
  | { type: "fred"; seriesId: string }
  | { type: "boe"; seriesCode: string }
  | { type: "bundesbank" }
  | { type: "mof_japan" }
  | { type: "derived"; components: string[]; fn: (vals: number[][]) => number[] };

const HISTORY_SOURCES: Record<string, HistorySource> = {
  // Commodities — Yahoo Finance futures
  brent_crude_usd: { type: "yahoo", ticker: "BZ=F" },
  wti_crude_usd:   { type: "yahoo", ticker: "CL=F" },
  natural_gas_usd: { type: "yahoo", ticker: "NG=F" },
  copper_usd:      { type: "yahoo", ticker: "HG=F" },
  dxy:             { type: "yahoo", ticker: "DX=F" },
  vix:             { type: "yahoo", ticker: "^VIX" },

  // Metals — Stooq spot prices
  gold_usd:   { type: "stooq", ticker: "xauusd" },
  silver_usd: { type: "stooq", ticker: "xagusd" },

  // Currencies — Stooq
  gbp_usd: { type: "stooq", ticker: "gbpusd" },
  eur_usd: { type: "stooq", ticker: "eurusd" },
  gbp_eur: { type: "stooq", ticker: "gbpeur" },
  usd_jpy: { type: "stooq", ticker: "usdjpy" },

  // Yields — FRED
  us_10yr_yield: { type: "fred", seriesId: "DGS10" },
  us_2yr_yield:  { type: "fred", seriesId: "DGS2" },
  uk_10yr_yield: { type: "boe", seriesCode: "IUDMNPY" },
  de_10yr_yield: { type: "bundesbank" },
  jp_10yr_yield: { type: "mof_japan" },
  // 3M rates — for yield curve shapes (10yr − 3M, consistent across all 4 countries)
  us_3m_rate: { type: "fred", seriesId: "DGS3MO" },
  uk_3m_rate: { type: "fred", seriesId: "IR3TIB01GBM156N" },
  de_3m_rate: { type: "fred", seriesId: "IR3TIB01DEM156N" },
  jp_3m_rate: { type: "fred", seriesId: "IR3TIB01JPM156N" },

  // Cross-country spreads — computed from component history after all fetches
  us_uk_spread: {
    type: "derived",
    components: ["us_10yr_yield", "uk_10yr_yield"],
    fn: ([us10, uk10]) => alignAndCompute(us10, uk10, (a, b) => a - b),
  },
  us_de_spread: {
    type: "derived",
    components: ["us_10yr_yield", "de_10yr_yield"],
    fn: ([us10, de10]) => alignAndCompute(us10, de10, (a, b) => a - b),
  },
  us_jp_spread: {
    type: "derived",
    components: ["us_10yr_yield", "jp_10yr_yield"],
    fn: ([us10, jp10]) => alignAndCompute(us10, jp10, (a, b) => a - b),
  },

  // Yield curve shapes — 10yr minus 3M for all four countries (consistent methodology)
  us_yield_spread: {
    type: "derived",
    components: ["us_10yr_yield", "us_3m_rate"],
    fn: ([us10, us3m]) => alignAndCompute(us10, us3m, (a, b) => a - b),
  },
  uk_yield_curve: {
    type: "derived",
    components: ["uk_10yr_yield", "uk_3m_rate"],
    fn: ([uk10, uk3m]) => alignAndCompute(uk10, uk3m, (a, b) => a - b),
  },
  de_yield_curve: {
    type: "derived",
    components: ["de_10yr_yield", "de_3m_rate"],
    fn: ([de10, de3m]) => alignAndCompute(de10, de3m, (a, b) => a - b),
  },
  jp_yield_curve: {
    type: "derived",
    components: ["jp_10yr_yield", "jp_3m_rate"],
    fn: ([jp10, jp3m]) => alignAndCompute(jp10, jp3m, (a, b) => a - b),
  },

  // GBP metals — derived from USD price ÷ GBP/USD
  gold_gbp: {
    type: "derived",
    components: ["gold_usd", "gbp_usd"],
    fn: ([gold, gbp]) => alignAndCompute(gold, gbp, (a, b) => (b > 0 ? a / b : 0)),
  },
  silver_gbp: {
    type: "derived",
    components: ["silver_usd", "gbp_usd"],
    fn: ([silver, gbp]) => alignAndCompute(silver, gbp, (a, b) => (b > 0 ? a / b : 0)),
  },
  copper_gbp: {
    type: "derived",
    components: ["copper_usd", "gbp_usd"],
    fn: ([copper, gbp]) => alignAndCompute(copper, gbp, (a, b) => (b > 0 ? a / b : 0)),
  },
};

/**
 * Aligns multiple series by DATE and returns aligned component arrays.
 * For each date in the primary series, finds the most-recent value from each
 * secondary series on or before that date. This handles daily vs monthly
 * FRED series correctly — a monthly rate is forward-filled to daily dates.
 */
function alignByDate(
  primary: { dates: string[]; closes: number[] },
  ...secondaries: { dates: string[]; closes: number[] }[]
): { dates: string[]; components: number[][] } {
  // Pre-sort each secondary series by date (oldest first) for binary search
  const secSorted = secondaries.map((s) => {
    const pairs = s.dates.map((d, i) => [d, s.closes[i]] as [string, number]);
    pairs.sort((a, b) => (a[0] < b[0] ? -1 : 1));
    return pairs;
  });

  const outDates: string[] = [];
  const outComponents: number[][] = Array.from({ length: 1 + secondaries.length }, () => []);

  for (let i = 0; i < primary.dates.length; i++) {
    const date = primary.dates[i];
    const secVals: number[] = [];
    let allFound = true;

    for (const sorted of secSorted) {
      // Binary search: find latest entry with date <= primary date
      let lo = 0, hi = sorted.length - 1, found = -1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (sorted[mid][0] <= date) { found = mid; lo = mid + 1; }
        else hi = mid - 1;
      }
      if (found === -1) { allFound = false; break; }
      secVals.push(sorted[found][1]);
    }

    if (!allFound) continue;
    outDates.push(date);
    outComponents[0].push(primary.closes[i]);
    for (let s = 0; s < secVals.length; s++) outComponents[s + 1].push(secVals[s]);
  }

  return { dates: outDates, components: outComponents };
}

/** Simple element-wise compute (used by derived fn callbacks once arrays are already aligned) */
function alignAndCompute(a: number[], b: number[], fn: (a: number, b: number) => number): number[] {
  const len = Math.min(a.length, b.length);
  return a.slice(0, len).map((v, i) => fn(v, b[i]));
}

// ---------------------------------------------------------------------------
// Fetchers
// ---------------------------------------------------------------------------

async function fetchYahooHistory(ticker: string): Promise<{ dates: string[]; closes: number[] } | null> {
  try {
    const period2 = new Date();
    const period1 = new Date(period2.getTime() - 300 * 86400_000); // 300 days back
    const result = await yf.chart(ticker, { period1, period2, interval: "1d" }, { validateResult: false }) as any;
    const rows = (result.quotes as any[])
      .filter((r: any) => r.close != null && Number.isFinite(r.close))
      .sort((a: any, b: any) => (a.date < b.date ? -1 : 1)); // oldest first

    if (rows.length < 35) return null;
    return {
      dates: rows.map((r: any) => (r.date as Date).toISOString().slice(0, 10)),
      closes: rows.map((r: any) => r.close as number),
    };
  } catch {
    return null;
  }
}

async function fetchStooqHistory(ticker: string): Promise<{ dates: string[]; closes: number[] } | null> {
  const url = `https://stooq.com/q/d/l/?s=${encodeURIComponent(ticker)}&i=d`;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; macro-dashboard/1.0)" },
    });
    if (!res.ok) return null;
    const text = await res.text();
    if (/exceeded the daily hits limit/i.test(text) || /no data/i.test(text) || !text.trim()) return null;

    const lines = text.trim().split("\n");
    const dates: string[] = [];
    const closes: number[] = [];

    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(",");
      if (cols.length < 5) continue;
      const date = cols[0].trim();
      const close = parseFloat(cols[4].trim());
      if (!date || !Number.isFinite(close) || close <= 0) continue;
      dates.push(date);
      closes.push(close);
    }

    // Sort oldest-first
    const pairs = dates.map((d, i) => ({ d, c: closes[i] })).sort((a, b) => (a.d < b.d ? -1 : 1));
    if (pairs.length < 35) return null;

    return {
      dates: pairs.map((p) => p.d),
      closes: pairs.map((p) => p.c),
    };
  } catch {
    return null;
  }
}

async function fetchFredHistory(
  seriesId: string,
  apiKey: string
): Promise<{ dates: string[]; closes: number[] } | null> {
  const url = new URL("https://api.stlouisfed.org/fred/series/observations");
  url.searchParams.set("series_id", seriesId);
  url.searchParams.set("api_key", apiKey);
  url.searchParams.set("sort_order", "desc"); // newest first so limit gives most recent N
  url.searchParams.set("limit", "400"); // 400 entries → ~400 trading days for daily series → covers 1Y lookups
  url.searchParams.set("file_type", "json");

  try {
    const res = await fetch(url.toString());
    if (!res.ok) return null;
    const json = (await res.json()) as { observations: { date: string; value: string }[] };

    const valid = json.observations
      .filter((o) => o.value !== "." && o.value.trim() !== "")
      .map((o) => ({ date: o.date, close: parseFloat(o.value) }))
      .filter((o) => Number.isFinite(o.close))
      .sort((a, b) => (a.date < b.date ? -1 : 1)); // re-sort oldest-first for processing

    if (valid.length < 35) return null;
    return {
      dates: valid.map((o) => o.date),
      closes: valid.map((o) => o.close),
    };
  } catch {
    return null;
  }
}

function formatBoEDate(d: Date): string {
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return `${String(d.getDate()).padStart(2,"0")}/${months[d.getMonth()]}/${d.getFullYear()}`;
}

async function fetchBoEHistory(seriesCode: string): Promise<{ dates: string[]; closes: number[] } | null> {
  const today = new Date();
  const from = new Date(today.getTime() - 600 * 86400_000);
  const url = `https://www.bankofengland.co.uk/boeapps/database/_iadb-FromShowColumns.asp?csv.x=yes&SeriesCodes=${seriesCode}&UsingCodes=Y&CSVF=TN&Datefrom=${formatBoEDate(from)}&Dateto=${formatBoEDate(today)}`;

  try {
    const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (compatible; macro-dashboard/1.0)" } });
    if (!res.ok) return null;
    const text = await res.text();

    const MON: Record<string, string> = {
      Jan:"01",Feb:"02",Mar:"03",Apr:"04",May:"05",Jun:"06",
      Jul:"07",Aug:"08",Sep:"09",Oct:"10",Nov:"11",Dec:"12",
    };

    const pairs: { d: string; c: number }[] = [];
    for (const line of text.trim().split("\n").slice(1)) {
      const cols = line.split(",");
      if (cols.length < 2) continue;
      const parts = cols[0].trim().split(" "); // ["02", "Jan", "2025"]
      if (parts.length !== 3 || !MON[parts[1]]) continue;
      const isoDate = `${parts[2]}-${MON[parts[1]]}-${parts[0].padStart(2,"0")}`;
      const val = parseFloat(cols[1].trim());
      if (!Number.isFinite(val)) continue;
      pairs.push({ d: isoDate, c: val });
    }

    pairs.sort((a, b) => (a.d < b.d ? -1 : 1));
    if (pairs.length < 35) return null;
    return { dates: pairs.map(p => p.d), closes: pairs.map(p => p.c) };
  } catch {
    return null;
  }
}

async function fetchBundesbankHistory(): Promise<{ dates: string[]; closes: number[] } | null> {
  const url = "https://api.statistiken.bundesbank.de/rest/download/BBSSY/D.REN.EUR.A630.000000WT1010.A?format=csv&lang=en";

  try {
    const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (compatible; macro-dashboard/1.0)" } });
    if (!res.ok) return null;
    const text = await res.text();

    const pairs: { d: string; c: number }[] = [];
    for (const line of text.trim().split("\n")) {
      // Try semicolon first, fall back to comma
      let cols = line.split(";");
      if (cols.length < 2) cols = line.split(",");

      const rawDate = cols[0].trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(rawDate)) continue;

      const rawVal = cols[1].trim();
      if (rawVal === "." || rawVal === "") continue;

      const val = parseFloat(rawVal);
      if (!Number.isFinite(val)) continue;
      pairs.push({ d: rawDate, c: val });
    }

    pairs.sort((a, b) => (a.d < b.d ? -1 : 1));
    if (pairs.length < 35) return null;
    return { dates: pairs.map(p => p.d), closes: pairs.map(p => p.c) };
  } catch {
    return null;
  }
}

async function fetchMofJapanHistory(): Promise<{ dates: string[]; closes: number[] } | null> {
  const url = "https://www.mof.go.jp/english/policy/jgbs/reference/interest_rate/historical/jgbcme_all.csv";

  try {
    const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (compatible; macro-dashboard/1.0)" } });
    if (!res.ok) return null;
    const text = await res.text();

    const pairs: { d: string; c: number }[] = [];
    for (const line of text.trim().split("\n").slice(1)) {
      const cols = line.split(",");
      if (cols.length < 11) continue;

      // Date: "YYYY/M/D" → "YYYY-MM-DD"
      const dateParts = cols[0].trim().split("/");
      if (dateParts.length !== 3) continue;
      const isoDate = `${dateParts[0]}-${dateParts[1].padStart(2,"0")}-${dateParts[2].padStart(2,"0")}`;

      const rawVal = cols[10].trim(); // column index 10 = 10Y
      if (rawVal === "-" || rawVal === "") continue;
      const val = parseFloat(rawVal);
      if (!Number.isFinite(val)) continue;
      pairs.push({ d: isoDate, c: val });
    }

    pairs.sort((a, b) => (a.d < b.d ? -1 : 1));
    if (pairs.length < 35) return null;
    return { dates: pairs.map(p => p.d), closes: pairs.map(p => p.c) };
  } catch {
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

  console.log("[history] Starting history + signals + correlations sync...");

  // Step 1: Fetch raw history for all non-derived indicators
  const historyMap = new Map<string, { dates: string[]; closes: number[] }>();

  for (const [slug, source] of Object.entries(HISTORY_SOURCES)) {
    if (source.type === "derived") continue;

    let result: { dates: string[]; closes: number[] } | null = null;

    if (source.type === "yahoo") {
      console.log(`[history] Fetching ${slug} from Yahoo (${source.ticker})...`);
      result = await fetchYahooHistory(source.ticker);
    } else if (source.type === "stooq") {
      console.log(`[history] Fetching ${slug} from Stooq (${source.ticker})...`);
      result = await fetchStooqHistory(source.ticker);
      await new Promise((r) => setTimeout(r, 400)); // rate limit
    } else if (source.type === "fred") {
      console.log(`[history] Fetching ${slug} from FRED (${source.seriesId})...`);
      result = await fetchFredHistory(source.seriesId, apiKey);
    } else if (source.type === "boe") {
      console.log(`[history] Fetching ${slug} from Bank of England (${source.seriesCode})...`);
      result = await fetchBoEHistory(source.seriesCode);
    } else if (source.type === "bundesbank") {
      console.log(`[history] Fetching ${slug} from Bundesbank...`);
      result = await fetchBundesbankHistory();
    } else if (source.type === "mof_japan") {
      console.log(`[history] Fetching ${slug} from MOF Japan...`);
      result = await fetchMofJapanHistory();
    }

    if (result) {
      historyMap.set(slug, result);
    } else {
      console.warn(`[history] No history for ${slug}`);
    }
  }

  // Step 2: Compute derived series (date-aligned so daily + monthly series stay in sync)
  for (const [slug, source] of Object.entries(HISTORY_SOURCES)) {
    if (source.type !== "derived") continue;

    const histories = source.components.map((c) => historyMap.get(c));
    if (histories.some((h) => !h || h.dates.length === 0)) {
      console.warn(`[history] Skipping derived ${slug} — missing component data`);
      continue;
    }

    const [primary, ...secondaries] = histories as { dates: string[]; closes: number[] }[];
    const { dates, components } = alignByDate(primary, ...secondaries);

    if (dates.length < 35) {
      console.warn(`[history] Skipping derived ${slug} — only ${dates.length} aligned rows`);
      continue;
    }

    const closes = source.fn(components);
    historyMap.set(slug, { dates: dates.slice(0, closes.length), closes });
  }

  // Step 3: Upsert history rows into macro_history
  let historyRows = 0;
  for (const [slug, { dates, closes }] of historyMap.entries()) {
    const rows = dates.map((date, i) => ({ indicator: slug, date, value: closes[i] }));
    const { error } = await supabase
      .from("macro_history")
      .upsert(rows, { onConflict: "indicator,date" });
    if (error) {
      console.warn(`[history] Error upserting history for ${slug}: ${error.message}`);
    } else {
      historyRows += rows.length;
    }
  }
  console.log(`[history] History upserted: ${historyRows} rows across ${historyMap.size} indicators`);

  // Step 4: Compute signals + historical returns for each indicator
  let signalsUpdated = 0;
  for (const [slug, { dates, closes }] of historyMap.entries()) {
    if (closes.length < 35) continue;

    const signals = computeMacroSignals(closes);

    // Historical returns: find value N days back, compute % change vs today's close
    const currentValue = closes[closes.length - 1];
    const today = new Date();

    function chgAtDays(n: number): number | null {
      const targetDate = new Date(today.getTime() - n * 86400_000);
      const targetStr = targetDate.toISOString().slice(0, 10);
      // Find closest date on or before target
      let idx = -1;
      for (let i = dates.length - 1; i >= 0; i--) {
        if (dates[i] <= targetStr) { idx = i; break; }
      }
      // No data point found, or the found point is the same as current (monthly series
      // has no intra-month resolution — comparing current to itself gives a meaningless 0%)
      if (idx < 0 || idx === closes.length - 1) return null;
      const pastValue = closes[idx];
      if (!pastValue || !Number.isFinite(pastValue) || pastValue === 0) return null;
      return ((currentValue - pastValue) / Math.abs(pastValue)) * 100;
    }

    const chg_5d   = chgAtDays(7);   // ~5 trading days ≈ 7 calendar days
    const chg_21d  = chgAtDays(30);  // ~21 trading days ≈ 30 calendar days
    const chg_63d  = chgAtDays(91);  // ~63 trading days ≈ 91 calendar days
    const chg_252d = chgAtDays(365); // ~252 trading days ≈ 365 calendar days

    const { error } = await supabase
      .from("macro_indicators")
      .update({
        ma_20: signals.ma_20,
        ma_50: signals.ma_50,
        ma_200: signals.ma_200,
        rsi_14: signals.rsi_14,
        macd_line: signals.macd_line,
        macd_signal: signals.macd_signal,
        macd_hist: signals.macd_hist,
        macd_state: signals.macd_state,
        ema_trend: signals.ema_trend,
        adx: signals.adx,
        dmi_trend: signals.dmi_trend,
        signal_label: signals.signal_label,
        signal_confidence: signals.signal_confidence,
        chg_5d,
        chg_21d,
        chg_63d,
        chg_252d,
      })
      .eq("indicator", slug);

    if (error) {
      console.warn(`[history] Error updating signals for ${slug}: ${error.message}`);
    } else {
      signalsUpdated++;
    }
  }
  console.log(`[history] Signals + returns updated: ${signalsUpdated} indicators`);

  // Step 5: Compute 90-day correlations
  let correlationsUpdated = 0;
  for (const pair of CORRELATION_PAIRS) {
    const seriesA = historyMap.get(pair.indicatorA)?.closes ?? [];
    const seriesB = historyMap.get(pair.indicatorB)?.closes ?? [];

    // Take last 90 and 30 values from each
    const a90 = seriesA.slice(-90);
    const b90 = seriesB.slice(-90);
    const a30 = seriesA.slice(-30);
    const b30 = seriesB.slice(-30);

    const cor_90d = pearsonCorrelation(a90, b90);
    const cor_30d = pearsonCorrelation(a30, b30);

    const { error } = await supabase
      .from("macro_correlations")
      .upsert(
        { pair: pair.pair, label: pair.label, cor_90d, cor_30d, last_updated: now },
        { onConflict: "pair" }
      );

    if (error) {
      console.warn(`[history] Error upserting correlation ${pair.pair}: ${error.message}`);
    } else {
      correlationsUpdated++;
      console.log(`[history] ${pair.label}: COR90D = ${cor_90d ?? "n/a"}`);
    }
  }
  console.log(`[history] Correlations updated: ${correlationsUpdated}`);
  console.log(`[history] Done.`);
}

main().catch((e) => {
  console.error(`[history] fatal: ${e instanceof Error ? e.message : String(e)}`);
  process.exitCode = 1;
});

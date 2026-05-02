// sync-eu-market.ts
// Fetches price history from Yahoo Finance for all European companies.
// Stores raw OHLCV bars in eu_price_bars, then computes momentum
// indicators and regime-aware signals for each company.
//
// Run: npm run sync:eu-market

import { getServiceRoleClient } from "@/lib/supabase-server";
import { fetchPriceHistory, DailyBar } from "@/lib/europe/yahoo-client";
import { computeSignals } from "@/lib/europe/indicators";

const DELAY_MS = 500;

async function delay(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

function pctChange(newVal: number, oldVal: number): number {
  return ((newVal - oldVal) / oldVal) * 100;
}

function nthBar(bars: DailyBar[], n: number): DailyBar | null {
  return bars.length > n ? bars[n] : null;
}

async function main() {
  const supabase = getServiceRoleClient();

  const { data: rows, error } = await supabase
    .from("eu_earnings_companies")
    .select("symbol, sector, report_date, signal_overall, signal_label")
    .order("index_weight", { ascending: false, nullsFirst: false })
    .limit(700);

  if (error) throw new Error(error.message);

  const companies = (rows ?? []) as Array<{
    symbol: string;
    sector: string | null;
    report_date: string | null;
    signal_overall: string | null;
    signal_label: string | null;
  }>;

  console.log(`[eu-market] Fetching Yahoo Finance data for ${companies.length} companies...`);

  let updated = 0;
  const errors: Array<{ symbol: string; error: string }> = [];

  // Keep bars in memory so we can compute signals without re-fetching
  const allBars = new Map<string, DailyBar[]>();

  // --- Phase A: fetch prices, store bars, update core price fields ---
  for (const company of companies) {
    await delay(DELAY_MS);

    const { data: bars, error: fetchErr } = await fetchPriceHistory(company.symbol);

    if (fetchErr || !bars) {
      errors.push({ symbol: company.symbol, error: fetchErr ?? "no data" });
      continue;
    }

    allBars.set(company.symbol, bars);

    const latest = bars[0];
    const d5 = nthBar(bars, 5);
    const d30 = nthBar(bars, 30);

    // Compute 200d MA using adjClose
    let price_vs_200d: number | null = null;
    if (bars.length >= 200) {
      const prices = [...bars].reverse().map((b) => b.adjClose);
      const ma200 = prices.slice(prices.length - 200).reduce((a, b) => a + b, 0) / 200;
      price_vs_200d = ((latest.adjClose - ma200) / ma200) * 100;
    }

    // Deduplicate bars by date before upsert
    const seen = new Set<string>();
    const barRows = bars
      .filter((b) => { if (seen.has(b.date)) return false; seen.add(b.date); return true; })
      .map((b) => ({
        symbol: company.symbol,
        date: b.date,
        open: b.open,
        high: b.high,
        low: b.low,
        close: b.close,
        adj_close: b.adjClose,
        volume: b.volume,
      }));

    const [barsResult, upResult] = await Promise.all([
      supabase.from("eu_price_bars").upsert(barRows, { onConflict: "symbol,date" }),
      supabase
        .from("eu_earnings_companies")
        .update({
          last_price: latest.close,
          price_asof: latest.date,
          return_5d: d5 ? pctChange(latest.adjClose, d5.adjClose) : null,
          return_30d: d30 ? pctChange(latest.adjClose, d30.adjClose) : null,
          price_vs_200d,
        })
        .eq("symbol", company.symbol),
    ]);

    if (barsResult.error) {
      console.warn(`[eu-market] ${company.symbol}: price_bars warning: ${barsResult.error.message}`);
    }

    if (upResult.error) {
      errors.push({ symbol: company.symbol, error: upResult.error.message });
      continue;
    }

    updated++;
    console.log(`[eu-market] ${company.symbol}: ${latest.close} (${latest.date})`);
  }

  // --- Phase B: compute signals for all companies ---
  console.log(`\n[eu-market] Computing signals for ${allBars.size} companies...`);

  const allSignals = new Map<string, ReturnType<typeof computeSignals>>();

  for (const company of companies) {
    const bars = allBars.get(company.symbol);
    if (!bars) continue;
    allSignals.set(company.symbol, computeSignals(bars, company.report_date));
  }

  // --- Phase C: cross-sectional mom_rank_pct ---
  const momEntries: Array<{ symbol: string; mom: number }> = [];
  for (const [symbol, sig] of allSignals) {
    if (sig.mom_12_1 != null) momEntries.push({ symbol, mom: sig.mom_12_1 });
  }
  momEntries.sort((a, b) => a.mom - b.mom);
  const momRankMap = new Map<string, number>();
  momEntries.forEach((entry, idx) => {
    momRankMap.set(entry.symbol, Math.round((idx / Math.max(momEntries.length - 1, 1)) * 100));
  });

  // --- Write signals + rankings to DB ---
  let signalsUpdated = 0;

  for (const company of companies) {
    const signals = allSignals.get(company.symbol);
    if (!signals) continue;

    const signalChanged = signals.signal_label !== company.signal_label;
    const mom_rank_pct = momRankMap.get(company.symbol) ?? null;

    const { error: sigErr } = await supabase
      .from("eu_earnings_companies")
      .update({
        ma_50: signals.ma_50,
        ma_200: signals.ma_200,
        price_vs_ma50: signals.price_vs_ma50,
        price_vs_ma200: signals.price_vs_ma200,
        ma_200_slope_20d: signals.ma_200_slope_20d,
        trend_regime: signals.trend_regime,
        vol_20d_ann: signals.vol_20d_ann,
        max_drawdown_252d: signals.max_drawdown_252d,
        dd_from_peak_252d: signals.dd_from_peak_252d,
        return_63d: signals.return_63d,
        return_126d: signals.return_126d,
        return_252d: signals.return_252d,
        mom_12_1: signals.mom_12_1,
        rsi_14: signals.rsi_14,
        macd_line: signals.macd_line,
        macd_signal: signals.macd_signal,
        macd_hist: signals.macd_hist,
        bb_upper: signals.bb_upper,
        bb_lower: signals.bb_lower,
        bb_pct: signals.bb_pct,
        high_252: signals.high_252,
        low_252: signals.low_252,
        pct_from_high_252: signals.pct_from_high_252,
        pct_from_low_252: signals.pct_from_low_252,
        days_to_earnings: signals.days_to_earnings,
        earnings_window: signals.earnings_window,
        macd_state: signals.macd_state,
        ema_trend: signals.ema_trend,
        dmi_trend: signals.dmi_trend,
        adx: signals.adx,
        di_plus: signals.di_plus,
        di_minus: signals.di_minus,
        signal_label: signals.signal_label,
        signal_overall: signals.signal_overall,
        signal_confidence: signals.signal_confidence,
        entry_level: signals.entry_level,
        stop_level: signals.stop_level,
        risk_reward: signals.risk_reward,
        mom_rank_pct,
        macd_improving_bars: signals.macd_improving_bars,
        signal_trend: null,
        signal_meanrev: null,
        score_trend: null,
        score_meanrev: null,
        confidence: null,
        ...(signalChanged ? { signal_changed_at: new Date().toISOString() } : {}),
      })
      .eq("symbol", company.symbol);

    if (sigErr) {
      console.warn(`[eu-market] ${company.symbol}: signal update error: ${sigErr.message}`);
    } else {
      signalsUpdated++;
    }
  }

  console.log(`[eu-market] Signals computed and written: ${signalsUpdated}`);
  console.log(`\n[eu-market] Done. Updated: ${updated}  Errors: ${errors.length}`);
  if (errors.length) {
    console.log("[eu-market] errors:");
    errors.slice(0, 20).forEach((e) => console.log(`  ${e.symbol}: ${e.error}`));
  }
}

main().catch((e) => {
  console.error(`[eu-market] fatal: ${e instanceof Error ? e.message : String(e)}`);
  process.exitCode = 1;
});

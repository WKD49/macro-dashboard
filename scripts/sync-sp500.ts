/**
 * sync-sp500.ts
 * Fetches price history for all S&P 500 companies from Stooq,
 * computes returns and technical signals, and writes to earnings_companies.
 *
 * Run: npm run sync:sp500
 */

import { getServiceRoleClient } from "@/lib/supabase-server";
import { fetchDailyClosesStooq, nthTradingDay, pctChange, calc200dMA } from "@/lib/market/stooq";
import { computeSignals } from "@/lib/signals/indicators";

// ~14 months of daily bars — enough for MA200, MACD, and 12M momentum
const PRICE_BAR_HISTORY_DAYS = 430;

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const supabase = getServiceRoleClient();

  const { data: allRows, error } = await supabase
    .from("earnings_companies")
    .select("symbol, signal_label")
    .limit(600);

  if (error) throw new Error(error.message);

  const companies = (allRows ?? []) as Array<{ symbol: string; signal_label: string | null }>;
  console.log(`[sp500] processing ${companies.length} companies`);

  type CompanyResult = {
    symbol: string;
    last_price: number | null;
    price_asof: string | null;
    return_5d: number | null;
    return_30d: number | null;
    price_vs_200d: number | null;
    mom_12_1: number | null;
    signals: ReturnType<typeof computeSignals> | null;
    prev_signal_label: string | null;
  };

  const results: CompanyResult[] = [];
  let priceErrors = 0;

  for (const company of companies) {
    const { symbol } = company;
    console.log(`[sp500] fetching ${symbol}...`);
    const bars = await fetchDailyClosesStooq(symbol);

    if (!bars || bars.length < 35) {
      priceErrors++;
      results.push({
        symbol,
        last_price: null,
        price_asof: null,
        return_5d: null,
        return_30d: null,
        price_vs_200d: null,
        mom_12_1: null,
        signals: null,
        prev_signal_label: company.signal_label,
      });
      await sleep(1200);
      continue;
    }

    // Store price bars
    const barsToStore = bars.slice(0, PRICE_BAR_HISTORY_DAYS);
    const barRows = barsToStore.map((b) => ({
      symbol,
      date: b.date,
      open: b.open,
      high: b.high,
      low: b.low,
      close: b.close,
      volume: b.volume,
    }));
    const { error: barsErr } = await supabase
      .from("price_bars")
      .upsert(barRows, { onConflict: "symbol,date" });
    if (barsErr) {
      console.warn(`[sp500] price_bars upsert error for ${symbol}: ${barsErr.message}`);
    }

    // Compute price metrics
    const latest = bars[0];
    const d5   = nthTradingDay(bars, 5);
    const d30  = nthTradingDay(bars, 30);
    const d252 = nthTradingDay(bars, 252);

    const last_price    = latest.close;
    const return_5d     = d5  ? pctChange(latest.close, d5.close)  : null;
    const return_30d    = d30 ? pctChange(latest.close, d30.close) : null;
    const price_vs_200d = calc200dMA(bars);
    const mom_12_1      = d252 && d30 ? pctChange(d30.close, d252.close) : null;

    const signals = computeSignals(bars);

    results.push({
      symbol,
      last_price,
      price_asof: latest.date,
      return_5d,
      return_30d,
      price_vs_200d,
      mom_12_1,
      signals,
      prev_signal_label: company.signal_label,
    });

    await sleep(1200);
  }

  // Cross-sectional momentum ranking
  const ranked = results
    .filter((r) => r.mom_12_1 !== null)
    .sort((a, b) => (a.mom_12_1! < b.mom_12_1! ? -1 : 1));

  const rankMap = new Map<string, number>();
  ranked.forEach((r, i) => {
    rankMap.set(r.symbol, (i / ranked.length) * 100);
  });

  // Write results
  let updated = 0;
  const writeErrors: string[] = [];

  for (const r of results) {
    const mom_rank_pct = rankMap.get(r.symbol) ?? null;
    const signalChanged = r.signals?.signal_label !== r.prev_signal_label;

    const signalFields = r.signals
      ? {
          macd_state:          r.signals.macd_state,
          ema_trend:           r.signals.ema_trend,
          dmi_trend:           r.signals.dmi_trend,
          adx:                 r.signals.adx,
          di_plus:             r.signals.di_plus,
          di_minus:            r.signals.di_minus,
          signal_label:        r.signals.signal_label,
          signal_overall:      r.signals.signal_overall,
          signal_confidence:   r.signals.signal_confidence,
          entry_level:         r.signals.entry_level,
          stop_level:          r.signals.stop_level,
          risk_reward:         r.signals.risk_reward,
          macd_improving_bars: r.signals.macd_improving_bars,
        }
      : {};

    const { error: upErr } = await supabase
      .from("earnings_companies")
      .update({
        last_price: r.last_price,
        price_asof: r.price_asof,
        return_5d: r.return_5d,
        return_30d: r.return_30d,
        price_vs_200d: r.price_vs_200d,
        mom_rank_pct,
        ...signalFields,
        ...(signalChanged ? { signal_changed_at: new Date().toISOString() } : {}),
      })
      .eq("symbol", r.symbol);

    if (upErr) {
      writeErrors.push(`${r.symbol}: ${upErr.message}`);
    } else {
      updated++;
    }
  }

  console.log(
    `[sp500] updated: ${updated} | price errors: ${priceErrors} | write errors: ${writeErrors.length}`
  );
  if (writeErrors.length) {
    console.log("[sp500] write errors:", writeErrors.slice(0, 10));
  }
}

main().catch((e) => {
  console.error(`[sp500] fatal: ${e instanceof Error ? e.message : String(e)}`);
  process.exitCode = 1;
});

// indicators.ts
// Pure-function technical indicator library for European stocks.
// Input: DailyBar[] newest-first (as returned by fetchPriceHistory).
// No DB access, no API calls — just math.

import type { DailyBar } from "@/lib/europe/yahoo-client";

// --- Types ---

export type TrendRegime = "bull" | "bear" | "neutral";

/** MACD momentum state — 4 categories with 3-bar confirmation filter */
export type MACDState = "positive" | "improving" | "weakening" | "negative";

/** EMA trend alignment: price vs MA50 vs MA200 */
export type EMATrend = "up" | "neutral" | "down";

/** DMI trend: ADX-gated directional indicator */
export type DMITrend = "up" | "neutral" | "down";

/** Signal confidence: how many of the 3 dimensions agree */
export type SignalConfidence = "high" | "medium" | "low";

export type SignalResult = {
  // Moving averages
  ma_50: number | null;
  ma_200: number | null;
  price_vs_ma50: number | null;
  price_vs_ma200: number | null;
  ma_200_slope_20d: number | null;
  trend_regime: TrendRegime | null;

  // Risk / volatility
  vol_20d_ann: number | null;
  max_drawdown_252d: number | null;
  dd_from_peak_252d: number | null;

  // Returns & momentum
  return_63d: number | null;
  return_126d: number | null;
  return_252d: number | null;
  mom_12_1: number | null;

  // Classic indicators (kept for stock detail page)
  rsi_14: number | null;
  macd_line: number | null;
  macd_signal: number | null;
  macd_hist: number | null;
  bb_upper: number | null;
  bb_lower: number | null;
  bb_pct: number | null;

  // 52-week range
  high_252: number | null;
  low_252: number | null;
  pct_from_high_252: number | null;
  pct_from_low_252: number | null;

  // Earnings
  days_to_earnings: number | null;
  earnings_window: boolean;

  // === New signal dimensions ===
  macd_state: MACDState | null;
  ema_trend: EMATrend | null;
  dmi_trend: DMITrend | null;
  adx: number | null;
  di_plus: number | null;
  di_minus: number | null;

  // Signal output
  signal_label: string | null;       // e.g. "Strong Bullish Trend"
  signal_overall: string | null;     // same value — kept for change detection in sync script
  signal_confidence: SignalConfidence | null;

  // Entry / risk levels (only populated for actionable long signals)
  entry_level: number | null;
  stop_level: number | null;
  risk_reward: number | null;

  // Watch list: how many consecutive bars MACD histogram has been rising
  macd_improving_bars: number;

  // Legacy fields — set to null (columns still exist in DB)
  signal_trend: null;
  signal_meanrev: null;
  score_trend: null;
  score_meanrev: null;
  confidence: null;
};

// --- Internal helpers (all expect arrays oldest-first) ---

function calcSMA(prices: number[], period: number): number | null {
  if (prices.length < period) return null;
  const slice = prices.slice(prices.length - period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

/** Returns full EMA series, same length as prices. Values before position (period-1) are NaN. */
function calcEMASeries(prices: number[], period: number): number[] {
  const result = new Array(prices.length).fill(NaN) as number[];
  if (prices.length < period) return result;
  let ema = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;
  result[period - 1] = ema;
  const k = 2 / (period + 1);
  for (let i = period; i < prices.length; i++) {
    ema = prices[i] * k + ema * (1 - k);
    result[i] = ema;
  }
  return result;
}

/** RSI with Wilder's smoothing (period=14). prices oldest-first. */
function calcRSI(prices: number[], period = 14): number | null {
  if (prices.length < period + 1) return null;
  const changes = prices.slice(1).map((p, i) => p - prices[i]);
  let avgGain = changes.slice(0, period).filter((c) => c > 0).reduce((a, b) => a + b, 0) / period;
  let avgLoss = changes.slice(0, period).filter((c) => c < 0).reduce((a, b) => a + Math.abs(b), 0) / period;
  for (const change of changes.slice(period)) {
    avgGain = (avgGain * (period - 1) + Math.max(change, 0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-change, 0)) / period;
  }
  if (avgLoss === 0) return 100;
  return 100 - 100 / (1 + avgGain / avgLoss);
}

/** MACD (12, 26, 9). Returns final values plus recent histogram series for state classification. */
function calcMACD(prices: number[]): {
  line: number | null;
  signal: number | null;
  hist: number | null;
  histSeries: number[]; // last 5 histogram values, oldest-first
} {
  const none = { line: null, signal: null, hist: null, histSeries: [] };
  if (prices.length < 35) return none;

  const ema12 = calcEMASeries(prices, 12);
  const ema26 = calcEMASeries(prices, 26);
  const macdLine: number[] = [];
  for (let i = 0; i < prices.length; i++) {
    if (!isNaN(ema12[i]) && !isNaN(ema26[i])) macdLine.push(ema12[i] - ema26[i]);
  }
  if (macdLine.length < 9) return none;

  const signalSeries = calcEMASeries(macdLine, 9);
  const histFull: number[] = [];
  for (let i = 0; i < macdLine.length; i++) {
    if (!isNaN(signalSeries[i])) histFull.push(macdLine[i] - signalSeries[i]);
  }
  if (histFull.length === 0) return none;

  const last = macdLine.length - 1;
  const line = macdLine[last];
  const sig = signalSeries[last];
  if (isNaN(sig)) return none;

  return {
    line,
    signal: sig,
    hist: line - sig,
    histSeries: histFull.slice(-5), // last 5 bars for state classification
  };
}

/**
 * DMI (Directional Movement Index) using Wilder's smoothing.
 * Returns +DI, -DI, and ADX. All arrays oldest-first.
 * Minimum bars needed: period * 2 + 1 (29 for default period=14).
 */
function calcDMI(
  highs: number[],
  lows: number[],
  closes: number[],
  period = 14
): { adx: number | null; diPlus: number | null; diMinus: number | null } {
  const none = { adx: null, diPlus: null, diMinus: null };
  const n = closes.length;
  if (n < period * 2 + 1) return none;

  const tr: number[] = [];
  const plusDM: number[] = [];
  const minusDM: number[] = [];

  for (let i = 1; i < n; i++) {
    const high = highs[i];
    const low = lows[i];
    const prevClose = closes[i - 1];
    const prevHigh = highs[i - 1];
    const prevLow = lows[i - 1];

    tr.push(Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose)));

    const upMove = high - prevHigh;
    const downMove = prevLow - low;

    if (upMove > downMove && upMove > 0) {
      plusDM.push(upMove);
      minusDM.push(0);
    } else if (downMove > upMove && downMove > 0) {
      plusDM.push(0);
      minusDM.push(downMove);
    } else {
      plusDM.push(0);
      minusDM.push(0);
    }
  }

  if (tr.length < period) return none;

  let smoothTR = tr.slice(0, period).reduce((a, b) => a + b, 0);
  let smoothPlus = plusDM.slice(0, period).reduce((a, b) => a + b, 0);
  let smoothMinus = minusDM.slice(0, period).reduce((a, b) => a + b, 0);

  const dxValues: number[] = [];
  const addDX = (sTR: number, sPlus: number, sMinus: number) => {
    if (sTR <= 0) return;
    const diP = (sPlus / sTR) * 100;
    const diM = (sMinus / sTR) * 100;
    const sum = diP + diM;
    if (sum > 0) dxValues.push((Math.abs(diP - diM) / sum) * 100);
  };

  addDX(smoothTR, smoothPlus, smoothMinus);

  for (let i = period; i < tr.length; i++) {
    smoothTR = smoothTR - smoothTR / period + tr[i];
    smoothPlus = smoothPlus - smoothPlus / period + plusDM[i];
    smoothMinus = smoothMinus - smoothMinus / period + minusDM[i];
    addDX(smoothTR, smoothPlus, smoothMinus);
  }

  if (dxValues.length < period) return none;

  let adx = dxValues.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < dxValues.length; i++) {
    adx = (adx * (period - 1) + dxValues[i]) / period;
  }

  const diPlus = smoothTR > 0 ? (smoothPlus / smoothTR) * 100 : null;
  const diMinus = smoothTR > 0 ? (smoothMinus / smoothTR) * 100 : null;

  return { adx, diPlus, diMinus };
}

/** Bollinger Bands (20-day, 2 std dev). prices oldest-first. */
function calcBB(
  prices: number[],
  period = 20
): { upper: number | null; lower: number | null; pct: number | null } {
  const none = { upper: null, lower: null, pct: null };
  if (prices.length < period) return none;
  const slice = prices.slice(prices.length - period);
  const mean = slice.reduce((a, b) => a + b, 0) / period;
  const variance = slice.reduce((a, b) => a + (b - mean) ** 2, 0) / period;
  const std = Math.sqrt(variance);
  const upper = mean + 2 * std;
  const lower = mean - 2 * std;
  const price = prices[prices.length - 1];
  const pct = upper === lower ? 0.5 : (price - lower) / (upper - lower);
  return { upper, lower, pct };
}

// --- Signal dimension classifiers ---

function classifyMACDState(histSeries: number[]): {
  state: MACDState | null;
  improvingBars: number;
} {
  if (histSeries.length < 2) return { state: null, improvingBars: 0 };

  const n = histSeries.length;

  let risingStreak = 0;
  for (let i = n - 1; i > 0; i--) {
    if (histSeries[i] > histSeries[i - 1]) risingStreak++;
    else break;
  }

  let fallingStreak = 0;
  for (let i = n - 1; i > 0; i--) {
    if (histSeries[i] < histSeries[i - 1]) fallingStreak++;
    else break;
  }

  const latest = histSeries[n - 1];
  let state: MACDState;

  if (risingStreak >= 3) {
    state = "improving";
  } else if (fallingStreak >= 3) {
    state = "weakening";
  } else if (latest > 0) {
    state = "positive";
  } else {
    state = "negative";
  }

  return { state, improvingBars: risingStreak };
}

function classifyEMATrend(
  price: number,
  ma50: number | null,
  ma200: number | null
): EMATrend | null {
  if (ma50 == null || ma200 == null) return null;
  if (price > ma50 && ma50 > ma200) return "up";
  if (price < ma50 && ma50 < ma200) return "down";
  return "neutral";
}

function classifyDMITrend(
  adx: number | null,
  diPlus: number | null,
  diMinus: number | null,
  adxThreshold = 20
): DMITrend | null {
  if (adx == null || diPlus == null || diMinus == null) return null;
  if (adx < adxThreshold) return "neutral";
  return diPlus > diMinus ? "up" : "down";
}

function resolveSignalLabel(
  macd: MACDState,
  ema: EMATrend,
  dmi: DMITrend
): string {
  if (ema === "neutral" || dmi === "neutral") return "Sideways / Choppy";

  if (ema === "up" && dmi === "up") {
    if (macd === "positive") return "Strong Bullish Trend";
    if (macd === "improving") return "Bullish Momentum Increasing";
    if (macd === "weakening") return "Bullish Trend Losing Momentum";
    if (macd === "negative") return "Uptrend Under Pressure";
  }

  if (ema === "down" && dmi === "down") {
    if (macd === "positive") return "Counter-Trend Rally";
    if (macd === "improving") return "Bearish Momentum Weakening";
    if (macd === "weakening") return "Bearish Trend Losing Momentum";
    if (macd === "negative") return "Strong Bearish Trend";
  }

  return "Mixed Signals";
}

function resolveConfidence(
  macd: MACDState,
  ema: EMATrend,
  dmi: DMITrend
): SignalConfidence {
  if (ema === "neutral" || dmi === "neutral") return "low";
  if (ema !== dmi) return "low";

  const bullish = ema === "up";
  const macdConsistent = bullish
    ? macd === "positive" || macd === "improving"
    : macd === "negative" || macd === "weakening";

  return macdConsistent ? "high" : "medium";
}

function computeEntryStop(
  signalLabel: string,
  price: number,
  ma50: number | null,
  ma200: number | null,
  high252: number | null
): { entry_level: number | null; stop_level: number | null; risk_reward: number | null } {
  const none = { entry_level: null, stop_level: null, risk_reward: null };

  if (!ma200) return none;

  const stop = ma200 * 0.98;
  let entry: number | null = null;

  if (signalLabel === "Strong Bullish Trend") {
    entry = price;
  } else if (signalLabel === "Bullish Momentum Increasing") {
    entry = ma50 ? ma50 * 0.99 : null;
  }

  if (!entry || entry <= stop) return none;

  const target15pct = entry * 1.15;
  const target =
    high252 && high252 > entry * 1.02 ? Math.max(high252, target15pct) : target15pct;

  const rr = (target - entry) / (entry - stop);

  return {
    entry_level: Math.round(entry * 100) / 100,
    stop_level: Math.round(stop * 100) / 100,
    risk_reward: Math.round(rr * 10) / 10,
  };
}

// --- Main export ---

export function computeSignals(
  bars: DailyBar[], // newest-first
  reportDate: string | null,
  today: string = new Date().toISOString().slice(0, 10)
): SignalResult {
  const prices = [...bars].reverse().map((b) => b.adjClose);
  const highs = [...bars].reverse().map((b) => b.high ?? b.adjClose);
  const lows = [...bars].reverse().map((b) => b.low ?? b.adjClose);
  const n = prices.length;
  const price = prices[n - 1];

  const ma_50 = calcSMA(prices, 50);
  const ma_200 = calcSMA(prices, 200);
  const price_vs_ma50 = ma_50 != null ? ((price - ma_50) / ma_50) * 100 : null;
  const price_vs_ma200 = ma_200 != null ? ((price - ma_200) / ma_200) * 100 : null;

  let ma_200_slope_20d: number | null = null;
  if (n >= 220 && ma_200 != null) {
    const ma200_20d_ago = calcSMA(prices.slice(0, n - 20), 200);
    if (ma200_20d_ago != null) {
      ma_200_slope_20d = ((ma_200 - ma200_20d_ago) / ma200_20d_ago) * 100;
    }
  }

  let trend_regime: TrendRegime | null = null;
  if (ma_50 != null && ma_200 != null && ma_200_slope_20d != null) {
    if (price > ma_50 && ma_50 > ma_200 && ma_200_slope_20d > 0) trend_regime = "bull";
    else if (price < ma_50 && ma_50 < ma_200 && ma_200_slope_20d < 0) trend_regime = "bear";
    else trend_regime = "neutral";
  }

  let vol_20d_ann: number | null = null;
  if (n >= 21) {
    const recent = prices.slice(n - 21);
    const logReturns = recent.slice(1).map((p, i) => Math.log(p / recent[i]));
    const meanLR = logReturns.reduce((a, b) => a + b, 0) / logReturns.length;
    const variance = logReturns.reduce((a, b) => a + (b - meanLR) ** 2, 0) / logReturns.length;
    vol_20d_ann = Math.sqrt(variance * 252) * 100;
  }

  const window252 = prices.slice(Math.max(0, n - 252));
  let max_drawdown_252d: number | null = null;
  let dd_from_peak_252d: number | null = null;
  if (window252.length >= 2) {
    let peak = window252[0];
    let maxDD = 0;
    for (const p of window252) {
      if (p > peak) peak = p;
      const dd = (peak - p) / peak;
      if (dd > maxDD) maxDD = dd;
    }
    max_drawdown_252d = maxDD * 100;
    const currentPeak = Math.max(...window252);
    dd_from_peak_252d = ((currentPeak - price) / currentPeak) * 100;
  }

  const return_63d = n > 63 ? ((price - prices[n - 64]) / prices[n - 64]) * 100 : null;
  const return_126d = n > 126 ? ((price - prices[n - 127]) / prices[n - 127]) * 100 : null;
  const return_252d = n > 252 ? ((price - prices[n - 253]) / prices[n - 253]) * 100 : null;
  const return_30d_val = bars.length > 30 ? ((price - bars[30].adjClose) / bars[30].adjClose) * 100 : null;
  const mom_12_1 = return_252d != null && return_30d_val != null ? return_252d - return_30d_val : null;

  const rsi_14 = calcRSI(prices);
  const {
    line: macd_line,
    signal: macd_signal,
    hist: macd_hist,
    histSeries,
  } = calcMACD(prices);
  const { upper: bb_upper, lower: bb_lower, pct: bb_pct } = calcBB(prices);

  const highs252 = highs.slice(Math.max(0, n - 252));
  const lows252 = lows.slice(Math.max(0, n - 252));
  const high_252 = highs252.length > 0 ? Math.max(...highs252) : null;
  const low_252 = lows252.length > 0 ? Math.min(...lows252) : null;
  const pct_from_high_252 = high_252 != null ? ((price - high_252) / high_252) * 100 : null;
  const pct_from_low_252 = low_252 != null ? ((price - low_252) / low_252) * 100 : null;

  let days_to_earnings: number | null = null;
  let earnings_window = false;
  if (reportDate) {
    const diffMs = new Date(reportDate).getTime() - new Date(today).getTime();
    days_to_earnings = Math.round(diffMs / 86_400_000);
    earnings_window = Math.abs(days_to_earnings) <= 7;
  }

  const { adx, diPlus: di_plus, diMinus: di_minus } = calcDMI(highs, lows, prices);

  const { state: macd_state, improvingBars: macd_improving_bars } =
    classifyMACDState(histSeries);

  const ema_trend = classifyEMATrend(price, ma_50, ma_200);
  const dmi_trend = classifyDMITrend(adx, di_plus, di_minus);

  let signal_label: string | null = null;
  let signal_confidence: SignalConfidence | null = null;
  let entry_level: number | null = null;
  let stop_level: number | null = null;
  let risk_reward: number | null = null;

  if (macd_state != null && ema_trend != null && dmi_trend != null) {
    signal_label = resolveSignalLabel(macd_state, ema_trend, dmi_trend);
    signal_confidence = resolveConfidence(macd_state, ema_trend, dmi_trend);

    const entryStop = computeEntryStop(signal_label, price, ma_50, ma_200, high_252);
    entry_level = entryStop.entry_level;
    stop_level = entryStop.stop_level;
    risk_reward = entryStop.risk_reward;
  }

  return {
    ma_50,
    ma_200,
    price_vs_ma50,
    price_vs_ma200,
    ma_200_slope_20d,
    trend_regime,
    vol_20d_ann,
    max_drawdown_252d,
    dd_from_peak_252d,
    return_63d,
    return_126d,
    return_252d,
    mom_12_1,
    rsi_14,
    macd_line,
    macd_signal,
    macd_hist,
    bb_upper,
    bb_lower,
    bb_pct,
    high_252,
    low_252,
    pct_from_high_252,
    pct_from_low_252,
    days_to_earnings,
    earnings_window,
    macd_state,
    ema_trend,
    dmi_trend,
    adx,
    di_plus,
    di_minus,
    signal_label,
    signal_overall: signal_label,
    signal_confidence,
    entry_level,
    stop_level,
    risk_reward,
    macd_improving_bars,
    signal_trend: null,
    signal_meanrev: null,
    score_trend: null,
    score_meanrev: null,
    confidence: null,
  };
}

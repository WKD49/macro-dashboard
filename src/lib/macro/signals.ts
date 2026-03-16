/**
 * signals.ts
 * Pure-function technical indicator library for macro indicators.
 * Input: number[] of daily closes, oldest-first.
 * No DB access, no API calls — just maths.
 *
 * Adapted from the equity dashboard signals engine.
 * Macro indicators only have close prices (no OHLC), so DMI uses
 * close as an approximation for high/low — acceptable for trend direction.
 */

// --- Types ---

export type MACDState = "positive" | "improving" | "weakening" | "negative";
export type EMATrend = "up" | "neutral" | "down";
export type DMITrend = "up" | "neutral" | "down";
export type SignalConfidence = "high" | "medium" | "low";

export type MacroSignalResult = {
  ma_20: number | null;
  ma_50: number | null;
  ma_200: number | null;
  rsi_14: number | null;
  macd_line: number | null;
  macd_signal: number | null;
  macd_hist: number | null;
  macd_state: MACDState | null;
  ema_trend: EMATrend | null;
  adx: number | null;
  dmi_trend: DMITrend | null;
  signal_label: string | null;
  signal_confidence: SignalConfidence | null;
};

// --- Internal helpers (arrays oldest-first) ---

function calcSMA(prices: number[], period: number): number | null {
  if (prices.length < period) return null;
  const slice = prices.slice(prices.length - period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

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

function calcMACD(prices: number[]): {
  line: number | null;
  signal: number | null;
  hist: number | null;
  histSeries: number[];
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
    histSeries: histFull.slice(-5),
  };
}

/**
 * DMI using close-only approximation.
 * Since macro indicators have no OHLC, we treat close as high = low = close.
 * This gives directional movement based purely on close-to-close changes.
 */
function calcDMI(
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
    const curr = closes[i];
    const prev = closes[i - 1];
    tr.push(Math.abs(curr - prev));

    const upMove = curr - prev;
    const downMove = prev - curr;

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

// --- Signal dimension classifiers ---

function classifyMACDState(histSeries: number[]): MACDState | null {
  if (histSeries.length < 2) return null;
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
  if (risingStreak >= 3) return "improving";
  if (fallingStreak >= 3) return "weakening";
  return latest > 0 ? "positive" : "negative";
}

function classifyEMATrend(price: number, ma50: number | null, ma200: number | null): EMATrend | null {
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

function resolveSignalLabel(macd: MACDState, ema: EMATrend, dmi: DMITrend): string {
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

function resolveConfidence(macd: MACDState, ema: EMATrend, dmi: DMITrend): SignalConfidence {
  if (ema === "neutral" || dmi === "neutral") return "low";
  if (ema !== dmi) return "low";
  const bullish = ema === "up";
  const macdConsistent = bullish
    ? macd === "positive" || macd === "improving"
    : macd === "negative" || macd === "weakening";
  return macdConsistent ? "high" : "medium";
}

// --- Main export ---

/**
 * computeMacroSignals
 * @param closes - daily close values, oldest-first, minimum 35 needed for MACD
 */
export function computeMacroSignals(closes: number[]): MacroSignalResult {
  const n = closes.length;
  const price = closes[n - 1];

  const ma_20 = calcSMA(closes, 20);
  const ma_50 = calcSMA(closes, 50);
  const ma_200 = calcSMA(closes, 200);
  const rsi_14 = calcRSI(closes);

  const { line: macd_line, signal: macd_signal, hist: macd_hist, histSeries } = calcMACD(closes);
  const { adx, diPlus, diMinus } = calcDMI(closes);

  const macd_state = classifyMACDState(histSeries);
  const ema_trend = classifyEMATrend(price, ma_50, ma_200);
  const dmi_trend = classifyDMITrend(adx, diPlus, diMinus);

  let signal_label: string | null = null;
  let signal_confidence: SignalConfidence | null = null;

  if (macd_state != null && ema_trend != null && dmi_trend != null) {
    signal_label = resolveSignalLabel(macd_state, ema_trend, dmi_trend);
    signal_confidence = resolveConfidence(macd_state, ema_trend, dmi_trend);
  }

  return {
    ma_20,
    ma_50,
    ma_200,
    rsi_14,
    macd_line,
    macd_signal,
    macd_hist,
    macd_state,
    ema_trend,
    adx,
    dmi_trend,
    signal_label,
    signal_confidence,
  };
}

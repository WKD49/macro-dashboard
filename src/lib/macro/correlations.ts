/**
 * correlations.ts
 * Computes Pearson correlation coefficient over a rolling window.
 * Used to measure how closely two macro indicators move together.
 */

/**
 * pearsonCorrelation
 * Returns a value between -1.0 and +1.0.
 *   +1 = perfect positive correlation (move together)
 *   -1 = perfect negative correlation (move inversely)
 *    0 = no linear relationship
 *
 * @param a - array of values for series A, oldest-first
 * @param b - array of values for series B, oldest-first (must match length of a)
 */
export function pearsonCorrelation(a: number[], b: number[]): number | null {
  const n = Math.min(a.length, b.length);
  if (n < 10) return null; // too few data points

  const aSlice = a.slice(a.length - n);
  const bSlice = b.slice(b.length - n);

  const meanA = aSlice.reduce((s, x) => s + x, 0) / n;
  const meanB = bSlice.reduce((s, x) => s + x, 0) / n;

  let num = 0;
  let denA = 0;
  let denB = 0;

  for (let i = 0; i < n; i++) {
    const da = aSlice[i] - meanA;
    const db = bSlice[i] - meanB;
    num += da * db;
    denA += da * da;
    denB += db * db;
  }

  const den = Math.sqrt(denA * denB);
  if (den === 0) return null;

  return Math.round((num / den) * 1000) / 1000; // 3 decimal places
}

// --- Correlation pairs for the Macro Dashboard ---

export type CorrelationPair = {
  pair: string;       // slug stored in macro_correlations table
  label: string;      // display name
  indicatorA: string; // slug from macro_indicators / macro_history
  indicatorB: string;
};

export const CORRELATION_PAIRS: CorrelationPair[] = [
  {
    pair: "gold_dxy",
    label: "Gold vs DXY",
    indicatorA: "gold_usd",
    indicatorB: "dxy",
  },
  {
    pair: "gbpusd_us_uk_spread",
    label: "GBP/USD vs US-UK Yield Spread",
    indicatorA: "gbp_usd",
    indicatorB: "us_uk_spread",
  },
  {
    pair: "eurusd_us_de_spread",
    label: "EUR/USD vs US-DE Yield Spread",
    indicatorA: "eur_usd",
    indicatorB: "us_de_spread",
  },
  {
    pair: "usdjpy_us_jp_spread",
    label: "USD/JPY vs US-JP Yield Spread",
    indicatorA: "usd_jpy",
    indicatorB: "us_jp_spread",
  },
];

/**
 * interpretCorrelation
 * Returns a plain-English description of a correlation value.
 */
export function interpretCorrelation(cor: number | null): string {
  if (cor === null) return "Insufficient data";
  const abs = Math.abs(cor);
  const direction = cor > 0 ? "moving together" : "moving inversely";
  if (abs >= 0.7) return `Strongly ${direction}`;
  if (abs >= 0.4) return `Moderately ${direction}`;
  if (abs >= 0.2) return `Weakly ${direction}`;
  return "No clear relationship";
}

// --- S&P 500 Intra-Market Correlation ---

export const SP500_SECTOR_SLUGS = [
  "sp500_xlk", // Technology
  "sp500_xlf", // Financials
  "sp500_xle", // Energy
  "sp500_xlv", // Healthcare
  "sp500_xli", // Industrials
  "sp500_xly", // Consumer Discretionary
  "sp500_xlp", // Consumer Staples
] as const;

/**
 * interpretIntramarketCorrelation
 * Returns a regime label for the average pairwise correlation across S&P 500 sectors.
 * Unlike pair correlations, intramarket correlation is always positive (0 to +1).
 */
export function interpretIntramarketCorrelation(cor: number | null): string {
  if (cor === null) return "Insufficient data";
  if (cor >= 0.7) return "High correlation regime — macro factors dominating";
  if (cor >= 0.5) return "Elevated correlation — macro still influential";
  if (cor >= 0.3) return "Moderate correlation — mixed drivers";
  return "Low correlation — stock-pickers' market";
}

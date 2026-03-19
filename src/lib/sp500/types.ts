export type GicsSector =
  | "Communication Services"
  | "Consumer Discretionary"
  | "Consumer Staples"
  | "Energy"
  | "Financials"
  | "Health Care"
  | "Industrials"
  | "Information Technology"
  | "Materials"
  | "Real Estate"
  | "Utilities";

export const GICS_SECTORS: GicsSector[] = [
  "Communication Services",
  "Consumer Discretionary",
  "Consumer Staples",
  "Energy",
  "Financials",
  "Health Care",
  "Industrials",
  "Information Technology",
  "Materials",
  "Real Estate",
  "Utilities",
];

export function normaliseSector(input: string): GicsSector {
  const trimmed = input.trim();
  const match = GICS_SECTORS.find((s) => s === trimmed);
  return match ?? "Information Technology";
}

export interface SP500CompanyRow {
  symbol: string;
  name: string;
  sector: GicsSector;
  report_date: string | null;
  return_5d: number | null;
  return_30d: number | null;
  index_weight: number | null;
  last_price: number | null;
  price_asof: string | null;
  trailing_pe: number | null;
  forward_pe: number | null;
  peg_ratio: number | null;
  price_vs_200d: number | null;
  ma_50: number | null;
  ma_200: number | null;
  eps_estimate: number | null;
  eps_actual: number | null;
  eps_surprise: number | null;
  eps_surprise_pct: number | null;
  last_synced_at: string;
  macd_state: string | null;
  ema_trend: string | null;
  dmi_trend: string | null;
  adx: number | null;
  di_plus: number | null;
  di_minus: number | null;
  signal_label: string | null;
  signal_overall: string | null;
  signal_confidence: string | null;
  entry_level: number | null;
  stop_level: number | null;
  risk_reward: number | null;
  mom_rank_pct: number | null;
  macd_improving_bars: number | null;
  signal_changed_at: string | null;
}

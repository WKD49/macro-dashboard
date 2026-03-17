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

export interface EuropeanCompanyRow {
  symbol: string;
  name: string;
  sector: GicsSector | null;
  country: string | null;
  stooq_ticker: string | null;
  finnhub_ticker: string | null;
  report_date: string | null;
  return_5d: number | null;
  return_30d: number | null;
  return_252d: number | null;
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
  days_to_earnings: number | null;
  macd_state: string | null;
  ema_trend: string | null;
  dmi_trend: string | null;
  adx: number | null;
  signal_label: string | null;
  signal_confidence: string | null;
  entry_level: number | null;
  stop_level: number | null;
  risk_reward: number | null;
  mom_rank_pct: number | null;
  macd_improving_bars: number | null;
  signal_changed_at: string | null;
}

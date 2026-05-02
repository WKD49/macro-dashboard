export type MacroIndicatorRow = {
  id: number;
  indicator: string;
  value: number | null;
  previous_value: number | null;
  change_pct: number | null;
  currency: string | null;
  last_updated: string | null;
  source: string | null;
  // Signal columns (populated by sync:history)
  ma_20: number | null;
  ma_50: number | null;
  ma_200: number | null;
  rsi_14: number | null;
  macd_line: number | null;
  macd_signal: number | null;
  macd_hist: number | null;
  macd_state: string | null;
  ema_trend: string | null;
  adx: number | null;
  dmi_trend: string | null;
  signal_label: string | null;
  signal_confidence: string | null;
  // Historical return columns (populated by sync:history)
  chg_5d: number | null;
  chg_21d: number | null;
  chg_63d: number | null;
  chg_252d: number | null;
};

export type MacroCorrelationRow = {
  id: number;
  pair: string;
  label: string | null;
  cor_90d: number | null;
  cor_30d: number | null;
  last_updated: string | null;
};

export type MacroSyncLogRow = {
  id: number;
  started_at: string;
  finished_at: string | null;
  status: string | null;
  indicators_updated: number | null;
  errors: unknown;
  notes: string | null;
};

// Category groupings — used to organise cards on the dashboard
export const CATEGORY_SLUGS: Record<string, string[]> = {
  energy: ["brent_crude_usd", "wti_crude_usd", "natural_gas_usd"],
  metals: ["gold_usd", "gold_gbp", "silver_usd", "silver_gbp", "copper_usd", "copper_gbp"],
  fixed_income: ["us_10yr_yield", "uk_10yr_yield", "de_10yr_yield", "jp_10yr_yield", "us_2yr_yield", "us_3m_rate", "uk_3m_rate", "de_3m_rate", "jp_3m_rate", "us_2s10s_spread", "us_yield_spread", "uk_yield_curve", "de_yield_curve", "jp_yield_curve", "us_uk_spread", "us_de_spread", "us_jp_spread"],
  currencies: ["dxy", "gbp_usd", "eur_usd", "gbp_eur", "usd_jpy"],
  volatility: ["vix"],
};

// Human-readable display names for each indicator slug
export const INDICATOR_LABELS: Record<string, string> = {
  brent_crude_usd: "Brent Crude",
  wti_crude_usd:   "WTI Crude",
  natural_gas_usd: "Natural Gas",
  gold_usd:        "Gold (USD)",
  gold_gbp:        "Gold (GBP)",
  silver_usd:      "Silver (USD)",
  silver_gbp:      "Silver (GBP)",
  copper_usd:      "Copper (USD)",
  copper_gbp:      "Copper (GBP)",
  us_10yr_yield:   "US 10yr",
  uk_10yr_yield:   "UK 10yr Gilt",
  de_10yr_yield:   "German 10yr Bund",
  us_2yr_yield:    "US 2yr",
  jp_10yr_yield:   "Japan 10yr JGB",
  us_3m_rate:      "US 3M T-Bill",
  uk_3m_rate:      "UK 3M Rate",
  de_3m_rate:      "DE 3M Rate",
  jp_3m_rate:      "JP 3M Rate",
  us_2s10s_spread: "US Curve (10yr−2yr)",
  us_yield_spread: "US Curve (10yr−3M)",
  uk_yield_curve:  "UK Curve (10yr−3M)",
  de_yield_curve:  "DE Curve (10yr−3M)",
  jp_yield_curve:  "JP Curve (10yr−3M)",
  us_uk_spread:    "US-UK Spread",
  us_de_spread:    "US-DE Spread",
  us_jp_spread:    "US-JP Spread",
  dxy:             "DXY",
  gbp_usd:         "GBP/USD",
  eur_usd:         "EUR/USD",
  gbp_eur:         "GBP/EUR",
  usd_jpy:         "USD/JPY",
  vix:             "VIX",
  sp500_intramarket: "S&P Intra-Market Corr",
  // Credit spreads (OAS, stored as %, displayed as bps)
  us_corp_ig_spread:     "US Corp IG",
  global_corp_ig_spread: "Global Corp IG",
  us_hy_spread:          "US HY",
  euro_hy_spread:        "Euro HY",
};

export const CATEGORY_LABELS: Record<string, string> = {
  energy:       "Energy",
  metals:       "Metals",
  fixed_income: "Fixed Income",
  currencies:   "Currencies",
  volatility:   "Volatility",
};

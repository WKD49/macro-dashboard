export type MacroIndicatorRow = {
  id: number;
  indicator: string;
  value: number | null;
  previous_value: number | null;
  change_pct: number | null;
  currency: string | null;
  last_updated: string | null;
  source: string | null;
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
  fixed_income: ["us_10yr_yield", "uk_10yr_yield", "de_10yr_yield", "us_2yr_yield", "us_yield_spread"],
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
  us_yield_spread: "Yield Spread (10−2yr)",
  dxy:             "DXY",
  gbp_usd:         "GBP/USD",
  eur_usd:         "EUR/USD",
  gbp_eur:         "GBP/EUR",
  usd_jpy:         "USD/JPY",
  vix:             "VIX",
};

export const CATEGORY_LABELS: Record<string, string> = {
  energy:       "Energy",
  metals:       "Metals",
  fixed_income: "Fixed Income",
  currencies:   "Currencies",
  volatility:   "Volatility",
};

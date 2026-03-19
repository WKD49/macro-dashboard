// yahoo-client.ts
// Yahoo Finance wrapper for European stock price history.
// Uses the yahoo-finance2 package — no API key required.
//
// Ticker mapping: our DB uses Finnhub-style symbols (e.g. "SAP.XETRA").
// Yahoo Finance uses .DE for German XETRA stocks. All other suffixes are the same.

// eslint-disable-next-line @typescript-eslint/no-require-imports
const YahooFinance = require("yahoo-finance2").default;
const yf = new YahooFinance({ suppressNotices: ["yahooSurvey", "ripHistorical"] });

// Convert our DB symbol to Yahoo Finance ticker format.
export function toYahooTicker(symbol: string): string {
  return symbol.replace(".XETRA", ".DE");
}

export type YahooSummary = {
  trailingPE: number | null;
  forwardPE: number | null;
  nextEarningsDate: Date | null;
  epsActual: number | null;
  epsEstimate: number | null;
  epsSurprise: number | null;
  epsSurprisePct: number | null;
};

export type DailyBar = {
  date: string;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number;
  adjClose: number;
  volume: number | null;
};

export async function fetchPriceHistory(
  symbol: string
): Promise<{ data: DailyBar[] | null; error: string | null }> {
  const ticker = toYahooTicker(symbol);
  try {
    const period2 = new Date();
    const period1 = new Date(period2.getTime() - 430 * 86400_000); // ~14 months

    const result = await yf.chart(ticker, { period1, period2, interval: "1d" }, { validateResult: false }) as any;
    const rows = result.quotes as any[];

    if (!rows || rows.length < 35) {
      return { data: null, error: `Only ${rows?.length ?? 0} bars returned` };
    }

    const bars: DailyBar[] = rows
      .filter((r: any) => r.close != null && Number.isFinite(r.close))
      .map((r: any) => ({
        date: (r.date as Date).toISOString().slice(0, 10),
        open: r.open ?? null,
        high: r.high ?? null,
        low: r.low ?? null,
        close: r.close as number,
        adjClose: r.adjclose ?? r.close,
        volume: r.volume ?? null,
      }))
      .sort((a: DailyBar, b: DailyBar) => (a.date < b.date ? 1 : -1));

    return { data: bars, error: null };
  } catch (err) {
    return { data: null, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function fetchSummary(
  symbol: string
): Promise<{ data: YahooSummary | null; error: string | null }> {
  const ticker = toYahooTicker(symbol);
  try {
    const result = await yf.quoteSummary(
      ticker,
      { modules: ["summaryDetail", "calendarEvents", "earningsHistory"] },
      { validateResult: false }
    ) as any;

    const history = result.earningsHistory?.history ?? [];
    const latest = history[0];

    return {
      data: {
        trailingPE: result.summaryDetail?.trailingPE ?? null,
        forwardPE: result.summaryDetail?.forwardPE ?? null,
        nextEarningsDate: result.calendarEvents?.earnings?.earningsDate?.[0] ?? null,
        epsActual: latest?.epsActual ?? null,
        epsEstimate: latest?.epsEstimate ?? null,
        epsSurprise: latest?.epsDifference ?? null,
        epsSurprisePct: latest?.surprisePercent ?? null,
      },
      error: null,
    };
  } catch (err) {
    return { data: null, error: err instanceof Error ? err.message : String(err) };
  }
}

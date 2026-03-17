export type DailyBar = {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

function parseCsv(csv: string): DailyBar[] {
  const lines = csv.trim().split(/\r?\n/);
  // Expect header: Date,Open,High,Low,Close,Volume
  if (lines.length < 3) return [];

  const out: DailyBar[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const cols = line.split(",");
    const date   = cols[0];
    const open   = Number(cols[1]);
    const high   = Number(cols[2]);
    const low    = Number(cols[3]);
    const close  = Number(cols[4]);
    const volume = Number(cols[5]);
    if (!date || !Number.isFinite(close)) continue;
    out.push({ date, open, high, low, close, volume });
  }

  // newest first
  out.sort((a, b) => (a.date < b.date ? 1 : -1));
  return out;
}

function stooqSymbolCandidates(symbol: string): string[] {
  // Stooq uses lowercase; US equities often work as: aapl.us
  // Some tickers have '.' (e.g., BRK.B). Try a few fallbacks.
  const s = symbol.toLowerCase();
  const dash = s.replace(/\./g, "-");
  const nodot = s.replace(/\./g, "");
  const candidates = [
    `${s}.us`,
    `${dash}.us`,
    `${nodot}.us`,
    s,      // sometimes works without .us
    dash,
    nodot,
  ];

  // de-dupe preserving order
  return Array.from(new Set(candidates));
}

export async function fetchDailyClosesStooq(symbol: string): Promise<DailyBar[] | null> {
  const candidates = stooqSymbolCandidates(symbol);

  for (const cand of candidates) {
    const url = `https://stooq.com/q/d/l/?s=${encodeURIComponent(cand)}&i=d`;
    const res = await fetch(url, {
      method: "GET",
      headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36" },
    });
    if (!res.ok) continue;

    const text = await res.text();

    // Stooq returns "No data" sometimes
    if (/no data/i.test(text)) continue;

    const bars = parseCsv(text);
    if (bars.length >= 35) return bars;
  }

  return null;
}

export function pctChange(newVal: number, oldVal: number): number {
  return ((newVal - oldVal) / oldVal) * 100;
}

export function nthTradingDay(barsNewestFirst: DailyBar[], n: number): DailyBar | null {
  if (barsNewestFirst.length <= n) return null;
  return barsNewestFirst[n];
}

/**
 * Returns the current price as a % above (+) or below (-) the 200-day
 * simple moving average. Returns null if fewer than 200 bars available.
 */
export function calc200dMA(barsNewestFirst: DailyBar[]): number | null {
  if (barsNewestFirst.length < 200) return null;
  const latest = barsNewestFirst[0].close;
  const sum = barsNewestFirst.slice(0, 200).reduce((acc, b) => acc + b.close, 0);
  const ma200 = sum / 200;
  return ((latest - ma200) / ma200) * 100;
}

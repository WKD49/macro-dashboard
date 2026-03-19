/**
 * Alpha Vantage API client for earnings data.
 * Free tier: 25 calls/day, 5 calls/minute.
 * Docs: https://www.alphavantage.co/documentation/
 *
 * NOTE: EARNINGS_CALENDAR is commonly returned as CSV, even when most endpoints are JSON.
 */

function getApiKey(): string {
  const key = process.env.ALPHA_VANTAGE_API_KEY;
  if (!key) {
    throw new Error(
      "ALPHA_VANTAGE_API_KEY environment variable is required.\n" +
        "Get a free key at https://www.alphavantage.co/support/#api-key\n" +
        "Then add ALPHA_VANTAGE_API_KEY=your_key to .env.local",
    );
  }
  return key;
}

const BASE = "https://www.alphavantage.co/query";

// Free tier daily cap
const API_CALL_HARD_CAP = 25;
let apiCallCount = 0;

export function getApiCallCount() {
  return apiCallCount;
}
export function resetApiCallCount() {
  apiCallCount = 0;
}

// 5 calls/minute => ~12s spacing
let lastCallTime = 0;
const MIN_INTERVAL_MS = 12_000;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface FetchResult<T> {
  data: T | null;
  error: string | null;
}

async function rateLimitAndCount(): Promise<FetchResult<null>> {
  if (apiCallCount >= API_CALL_HARD_CAP) {
    return { data: null, error: `Hard cap reached (${API_CALL_HARD_CAP})` };
  }

  const now = Date.now();
  const elapsed = now - lastCallTime;
  if (elapsed < MIN_INTERVAL_MS && lastCallTime > 0) {
    const waitMs = MIN_INTERVAL_MS - elapsed;
    console.log(`[av] Rate limit: waiting ${waitMs}ms`);
    await sleep(waitMs);
  }

  apiCallCount++;
  lastCallTime = Date.now();
  return { data: null, error: null };
}

function buildUrl(params: Record<string, string>): string {
  const url = new URL(BASE);
  url.searchParams.set("apikey", getApiKey());
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return url.toString();
}

async function avFetchJson<T>(params: Record<string, string>): Promise<FetchResult<T>> {
  const lim = await rateLimitAndCount();
  if (lim.error) return { data: null, error: lim.error };

  const url = buildUrl(params);

  try {
    const res = await fetch(url);
    if (!res.ok) return { data: null, error: `${res.status} ${res.statusText}` };

    const text = await res.text();

    // Alpha Vantage sometimes returns plain-text/csv notes
    let json: any;
    try {
      json = JSON.parse(text);
    } catch {
      return { data: null, error: `Non-JSON response (starts: ${JSON.stringify(text.slice(0, 40))})` };
    }

    if (json.Information) return { data: null, error: String(json.Information) };
    if (json.Note) return { data: null, error: String(json.Note) };
    if (json["Error Message"]) return { data: null, error: String(json["Error Message"]) };

    return { data: json as T, error: null };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { data: null, error: msg };
  }
}

async function avFetchText(params: Record<string, string>): Promise<FetchResult<string>> {
  const lim = await rateLimitAndCount();
  if (lim.error) return { data: null, error: lim.error };

  const url = buildUrl(params);

  try {
    const res = await fetch(url);
    if (!res.ok) return { data: null, error: `${res.status} ${res.statusText}` };

    const text = await res.text();

    // Handle AV note/error in text form
    if (text.includes("Error Message")) return { data: null, error: text.trim() };
    if (text.includes("Thank you for using Alpha Vantage")) return { data: null, error: text.trim() };

    return { data: text, error: null };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { data: null, error: msg };
  }
}

// ───────────────────────────────────────────────────────────────
// API Shapes (subset)
// ───────────────────────────────────────────────────────────────

export interface AvCalendarEntry {
  symbol: string;
  name?: string;
  reportDate: string; // YYYY-MM-DD
  fiscalDateEnding?: string;
  estimate?: string;
}

export interface AvEarningsQuarter {
  fiscalDateEnding: string;    // YYYY-MM-DD
  reportedDate: string;        // YYYY-MM-DD
  reportedEPS: string;         // number as string
  estimatedEPS?: string;       // number as string
  surprise?: string;           // number as string
  surprisePercentage?: string; // number as string
}

export interface AvEarningsResponse {
  symbol: string;
  annualEarnings?: any[];
  quarterlyEarnings?: AvEarningsQuarter[];
}

// Simple CSV parser (handles quoted fields)
function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; continue; }
    if (ch === '"') { inQuotes = !inQuotes; continue; }
    if (ch === "," && !inQuotes) { out.push(cur); cur = ""; continue; }
    cur += ch;
  }
  out.push(cur);
  return out;
}

// ───────────────────────────────────────────────────────────────
// High-level fetchers
// ───────────────────────────────────────────────────────────────

export async function fetchEarningsCalendar12Month(): Promise<FetchResult<AvCalendarEntry[]>> {
  // Earnings calendar is commonly CSV, so fetch as text and parse.
  const { data: text, error } = await avFetchText({
    function: "EARNINGS_CALENDAR",
    horizon: "12month",
  });

  if (error || !text) return { data: null, error: error ?? "No data" };

  const trimmed = text.trim();

  // If AV ever returns JSON here, handle it too.
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      const json: any = JSON.parse(trimmed);
      const entries = Array.isArray(json.earningsCalendar) ? json.earningsCalendar : [];
      return { data: entries, error: null };
    } catch {
      // fall through to CSV parsing
    }
  }

  const lines = trimmed.split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return { data: [], error: null };

  const header = parseCsvLine(lines[0]).map((h) => h.trim());
  const idx = {
    symbol: header.findIndex((h) => h.toLowerCase() === "symbol"),
    name: header.findIndex((h) => h.toLowerCase() === "name"),
    reportDate: header.findIndex((h) => h.toLowerCase() === "reportdate"),
    fiscal: header.findIndex((h) => h.toLowerCase() === "fiscaldateending"),
    estimate: header.findIndex((h) => h.toLowerCase() === "estimate"),
  };

  if (idx.symbol < 0 || idx.reportDate < 0) {
    return { data: null, error: `Unexpected CSV header: ${header.join(",")}` };
  }

  const entries: AvCalendarEntry[] = [];
  for (const line of lines.slice(1)) {
    const cols = parseCsvLine(line);
    const symbol = (cols[idx.symbol] ?? "").trim();
    const reportDate = (cols[idx.reportDate] ?? "").trim();
    if (!symbol || !reportDate) continue;

    entries.push({
      symbol,
      name: idx.name >= 0 ? (cols[idx.name] ?? "").trim() : undefined,
      reportDate,
      fiscalDateEnding: idx.fiscal >= 0 ? (cols[idx.fiscal] ?? "").trim() : undefined,
      estimate: idx.estimate >= 0 ? (cols[idx.estimate] ?? "").trim() : undefined,
    });
  }

  return { data: entries, error: null };
}

export async function fetchCompanyEarnings(symbol: string): Promise<FetchResult<AvEarningsResponse>> {
  return avFetchJson<AvEarningsResponse>({
    function: "EARNINGS",
    symbol,
  });
}

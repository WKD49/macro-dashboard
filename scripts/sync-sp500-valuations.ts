/**
 * sync-sp500-valuations.ts
 * Fetches P/E ratios from Finnhub for the top S&P 500 companies reporting this week and next.
 *
 * Requires FINNHUB_API_KEY in .env.local.
 *
 * Run: npm run sync:sp500-valuations
 */

import { getServiceRoleClient } from "@/lib/supabase-server";
import { startOfWeek, endOfWeek } from "@/lib/sp500/weekHelpers";

type Row = {
  symbol: string;
  report_date: string | null;
  index_weight: number | null;
};

function iso(d: Date) {
  return d.toISOString().slice(0, 10);
}

function inRange(d: string | null, a: Date, b: Date) {
  if (!d) return false;
  const x = new Date(d);
  return x >= a && x <= b;
}

function toNum(v: any): number | null {
  if (v === undefined || v === null || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

async function fetchFinnhubMetrics(symbol: string, token: string) {
  const url =
    `https://finnhub.io/api/v1/stock/metric?symbol=${encodeURIComponent(symbol)}` +
    `&metric=all&token=${encodeURIComponent(token)}`;

  const res = await fetch(url, { headers: { "User-Agent": "macro-dashboard/1.0" } });
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch {}

  return { status: res.status, json, preview: text.slice(0, 140) };
}

function pickMetrics(metric: any) {
  const trailing =
    toNum(metric?.peTTM) ??
    toNum(metric?.pe_ttm) ??
    toNum(metric?.pe) ??
    null;

  const forward =
    toNum(metric?.peForward) ??
    toNum(metric?.forwardPE) ??
    toNum(metric?.pe_forward) ??
    null;

  const peg =
    toNum(metric?.pegTTM) ??
    toNum(metric?.peg) ??
    toNum(metric?.pegRatio) ??
    null;

  return { trailing, forward, peg };
}

async function main() {
  const token = process.env.FINNHUB_API_KEY;
  if (!token) throw new Error("Missing FINNHUB_API_KEY in .env.local");

  const supabase = getServiceRoleClient();

  const { data, error } = await supabase
    .from("earnings_companies")
    .select("symbol,report_date,index_weight")
    .limit(503);

  if (error) throw new Error(error.message);
  const all = (data ?? []) as Row[];

  const now = new Date();
  const wkStart = startOfWeek(now);
  const wkEnd = endOfWeek(now);
  const nextRef = new Date(now.getTime() + 7 * 86400_000);
  const nextWkStart = startOfWeek(nextRef);
  const nextWkEnd = endOfWeek(nextRef);

  const thisWeek = all.filter((r) => inRange(r.report_date, wkStart, wkEnd));
  const nextWeek = all.filter((r) => inRange(r.report_date, nextWkStart, nextWkEnd));

  function top10ByWeight(rows: Row[]) {
    return [...rows]
      .filter((r) => r.index_weight !== null && r.index_weight !== undefined)
      .sort((a, b) => (b.index_weight ?? 0) - (a.index_weight ?? 0))
      .slice(0, 10);
  }

  const topThis = top10ByWeight(thisWeek);
  const topNext = top10ByWeight(nextWeek);
  const symbols = Array.from(new Set([...topThis, ...topNext].map((r) => r.symbol)));

  console.log(
    `[sp500-valuations] windows: this week ${iso(wkStart)}..${iso(wkEnd)} | next week ${iso(nextWkStart)}..${iso(nextWkEnd)}`,
  );
  console.log(`[sp500-valuations] targets: this week ${topThis.length}, next week ${topNext.length}, unique ${symbols.length}`);

  let updated = 0;
  const warnings: Array<{ symbol: string; note: string }> = [];

  for (const symbol of symbols) {
    const { status, json, preview } = await fetchFinnhubMetrics(symbol, token);
    if (status !== 200 || !json) {
      warnings.push({ symbol, note: `HTTP ${status}: ${preview}` });
      continue;
    }

    const metric = json.metric ?? {};
    const { trailing, forward, peg } = pickMetrics(metric);

    if (trailing === null && forward === null && peg === null) {
      const keys = Object.keys(metric).slice(0, 25).join(", ");
      warnings.push({ symbol, note: `No PE/PEG fields found. metric keys: ${keys}` });
      continue;
    }

    const { error: upErr } = await supabase
      .from("earnings_companies")
      .update({ trailing_pe: trailing, forward_pe: forward, peg_ratio: peg })
      .eq("symbol", symbol);

    if (upErr) {
      warnings.push({ symbol, note: upErr.message });
      continue;
    }

    updated++;
    console.log(`[sp500-valuations] ${symbol}: trailing=${trailing ?? "—"} forward=${forward ?? "—"} peg=${peg ?? "—"}`);
  }

  console.log(`[sp500-valuations] updated rows: ${updated}`);
  if (warnings.length) {
    console.log(`[sp500-valuations] warnings (${warnings.length}):`);
    console.log(warnings.slice(0, 10));
  }
}

main().catch((e) => {
  console.error(`[sp500-valuations] fatal: ${e instanceof Error ? e.message : String(e)}`);
  process.exitCode = 1;
});

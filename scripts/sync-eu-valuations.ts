// sync-eu-valuations.ts
// Fetches P/E ratios from Yahoo Finance for the top European companies
// reporting this week and next week.
//
// Run: npm run sync:eu-valuations

import { getServiceRoleClient } from "@/lib/supabase-server";
import { startOfWeek, endOfWeek } from "@/lib/europe/eurofirst";
import { fetchSummary } from "@/lib/europe/yahoo-client";

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

async function delay(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

function toNum(v: unknown): number | null {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

async function main() {
  const supabase = getServiceRoleClient();

  const { data, error } = await supabase
    .from("eu_earnings_companies")
    .select("symbol, report_date, index_weight")
    .limit(300);

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
      .filter((r) => r.index_weight !== null)
      .sort((a, b) => (b.index_weight ?? 0) - (a.index_weight ?? 0))
      .slice(0, 10);
  }

  const topThis = top10ByWeight(thisWeek);
  const topNext = top10ByWeight(nextWeek);

  const seen = new Set<string>();
  const targets = [...topThis, ...topNext].filter((r) => {
    if (seen.has(r.symbol)) return false;
    seen.add(r.symbol);
    return true;
  });

  console.log(
    `[eu-valuations] windows: this week ${iso(wkStart)}..${iso(wkEnd)} | next week ${iso(nextWkStart)}..${iso(nextWkEnd)}`
  );
  console.log(
    `[eu-valuations] targets: this week ${topThis.length}, next week ${topNext.length}, unique ${targets.length}`
  );

  if (targets.length === 0) {
    console.log("[eu-valuations] No companies reporting this week or next — nothing to do.");
    return;
  }

  let updated = 0;
  const warnings: Array<{ symbol: string; note: string }> = [];

  for (const row of targets) {
    await delay(700);

    const { data: summary, error: fetchErr } = await fetchSummary(row.symbol);

    if (fetchErr || !summary) {
      warnings.push({ symbol: row.symbol, note: fetchErr ?? "no data" });
      continue;
    }

    const trailing = toNum(summary.trailingPE);
    const forward = toNum(summary.forwardPE);

    if (trailing === null && forward === null) {
      warnings.push({ symbol: row.symbol, note: "No P/E data returned" });
      continue;
    }

    const { error: upErr } = await supabase
      .from("eu_earnings_companies")
      .update({ trailing_pe: trailing, forward_pe: forward })
      .eq("symbol", row.symbol);

    if (upErr) {
      warnings.push({ symbol: row.symbol, note: upErr.message });
      continue;
    }

    updated++;
    console.log(`[eu-valuations] ${row.symbol}: trailing=${trailing ?? "—"} forward=${forward ?? "—"}`);
  }

  console.log(`[eu-valuations] updated rows: ${updated}`);
  if (warnings.length) {
    console.log(`[eu-valuations] warnings (${warnings.length}):`);
    console.log(JSON.stringify(warnings.slice(0, 10), null, 2));
  }
}

main().catch((e) => {
  console.error(`[eu-valuations] fatal: ${e instanceof Error ? e.message : String(e)}`);
  process.exitCode = 1;
});

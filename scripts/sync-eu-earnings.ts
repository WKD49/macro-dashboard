// sync-eu-earnings.ts
// Fetches earnings dates and EPS data from Yahoo Finance for all European companies.
// Run after sync-eu-weights.ts.
//
// Run: npm run sync:eu-earnings

import { getServiceRoleClient } from "@/lib/supabase-server";
import { fetchSummary } from "@/lib/europe/yahoo-client";

const DELAY_MS = 600;

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
    .select("symbol, finnhub_ticker, last_synced_at")
    .order("last_synced_at", { ascending: true, nullsFirst: true })
    .limit(300);

  if (error) throw new Error(error.message);
  const companies = data ?? [];

  console.log(`[eu-earnings] Fetching Yahoo Finance data for ${companies.length} companies...`);

  let updated = 0;
  let skipped = 0;
  const warnings: Array<{ symbol: string; note: string }> = [];

  for (const company of companies) {
    await delay(DELAY_MS);

    const { data: summary, error: fetchErr } = await fetchSummary(company.symbol);

    if (fetchErr || !summary) {
      warnings.push({ symbol: company.symbol, note: fetchErr ?? "no data" });
      skipped++;
      continue;
    }

    const reportDate = summary.nextEarningsDate
      ? summary.nextEarningsDate.toISOString().slice(0, 10)
      : null;

    const { error: upErr } = await supabase
      .from("eu_earnings_companies")
      .update({
        report_date: reportDate,
        eps_actual: toNum(summary.epsActual),
        eps_estimate: toNum(summary.epsEstimate),
        eps_surprise: toNum(summary.epsSurprise),
        eps_surprise_pct: toNum(summary.epsSurprisePct),
        last_synced_at: new Date().toISOString(),
      })
      .eq("symbol", company.symbol);

    if (upErr) {
      warnings.push({ symbol: company.symbol, note: upErr.message });
      skipped++;
      continue;
    }

    updated++;
    console.log(
      `[eu-earnings] ${company.symbol}: report=${reportDate ?? "—"} ` +
        `eps_actual=${summary.epsActual ?? "—"} eps_est=${summary.epsEstimate ?? "—"}`
    );
  }

  console.log(`\n[eu-earnings] Done. Updated: ${updated}  Skipped: ${skipped}`);
  if (warnings.length) {
    console.log(`[eu-earnings] Warnings (${warnings.length}):`);
    warnings.slice(0, 10).forEach((w) => console.log(`  ${w.symbol}: ${w.note}`));
  }
}

main().catch((e) => {
  console.error(`[eu-earnings] fatal: ${e instanceof Error ? e.message : String(e)}`);
  process.exitCode = 1;
});

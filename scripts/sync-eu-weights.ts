// sync-eu-weights.ts
// Upserts the European large-cap constituent list into eu_earnings_companies.
// Run this first — it creates/refreshes all company rows.
// Re-run whenever the constituent list changes.
//
// Run: npm run sync:eu-weights

import { getServiceRoleClient } from "@/lib/supabase-server";
import { EUROPEAN_LARGE_CAPS } from "@/lib/europe/european-largecap-list";

async function main() {
  const supabase = getServiceRoleClient();

  console.log(`[eu-weights] Upserting ${EUROPEAN_LARGE_CAPS.length} European large-cap constituents...`);

  const chunkSize = 50;
  let upserted = 0;

  for (let i = 0; i < EUROPEAN_LARGE_CAPS.length; i += chunkSize) {
    const chunk = EUROPEAN_LARGE_CAPS.slice(i, i + chunkSize);
    const { error } = await supabase
      .from("eu_earnings_companies")
      .upsert(chunk, { onConflict: "symbol" });

    if (error) throw new Error(`Upsert failed at row ${i}: ${error.message}`);
    upserted += chunk.length;
  }

  console.log(`[eu-weights] Done. ${upserted} companies upserted.`);

  // Remove stale rows (symbols removed or renamed in the list)
  const activeSymbols = EUROPEAN_LARGE_CAPS.map((c) => c.symbol);
  const { data: dbRows } = await supabase.from("eu_earnings_companies").select("symbol");
  const stale = (dbRows ?? [])
    .map((r: { symbol: string }) => r.symbol)
    .filter((s: string) => !activeSymbols.includes(s));

  if (stale.length > 0) {
    console.log(`[eu-weights] Removing ${stale.length} stale symbols: ${stale.join(", ")}`);
    const { error: delErr } = await supabase.from("eu_earnings_companies").delete().in("symbol", stale);
    if (delErr) console.warn(`[eu-weights] Stale row deletion failed: ${delErr.message}`);
  } else {
    console.log("[eu-weights] No stale symbols to remove.");
  }

  // Log top 10 by weight for verification
  const top10 = [...EUROPEAN_LARGE_CAPS]
    .sort((a, b) => b.index_weight - a.index_weight)
    .slice(0, 10);

  console.log("\n[eu-weights] Top 10 by weight:");
  top10.forEach((r, i) => {
    console.log(
      `  ${String(i + 1).padStart(2)}. ${r.symbol.padEnd(14)} ${r.name.padEnd(45)} ${(r.index_weight * 100).toFixed(2)}%`
    );
  });
}

main().catch((e) => {
  console.error(`[eu-weights] fatal: ${e instanceof Error ? e.message : String(e)}`);
  process.exitCode = 1;
});

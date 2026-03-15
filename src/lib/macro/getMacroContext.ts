/**
 * getMacroContext()
 * Returns all current macro indicators as a structured JSON object grouped by category.
 * Called by Portfolio Pal at the start of each session to provide macro context.
 *
 * Safe to use in server components and API routes (uses anon key).
 */

import { getAnonClient } from "@/lib/supabase-server";
import { CATEGORY_SLUGS } from "@/lib/macro/types";

type IndicatorSummary = {
  value: number | null;
  change_pct: number | null;
  currency: string | null;
  last_updated: string | null;
};

type MacroContext = {
  asOf: string;
  energy: Record<string, IndicatorSummary>;
  metals: Record<string, IndicatorSummary>;
  fixed_income: Record<string, IndicatorSummary>;
  currencies: Record<string, IndicatorSummary>;
  volatility: Record<string, IndicatorSummary>;
};

export async function getMacroContext(): Promise<MacroContext> {
  const supabase = getAnonClient();

  const { data, error } = await supabase
    .from("macro_indicators")
    .select("indicator, value, change_pct, currency, last_updated");

  if (error) throw new Error(`getMacroContext: ${error.message}`);

  const rows = data ?? [];
  const bySlug = new Map(rows.map((r) => [r.indicator, r]));

  function buildGroup(slugs: string[]): Record<string, IndicatorSummary> {
    const group: Record<string, IndicatorSummary> = {};
    for (const slug of slugs) {
      const row = bySlug.get(slug);
      group[slug] = {
        value: row?.value ?? null,
        change_pct: row?.change_pct ?? null,
        currency: row?.currency ?? null,
        last_updated: row?.last_updated ?? null,
      };
    }
    return group;
  }

  return {
    asOf: new Date().toISOString(),
    energy:       buildGroup(CATEGORY_SLUGS.energy),
    metals:       buildGroup(CATEGORY_SLUGS.metals),
    fixed_income: buildGroup(CATEGORY_SLUGS.fixed_income),
    currencies:   buildGroup(CATEGORY_SLUGS.currencies),
    volatility:   buildGroup(CATEGORY_SLUGS.volatility),
  };
}

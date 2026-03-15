import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import type { MacroIndicatorRow } from "@/lib/macro/types";
import { INDICATOR_LABELS } from "@/lib/macro/types";

function fmtValue(value: number | null, indicator: string): string {
  if (value === null) return "—";

  // Yields and spread: show as e.g. "4.23%"
  if (
    indicator.includes("yield") ||
    indicator === "us_yield_spread" ||
    indicator === "vix"
  ) {
    return value.toFixed(2);
  }

  // Rates: 4 decimal places
  if (
    indicator === "gbp_usd" ||
    indicator === "eur_usd" ||
    indicator === "gbp_eur"
  ) {
    return value.toFixed(4);
  }

  // JPY: 2 decimal places
  if (indicator === "usd_jpy") {
    return value.toFixed(2);
  }

  // DXY: 2 decimal places
  if (indicator === "dxy") {
    return value.toFixed(2);
  }

  // Commodities and metals: 2 decimal places
  return value.toFixed(2);
}

function fmtDate(ts: string | null): string {
  if (!ts) return "—";
  return new Date(ts).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

type Props = {
  row: MacroIndicatorRow;
};

export function MacroCard({ row }: Props) {
  const label = INDICATOR_LABELS[row.indicator] ?? row.indicator;
  const change = row.change_pct;
  const isPositive = change !== null && change > 0;
  const isNegative = change !== null && change < 0;
  const changeColour = isPositive
    ? "text-green-600"
    : isNegative
    ? "text-red-600"
    : "text-gray-500";

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm flex flex-col gap-2 min-w-0">
      {/* Indicator name */}
      <p className="text-xs font-medium text-gray-500 uppercase tracking-wide truncate">
        {label}
      </p>

      {/* Value + currency */}
      <div className="flex items-baseline gap-1.5">
        <span className="text-2xl font-semibold text-gray-900 tabular-nums">
          {fmtValue(row.value, row.indicator)}
        </span>
        {row.currency && (
          <span className="text-xs text-gray-400">{row.currency}</span>
        )}
      </div>

      {/* Change */}
      <div className={`flex items-center gap-1 text-sm font-medium ${changeColour}`}>
        {isPositive && <TrendingUp className="w-4 h-4 shrink-0" />}
        {isNegative && <TrendingDown className="w-4 h-4 shrink-0" />}
        {!isPositive && !isNegative && <Minus className="w-4 h-4 shrink-0" />}
        <span>
          {change !== null
            ? `${change >= 0 ? "+" : ""}${change.toFixed(2)}%`
            : "—"}
        </span>
      </div>

      {/* Last updated */}
      <p className="text-xs text-gray-400 mt-auto">
        {fmtDate(row.last_updated)}
      </p>
    </div>
  );
}

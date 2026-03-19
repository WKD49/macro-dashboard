"use client";

import { useState, Fragment } from "react";
import { TrendingUp, TrendingDown, Minus, ChevronDown, ChevronRight } from "lucide-react";
import type { MacroIndicatorRow, MacroCorrelationRow } from "@/lib/macro/types";
import { INDICATOR_LABELS } from "@/lib/macro/types";
import { SP500Section } from "@/components/sp500/SP500Section";
import { EuropeSection } from "@/components/europe/EuropeSection";
import type { SP500CompanyRow } from "@/lib/sp500/types";
import type { EuropeanCompanyRow } from "@/lib/europe/types";

type CurveHistoryRow = { indicator: string; date: string; value: number };

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function fmtValue(value: number | null, indicator: string): string {
  if (value === null) return "—";
  if (indicator.includes("yield") || indicator.includes("spread") || indicator.includes("curve") || indicator === "vix")
    return value.toFixed(2);
  if (indicator === "gbp_usd" || indicator === "eur_usd" || indicator === "gbp_eur")
    return value.toFixed(4);
  if (indicator === "usd_jpy" || indicator === "dxy") return value.toFixed(2);
  return value.toFixed(2);
}

function fmtPct(v: number | null): string {
  if (v === null || !Number.isFinite(v)) return "—";
  return `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`;
}

// Bond/yield indicators: show change in basis points (bps) not % — yields are small
// numbers (e.g. 4.25%) so a 10bps move shows as "+0.24%" which is confusing.
// We recover the absolute change from (chgPct, currentValue) using the inverse of
// the % change formula: bps = current * (chgPct/100) / (1 + chgPct/100) * 100
const BPS_INDICATORS = new Set([
  "us_10yr_yield", "us_2yr_yield", "uk_10yr_yield", "de_10yr_yield", "jp_10yr_yield",
  "us_3m_rate", "uk_3m_rate", "de_3m_rate", "jp_3m_rate",
  "us_yield_spread", "uk_yield_curve", "de_yield_curve", "jp_yield_curve",
  "us_uk_spread", "us_de_spread", "us_jp_spread",
]);

function fmtChg(chgPct: number | null, indicator: string, currentValue?: number | null): string {
  if (chgPct === null || !Number.isFinite(chgPct)) return "—";
  if (BPS_INDICATORS.has(indicator) && currentValue != null && Number.isFinite(currentValue)) {
    // chgPct = (current - past) / |past| * 100
    // For past > 0: past = current / (1 + chgPct/100)
    // abs change (in %pts) = current - past = current * chgPct/100 / (1 + chgPct/100)
    // bps = abs change * 100
    const d = 1 + chgPct / 100;
    if (!Number.isFinite(d) || Math.abs(d) < 0.01) return "—";
    const bps = (currentValue * (chgPct / 100) / d) * 100;
    if (!Number.isFinite(bps)) return "—";
    return `${bps >= 0 ? "+" : ""}${bps.toFixed(0)}bps`;
  }
  return `${chgPct >= 0 ? "+" : ""}${chgPct.toFixed(2)}%`;
}

function pctColour(v: number | null): string {
  if (v === null || !Number.isFinite(v)) return "text-gray-400";
  return v > 0 ? "text-green-600" : v < 0 ? "text-red-600" : "text-gray-500";
}

// Yield curves, cross-country spreads, and credit spreads: stored as %, displayed as bps (× 100)
const BPS_VALUE_INDICATORS = new Set([
  "us_yield_spread", "uk_yield_curve", "de_yield_curve", "jp_yield_curve",
  "us_uk_spread", "us_de_spread", "us_jp_spread",
  // ICE BofA OAS series: stored as % (e.g. 0.90 = 90bps), displayed as bps (× 100)
  "us_corp_ig_spread", "global_corp_ig_spread", "us_hy_spread",
  // global_hy_spread, em_usd_spread, em_lc_spread are ETF prices — shown as USD, not bps
]);

function fmtDisplayValue(value: number | null, indicator: string): string {
  if (value === null) return "—";
  if (BPS_VALUE_INDICATORS.has(indicator)) return (value * 100).toFixed(0);
  if (indicator === "sp500_intramarket") return (value >= 0 ? "+" : "") + value.toFixed(3);
  return fmtValue(value, indicator);
}

function getDisplayUnit(indicator: string, currency: string | null): string | null {
  if (BPS_VALUE_INDICATORS.has(indicator)) return "bps";
  return currency;
}

// ---------------------------------------------------------------------------
// Shared badge components
// ---------------------------------------------------------------------------

function SignalBadge({ label }: { label: string | null }) {
  if (!label) return <span className="text-gray-400 text-xs">—</span>;
  const isGreen =
    (label.includes("Bullish") && !label.includes("Under Pressure")) ||
    label === "Bearish Momentum Weakening" ||
    label === "Bearish Trend Losing Momentum" ||
    label === "Counter-Trend Rally";
  const isRed = (label.includes("Bearish") && !isGreen) || label === "Uptrend Under Pressure";
  const colour = isGreen
    ? "bg-green-50 text-green-700 border border-green-200"
    : isRed
    ? "bg-red-50 text-red-700 border border-red-200"
    : "bg-gray-100 text-gray-600 border border-gray-200";
  return (
    <span className={`inline-block text-xs font-medium px-2 py-0.5 rounded-full whitespace-nowrap ${colour}`}>
      {label}
    </span>
  );
}

function ConfidenceDot({ confidence }: { confidence: string | null }) {
  if (!confidence) return <span className="text-gray-300 text-xs">—</span>;
  const colour =
    confidence === "high" ? "bg-green-500" : confidence === "medium" ? "bg-amber-400" : "bg-gray-300";
  return <span title={confidence} className={`inline-block w-2.5 h-2.5 rounded-full ${colour}`} />;
}

function TrendBadge({ value }: { value: string | null }) {
  if (!value) return <span className="text-gray-400 text-xs">—</span>;
  const colour = value === "up" ? "text-green-600" : value === "down" ? "text-red-600" : "text-gray-500";
  const label = value === "up" ? "↑" : value === "down" ? "↓" : "→";
  return <span className={`text-sm font-semibold ${colour}`}>{label}</span>;
}

function MACDBadge({ state }: { state: string | null }) {
  if (!state) return <span className="text-gray-400 text-xs">—</span>;
  const map: Record<string, string> = {
    positive: "bg-green-50 text-green-700",
    improving: "bg-blue-50 text-blue-700",
    weakening: "bg-amber-50 text-amber-700",
    negative: "bg-red-50 text-red-700",
  };
  return (
    <span className={`inline-block text-xs px-1.5 py-0.5 rounded ${map[state] ?? "text-gray-500"}`}>
      {state.charAt(0).toUpperCase() + state.slice(1)}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Signal drill-down panel
// ---------------------------------------------------------------------------

function DrillDownSection({ title, colour, children }: { title: string; colour: string; children: React.ReactNode }) {
  return (
    <div className={`rounded-lg p-3 ${colour}`}>
      <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1.5">{title}</p>
      {children}
    </div>
  );
}

function SignalDrillDown({ row }: { row: MacroIndicatorRow }) {
  // EMA explanation
  const emaNarrative = (() => {
    if (!row.ema_trend) return "Not enough history to assess EMA trend.";
    const p = row.value !== null ? fmtValue(row.value, row.indicator) : "?";
    const ma50 = row.ma_50 !== null ? fmtValue(row.ma_50, row.indicator) : "?";
    const ma200 = row.ma_200 !== null ? fmtValue(row.ma_200, row.indicator) : "?";
    if (row.ema_trend === "up")
      return `Price (${p}) is above MA50 (${ma50}), which is above MA200 (${ma200}). Uptrend confirmed across all timeframes.`;
    if (row.ema_trend === "down")
      return `Price (${p}) is below MA50 (${ma50}), which is below MA200 (${ma200}). Downtrend confirmed across all timeframes.`;
    return `Price (${p}), MA50 (${ma50}), and MA200 (${ma200}) are mixed — no clear directional trend.`;
  })();

  // MACD explanation
  const macdNarrative = (() => {
    if (!row.macd_state) return "Not enough history to compute MACD.";
    if (row.macd_state === "improving") return "Histogram has been rising consistently — momentum is building.";
    if (row.macd_state === "weakening") return "Histogram has been falling consistently — momentum is fading.";
    if (row.macd_state === "positive") return "MACD line is above the signal line — bullish bias.";
    return "MACD line is below the signal line — bearish bias.";
  })();

  // DMI/ADX explanation
  const dmiNarrative = (() => {
    if (row.adx === null) return "Not enough history to compute DMI/ADX.";
    const adxVal = row.adx.toFixed(1);
    if (row.adx < 20) return `ADX (${adxVal}) is below 20 — trend strength is weak, signals are less reliable.`;
    if (row.dmi_trend === "up") return `ADX (${adxVal}) confirms a strong trend. DI+ is dominant — upward directional pressure.`;
    if (row.dmi_trend === "down") return `ADX (${adxVal}) confirms a strong trend. DI- is dominant — downward directional pressure.`;
    return `ADX (${adxVal}) — trend direction is neutral.`;
  })();

  // RSI explanation
  const rsiNarrative = (() => {
    if (row.rsi_14 === null) return "Not enough history to compute RSI.";
    const r = row.rsi_14.toFixed(1);
    if (row.rsi_14 < 30) return `RSI (${r}) — oversold territory. Potential for a bounce.`;
    if (row.rsi_14 > 70) return `RSI (${r}) — overbought territory. Watch for a pullback.`;
    return `RSI (${r}) — neutral range, no extreme reading.`;
  })();

  return (
    <div className="bg-gray-50 border-t border-gray-100 px-4 py-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-4xl">

        <DrillDownSection title="EMA Trend" colour="bg-white border border-gray-200">
          <p className="text-sm text-gray-700">{emaNarrative}</p>
          {(row.ma_20 !== null || row.ma_50 !== null || row.ma_200 !== null) && (
            <p className="text-xs text-gray-400 mt-1.5">
              MA20: {row.ma_20 !== null ? fmtValue(row.ma_20, row.indicator) : "—"} &nbsp;·&nbsp;
              MA50: {row.ma_50 !== null ? fmtValue(row.ma_50, row.indicator) : "—"} &nbsp;·&nbsp;
              MA200: {row.ma_200 !== null ? fmtValue(row.ma_200, row.indicator) : "—"}
            </p>
          )}
        </DrillDownSection>

        <DrillDownSection title="MACD (12, 26, 9)" colour="bg-white border border-gray-200">
          <p className="text-sm text-gray-700">{macdNarrative}</p>
          {row.macd_line !== null && (
            <p className="text-xs text-gray-400 mt-1.5">
              Line: {row.macd_line.toFixed(3)} &nbsp;·&nbsp;
              Signal: {row.macd_signal !== null ? row.macd_signal.toFixed(3) : "—"} &nbsp;·&nbsp;
              Hist: {row.macd_hist !== null ? row.macd_hist.toFixed(3) : "—"}
            </p>
          )}
        </DrillDownSection>

        <DrillDownSection title="DMI / ADX (14)" colour="bg-white border border-gray-200">
          <p className="text-sm text-gray-700">{dmiNarrative}</p>
          <p className="text-xs text-gray-400 mt-1.5">
            ADX threshold: 20 &nbsp;·&nbsp; Above 25 = strong trend, above 40 = very strong
          </p>
        </DrillDownSection>

        <DrillDownSection title="RSI (14)" colour="bg-white border border-gray-200">
          <p className="text-sm text-gray-700">{rsiNarrative}</p>
          <p className="text-xs text-gray-400 mt-1.5">
            Below 30 = oversold &nbsp;·&nbsp; Above 70 = overbought
          </p>
        </DrillDownSection>

      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab 1: Overview — Risk Gauges
// ---------------------------------------------------------------------------

const RISK_GAUGES: { slug: string; subLabel: string }[] = [
  { slug: "vix",               subLabel: "Fear Gauge" },
  { slug: "sp500_intramarket", subLabel: "Crowding Regime" },
  { slug: "gold_usd",          subLabel: "Safe Haven" },
  { slug: "dxy",               subLabel: "Dollar Strength" },
  { slug: "us_10yr_yield",     subLabel: "Rates / Safety" },
  { slug: "copper_usd",        subLabel: "Risk Appetite" },
];

function GaugeCard({ row, subLabel }: { row: MacroIndicatorRow | undefined; subLabel: string }) {
  const name = row ? (INDICATOR_LABELS[row.indicator] ?? row.indicator) : "—";

  if (!row) return (
    <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
      <p className="text-xs font-medium text-gray-400 uppercase tracking-wide truncate">{name}</p>
      <p className="text-xs text-gray-300 mb-2">{subLabel}</p>
      <p className="text-2xl font-bold text-gray-200">—</p>
    </div>
  );

  // Regime label + colour
  let regimeLabel: string;
  let regimeColour: string;
  if (row.indicator === "vix") {
    const b = vixBand(row.value);
    regimeLabel = b.label; regimeColour = b.colour;
  } else if (row.indicator === "sp500_intramarket") {
    const r = intramarketRegime(row.value);
    regimeLabel = r.label; regimeColour = r.colour;
  } else {
    regimeLabel = row.signal_label ?? "—";
    regimeColour = row.ema_trend === "up" ? "text-green-600"
                 : row.ema_trend === "down" ? "text-red-600"
                 : "text-gray-500";
  }

  const chg  = row.chg_21d ?? row.chg_5d ?? null;
  const chgL = row.chg_21d != null ? "1M" : row.chg_5d != null ? "1W" : null;
  const cor30d = row.indicator === "sp500_intramarket" ? row.previous_value : null;

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm flex flex-col gap-1.5">
      <div>
        <p className="text-xs font-semibold text-gray-700 uppercase tracking-wide truncate">{name}</p>
        <p className="text-xs text-gray-400">{subLabel}</p>
      </div>
      <div className="flex items-baseline gap-1 mt-0.5">
        <span className="text-2xl font-bold text-gray-900 tabular-nums">
          {fmtDisplayValue(row.value, row.indicator)}
        </span>
        {getDisplayUnit(row.indicator, row.currency) && (
          <span className="text-xs text-gray-400">{getDisplayUnit(row.indicator, row.currency)}</span>
        )}
      </div>
      <p className={`text-xs font-semibold leading-tight ${regimeColour}`}>{regimeLabel}</p>
      {cor30d !== null ? (
        <p className="text-xs text-gray-500 tabular-nums">
          30d: <span className={corColour(cor30d)}>{(cor30d >= 0 ? "+" : "") + cor30d.toFixed(3)}</span>
          <span className="text-gray-300 mx-1">·</span>
          90d: <span className={corColour(row.value)}>{row.value !== null ? (row.value >= 0 ? "+" : "") + row.value.toFixed(3) : "—"}</span>
        </p>
      ) : chg !== null && chgL ? (
        <p className={`text-xs tabular-nums ${pctColour(chg)}`}>
          {chgL}: {fmtChg(chg, row.indicator, row.value)}
        </p>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab 1: Overview
// ---------------------------------------------------------------------------

function classifySignal(label: string | null): "bullish" | "bearish" | "sideways" | null {
  if (!label) return null;
  if (label.includes("Sideways") || label === "Mixed Signals") return "sideways";
  if (
    (label.includes("Bullish") && !label.includes("Under Pressure")) ||
    label === "Bearish Momentum Weakening" ||
    label === "Bearish Trend Losing Momentum" ||
    label === "Counter-Trend Rally"
  ) return "bullish";
  if (label.includes("Bearish") || label === "Uptrend Under Pressure") return "bearish";
  return "sideways";
}

const SIGNAL_STRENGTH_RANK: Record<string, number> = {
  "Strong Bullish Trend": 0,
  "Strong Bearish Trend": 1,
  "Bullish Momentum Increasing": 2,
  "Bearish Momentum Weakening": 3,
  "Bearish Trend Losing Momentum": 4,
  "Bullish Trend Losing Momentum": 5,
  "Uptrend Under Pressure": 6,
};

function HighConvictionCard({
  row,
  expanded,
  onToggle,
}: {
  row: MacroIndicatorRow;
  expanded: boolean;
  onToggle: () => void;
}) {
  const label = INDICATOR_LABELS[row.indicator] ?? row.indicator;
  return (
    <div
      onClick={onToggle}
      className={`bg-white border rounded-xl p-4 shadow-sm flex flex-col gap-2 cursor-pointer transition-all ${
        expanded ? "border-gray-400 ring-1 ring-gray-300" : "border-gray-200 hover:border-gray-300"
      }`}
    >
      <p className="text-xs font-medium text-gray-500 uppercase tracking-wide truncate">{label}</p>
      <div className="flex items-baseline gap-1.5">
        <span className="text-xl font-semibold text-gray-900 tabular-nums">
          {fmtDisplayValue(row.value, row.indicator)}
        </span>
        {getDisplayUnit(row.indicator, row.currency) && (
          <span className="text-xs text-gray-400">{getDisplayUnit(row.indicator, row.currency)}</span>
        )}
      </div>
      <SignalBadge label={row.signal_label} />
      {(() => {
        // For monthly FRED series 1W/1M are null — fall back to next available period
        const p1 = row.chg_5d  != null ? { label: "1W", v: row.chg_5d  } :
                   row.chg_63d != null ? { label: "3M", v: row.chg_63d } : null;
        const p2 = row.chg_21d  != null ? { label: "1M",  v: row.chg_21d  } :
                   row.chg_252d != null ? { label: "1Y",  v: row.chg_252d } : null;
        return (
          <div className="flex items-center gap-3 mt-1 text-xs text-gray-500 flex-wrap">
            <span>MACD: <span className="font-medium text-gray-700">{row.macd_state ?? "—"}</span></span>
            {p1 && (
              <span className={`font-medium tabular-nums ${pctColour(p1.v)}`}>
                {p1.label}: {fmtChg(p1.v, row.indicator, row.value)}
              </span>
            )}
            {p2 && (
              <span className={`font-medium tabular-nums ${pctColour(p2.v)}`}>
                {p2.label}: {fmtChg(p2.v, row.indicator, row.value)}
              </span>
            )}
          </div>
        );
      })()}
      <p className="text-xs text-blue-500 mt-0.5">{expanded ? "▲ Hide detail" : "▼ Why?"}</p>
    </div>
  );
}

function OverviewTab({ indicators }: { indicators: MacroIndicatorRow[] }) {
  const [expandedSlug, setExpandedSlug] = useState<string | null>(null);

  const bySlug = new Map<string, MacroIndicatorRow>();
  for (const row of indicators) bySlug.set(row.indicator, row);

  const pulse = indicators.reduce(
    (acc, r) => {
      const dir = classifySignal(r.signal_label);
      if (dir === "bullish") acc.bullish++;
      else if (dir === "bearish") acc.bearish++;
      else acc.sideways++;
      if (r.signal_confidence === "high") acc.highConv++;
      return acc;
    },
    { bullish: 0, bearish: 0, sideways: 0, highConv: 0 }
  );

  const highConv = indicators
    .filter(
      (r) =>
        (r.signal_confidence === "high" || r.signal_confidence === "medium") &&
        r.signal_label &&
        r.signal_label !== "Sideways / Choppy" &&
        r.signal_label !== "Mixed Signals"
    )
    .sort((a, b) => {
      // High confidence before medium
      if (a.signal_confidence !== b.signal_confidence) {
        return a.signal_confidence === "high" ? -1 : 1;
      }
      return (SIGNAL_STRENGTH_RANK[a.signal_label!] ?? 99) - (SIGNAL_STRENGTH_RANK[b.signal_label!] ?? 99);
    })
    .slice(0, 8);

  const expandedRow = expandedSlug ? indicators.find((r) => r.indicator === expandedSlug) : null;

  return (
    <div className="flex flex-col gap-8">
      {/* Market Pulse */}
      <div>
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Market Pulse</p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="bg-green-50 border border-green-100 rounded-xl p-4 text-center">
            <p className="text-2xl font-bold text-green-700">{pulse.bullish}</p>
            <p className="text-xs font-medium text-green-600 mt-1">Bullish signals</p>
          </div>
          <div className="bg-red-50 border border-red-100 rounded-xl p-4 text-center">
            <p className="text-2xl font-bold text-red-700">{pulse.bearish}</p>
            <p className="text-xs font-medium text-red-600 mt-1">Bearish signals</p>
          </div>
          <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 text-center">
            <p className="text-2xl font-bold text-gray-600">{pulse.sideways}</p>
            <p className="text-xs font-medium text-gray-500 mt-1">Sideways / Mixed</p>
          </div>
          <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 text-center">
            <p className="text-2xl font-bold text-blue-700">{pulse.highConv}</p>
            <p className="text-xs font-medium text-blue-600 mt-1">High conviction</p>
          </div>
        </div>
      </div>

      {/* High Conviction */}
      {highConv.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">
            Top Signals — click to see why
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {highConv.map((row) => (
              <HighConvictionCard
                key={row.indicator}
                row={row}
                expanded={expandedSlug === row.indicator}
                onToggle={() =>
                  setExpandedSlug(expandedSlug === row.indicator ? null : row.indicator)
                }
              />
            ))}
          </div>
          {expandedRow && (
            <div className="mt-3 rounded-xl border border-gray-200 overflow-hidden">
              <div className="bg-gray-50 px-4 py-2 border-b border-gray-100">
                <p className="text-xs font-semibold text-gray-600">
                  Signal breakdown: {INDICATOR_LABELS[expandedRow.indicator] ?? expandedRow.indicator}
                </p>
              </div>
              <SignalDrillDown row={expandedRow} />
            </div>
          )}
        </div>
      )}

      {/* Risk Gauges */}
      <div>
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Risk Gauges</p>
        <div className="grid grid-cols-3 gap-3">
          {RISK_GAUGES.map(({ slug, subLabel }) => (
            <GaugeCard key={slug} row={bySlug.get(slug)} subLabel={subLabel} />
          ))}
        </div>
      </div>

      {/* All indicators */}
      <div>
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">
          All Indicators — click any column header to sort
        </p>
        <SortableIndicatorTable bySlug={bySlug} />
        <p className="mt-3 text-xs text-gray-400">
          * Global HY, EM USD, and EM Local are ETF prices (USD), not OAS spreads in bps — use for direction only.
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab 2: Signals table with inline drill-down
// ---------------------------------------------------------------------------

const SIGNALS_ORDER = [
  "brent_crude_usd", "wti_crude_usd", "natural_gas_usd",
  "gold_usd", "gold_gbp", "silver_usd", "silver_gbp", "copper_usd", "copper_gbp",
  "dxy", "gbp_usd", "eur_usd", "gbp_eur", "usd_jpy",
  "us_10yr_yield", "us_2yr_yield", "uk_10yr_yield", "de_10yr_yield", "jp_10yr_yield",
  "us_yield_spread", "uk_yield_curve", "de_yield_curve", "jp_yield_curve",
  "us_uk_spread", "us_de_spread", "us_jp_spread",
  "us_corp_ig_spread", "global_corp_ig_spread", "us_hy_spread",
  "global_hy_spread", "em_usd_spread", "em_lc_spread",
];

function ReturnCell({ value, indicator, currentValue }: { value: number | null; indicator?: string; currentValue?: number | null }) {
  return (
    <td className={`py-2.5 px-2 text-right tabular-nums text-xs font-medium ${pctColour(value)}`}>
      {indicator ? fmtChg(value, indicator, currentValue) : fmtPct(value)}
    </td>
  );
}

// ---------------------------------------------------------------------------
// Sortable indicator table (shared by Overview and Signals tabs)
// ---------------------------------------------------------------------------

const CATEGORY_GROUPS: { label: string; slugs: string[] }[] = [
  { label: "Energy",              slugs: ["brent_crude_usd", "wti_crude_usd", "natural_gas_usd"] },
  { label: "Metals",              slugs: ["gold_usd", "gold_gbp", "silver_usd", "silver_gbp", "copper_usd", "copper_gbp"] },
  { label: "Currencies",         slugs: ["dxy", "gbp_usd", "eur_usd", "gbp_eur", "usd_jpy"] },
  { label: "Government Bonds",   slugs: ["us_10yr_yield", "us_2yr_yield", "uk_10yr_yield", "de_10yr_yield", "jp_10yr_yield"] },
  { label: "Yield Curves (bps)", slugs: ["us_yield_spread", "uk_yield_curve", "de_yield_curve", "jp_yield_curve"] },
  { label: "Cross-Country Spreads (bps)", slugs: ["us_uk_spread", "us_de_spread", "us_jp_spread"] },
  { label: "Credit Spreads (bps)", slugs: [
    "us_corp_ig_spread", "global_corp_ig_spread",
    "us_hy_spread", "global_hy_spread",
    "em_usd_spread", "em_lc_spread",
  ]},
];

type SortCol = "name" | "value" | "signal" | "conf" | "macd" | "ema" | "dmi" | "adx" | "d1" | "w1" | "m1" | "m3" | "y1";
type SortDir = "asc" | "desc";

const CONF_RANK: Record<string, number>  = { high: 0, medium: 1, low: 2 };
const MACD_RANK: Record<string, number>  = { positive: 0, improving: 1, weakening: 2, negative: 3 };
const TREND_RANK: Record<string, number> = { up: 0, neutral: 1, down: 2 };

function sortRows(rows: MacroIndicatorRow[], col: SortCol, dir: SortDir): MacroIndicatorRow[] {
  const m = dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    switch (col) {
      case "name":   return m * (INDICATOR_LABELS[a.indicator] ?? a.indicator).localeCompare(INDICATOR_LABELS[b.indicator] ?? b.indicator);
      case "value":  return m * ((a.value ?? -Infinity) - (b.value ?? -Infinity));
      case "signal": return m * ((SIGNAL_STRENGTH_RANK[a.signal_label ?? ""] ?? 99) - (SIGNAL_STRENGTH_RANK[b.signal_label ?? ""] ?? 99));
      case "conf":   return m * ((CONF_RANK[a.signal_confidence ?? ""] ?? 99) - (CONF_RANK[b.signal_confidence ?? ""] ?? 99));
      case "macd":   return m * ((MACD_RANK[a.macd_state ?? ""] ?? 99) - (MACD_RANK[b.macd_state ?? ""] ?? 99));
      case "ema":    return m * ((TREND_RANK[a.ema_trend ?? ""] ?? 99) - (TREND_RANK[b.ema_trend ?? ""] ?? 99));
      case "dmi":    return m * ((TREND_RANK[a.dmi_trend ?? ""] ?? 99) - (TREND_RANK[b.dmi_trend ?? ""] ?? 99));
      case "adx":    return m * ((a.adx ?? -Infinity) - (b.adx ?? -Infinity));
      case "d1":     return m * ((a.change_pct ?? -Infinity) - (b.change_pct ?? -Infinity));
      case "w1":     return m * ((a.chg_5d ?? -Infinity) - (b.chg_5d ?? -Infinity));
      case "m1":     return m * ((a.chg_21d ?? -Infinity) - (b.chg_21d ?? -Infinity));
      case "m3":     return m * ((a.chg_63d ?? -Infinity) - (b.chg_63d ?? -Infinity));
      case "y1":     return m * ((a.chg_252d ?? -Infinity) - (b.chg_252d ?? -Infinity));
      default:       return 0;
    }
  });
}

function SortableIndicatorTable({ bySlug }: { bySlug: Map<string, MacroIndicatorRow> }) {
  const [expandedSlug, setExpandedSlug] = useState<string | null>(null);
  const [sortCol, setSortCol]           = useState<SortCol | null>(null);
  const [sortDir, setSortDir]           = useState<SortDir>("desc");

  function handleSort(col: SortCol) {
    if (sortCol === col) {
      if (sortDir === "desc") setSortDir("asc");
      else setSortCol(null); // third click resets to default order
    } else {
      setSortCol(col);
      setSortDir("desc");
    }
    setExpandedSlug(null);
  }

  const baseRows = SIGNALS_ORDER.flatMap((s) => { const r = bySlug.get(s); return r ? [r] : []; });

  type TableItem = { kind: "group"; label: string } | { kind: "row"; row: MacroIndicatorRow };
  const items: TableItem[] = [];
  if (!sortCol) {
    for (const g of CATEGORY_GROUPS) {
      items.push({ kind: "group", label: g.label });
      for (const slug of g.slugs) {
        const r = bySlug.get(slug);
        if (r) items.push({ kind: "row", row: r });
      }
    }
  } else {
    for (const row of sortRows(baseRows, sortCol, sortDir)) {
      items.push({ kind: "row", row });
    }
  }

  const thCls = "py-3 px-2 font-medium cursor-pointer select-none hover:text-gray-700 transition-colors whitespace-nowrap";

  function SortIcon({ col }: { col: SortCol }) {
    if (sortCol !== col) return <span className="text-gray-300 ml-0.5 text-[10px]">⇅</span>;
    return <span className="ml-0.5 text-[10px] text-gray-600">{sortDir === "desc" ? "↓" : "↑"}</span>;
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-100 text-xs text-gray-500 uppercase tracking-wide">
            <th className={`${thCls} text-left px-4`} onClick={() => handleSort("name")}>
              <span className="inline-flex items-center gap-0.5">Indicator<SortIcon col="name" /></span>
            </th>
            <th className={`${thCls} text-right`} onClick={() => handleSort("value")}>
              <span className="inline-flex items-center justify-end gap-0.5">Value<SortIcon col="value" /></span>
            </th>
            <th className={`${thCls} text-left`} onClick={() => handleSort("signal")}>
              <span className="inline-flex items-center gap-0.5">Signal<SortIcon col="signal" /></span>
            </th>
            <th className={`${thCls} text-center`} onClick={() => handleSort("conf")}>
              <span className="inline-flex items-center justify-center gap-0.5">Conf<SortIcon col="conf" /></span>
            </th>
            <th className={`${thCls} text-center`} onClick={() => handleSort("macd")}>
              <span className="inline-flex items-center justify-center gap-0.5">MACD<SortIcon col="macd" /></span>
            </th>
            <th className={`${thCls} text-center`} onClick={() => handleSort("ema")}>
              <span className="inline-flex items-center justify-center gap-0.5">EMA<SortIcon col="ema" /></span>
            </th>
            <th className={`${thCls} text-center`} onClick={() => handleSort("dmi")}>
              <span className="inline-flex items-center justify-center gap-0.5">DMI<SortIcon col="dmi" /></span>
            </th>
            <th className={`${thCls} text-right`} onClick={() => handleSort("adx")}>
              <span className="inline-flex items-center justify-end gap-0.5">ADX<SortIcon col="adx" /></span>
            </th>
            <th className={`${thCls} text-right text-gray-400`} onClick={() => handleSort("d1")}>
              <span className="inline-flex items-center justify-end gap-0.5">1D<SortIcon col="d1" /></span>
            </th>
            <th className={`${thCls} text-right text-gray-400`} onClick={() => handleSort("w1")}>
              <span className="inline-flex items-center justify-end gap-0.5">1W<SortIcon col="w1" /></span>
            </th>
            <th className={`${thCls} text-right text-gray-400`} onClick={() => handleSort("m1")}>
              <span className="inline-flex items-center justify-end gap-0.5">1M<SortIcon col="m1" /></span>
            </th>
            <th className={`${thCls} text-right text-gray-400`} onClick={() => handleSort("m3")}>
              <span className="inline-flex items-center justify-end gap-0.5">3M<SortIcon col="m3" /></span>
            </th>
            <th className={`${thCls} text-right text-gray-400 px-4`} onClick={() => handleSort("y1")}>
              <span className="inline-flex items-center justify-end gap-0.5">1Y<SortIcon col="y1" /></span>
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-50">
          {items.map((item) => {
            if (item.kind === "group") {
              return (
                <tr key={`group-${item.label}`} className="bg-gray-50 border-t border-gray-100">
                  <td colSpan={13} className="py-1.5 px-4 text-xs font-semibold text-gray-400 uppercase tracking-widest">
                    {item.label}
                  </td>
                </tr>
              );
            }
            const row = item.row;
            const isExpanded = expandedSlug === row.indicator;
            return (
              <Fragment key={row.indicator}>
                <tr
                  onClick={() => setExpandedSlug(isExpanded ? null : row.indicator)}
                  className={`cursor-pointer transition-colors ${isExpanded ? "bg-gray-50" : "hover:bg-gray-50"}`}
                >
                  <td className="py-2.5 px-4 font-medium text-gray-800 whitespace-nowrap">
                    <span className="inline-flex items-center gap-1.5">
                      {isExpanded
                        ? <ChevronDown className="w-3 h-3 text-gray-400 shrink-0" />
                        : <ChevronRight className="w-3 h-3 text-gray-300 shrink-0" />}
                      {INDICATOR_LABELS[row.indicator] ?? row.indicator}
                    </span>
                  </td>
                  <td className="py-2.5 px-3 text-right tabular-nums text-gray-700 whitespace-nowrap">
                    {fmtDisplayValue(row.value, row.indicator)}
                    {getDisplayUnit(row.indicator, row.currency) && (
                      <span className="text-gray-400 text-xs ml-1">{getDisplayUnit(row.indicator, row.currency)}</span>
                    )}
                  </td>
                  <td className="py-2.5 px-3"><SignalBadge label={row.signal_label} /></td>
                  <td className="py-2.5 px-2 text-center"><ConfidenceDot confidence={row.signal_confidence} /></td>
                  <td className="py-2.5 px-2 text-center"><MACDBadge state={row.macd_state} /></td>
                  <td className="py-2.5 px-2 text-center"><TrendBadge value={row.ema_trend} /></td>
                  <td className="py-2.5 px-2 text-center"><TrendBadge value={row.dmi_trend} /></td>
                  <td className="py-2.5 px-2 text-right tabular-nums text-xs text-gray-500">
                    {row.adx !== null ? row.adx.toFixed(1) : "—"}
                  </td>
                  <ReturnCell value={row.change_pct} indicator={row.indicator} currentValue={row.value} />
                  <ReturnCell value={row.chg_5d} indicator={row.indicator} currentValue={row.value} />
                  <ReturnCell value={row.chg_21d} indicator={row.indicator} currentValue={row.value} />
                  <ReturnCell value={row.chg_63d} indicator={row.indicator} currentValue={row.value} />
                  <td className={`py-2.5 px-4 text-right tabular-nums text-xs font-medium ${pctColour(row.chg_252d)}`}>
                    {fmtChg(row.chg_252d, row.indicator, row.value)}
                  </td>
                </tr>
                {isExpanded && (
                  <tr>
                    <td colSpan={13} className="p-0">
                      <SignalDrillDown row={row} />
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function SignalsTab({ bySlug }: { bySlug: Map<string, MacroIndicatorRow> }) {
  return <SortableIndicatorTable bySlug={bySlug} />;
}

// ---------------------------------------------------------------------------
// Tab 3: Yield Curves
// ---------------------------------------------------------------------------

function YieldLevelCard({ row, title }: { row: MacroIndicatorRow | undefined; title?: string }) {
  if (!row) return null;
  const label = title ?? INDICATOR_LABELS[row.indicator] ?? row.indicator;
  const chg = row.change_pct;
  const isPos = chg !== null && chg > 0;
  const isNeg = chg !== null && chg < 0;
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm flex flex-col gap-2">
      <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">{label}</p>
      <div className="flex items-baseline gap-1">
        <span className="text-2xl font-semibold text-gray-900 tabular-nums">
          {fmtValue(row.value, row.indicator)}
        </span>
        {row.currency && <span className="text-xs text-gray-400">{row.currency}</span>}
      </div>
      <div className={`flex items-center gap-1 text-sm font-medium ${pctColour(chg)}`}>
        {isPos && <TrendingUp className="w-4 h-4 shrink-0" />}
        {isNeg && <TrendingDown className="w-4 h-4 shrink-0" />}
        {!isPos && !isNeg && <Minus className="w-4 h-4 shrink-0" />}
        <span>{fmtChg(chg, row.indicator, row.value)}</span>
      </div>
    </div>
  );
}

function curveStatus(value: number | null): { label: string; colour: string } {
  if (value === null) return { label: "No data", colour: "bg-gray-100 text-gray-500" };
  if (value > 0.1) return { label: "Normal", colour: "bg-green-100 text-green-700" };
  if (value >= -0.1) return { label: "Flat", colour: "bg-amber-100 text-amber-700" };
  return { label: "Inverted", colour: "bg-red-100 text-red-700" };
}

// Find the closest historical value at or before a target date (daysAgo calendar days)
function findHistoricalValue(
  rows: CurveHistoryRow[],
  indicator: string,
  daysAgo: number
): number | null {
  const targetDate = new Date(Date.now() - daysAgo * 86400_000).toISOString().slice(0, 10);
  const relevant = rows.filter((r) => r.indicator === indicator && r.date <= targetDate);
  if (relevant.length === 0) return null;
  return relevant[relevant.length - 1].value; // already sorted asc
}

type CurveCardProps = {
  country: string;
  spreadRow: MacroIndicatorRow | undefined;
  longRow: MacroIndicatorRow | undefined;
  shortRow: MacroIndicatorRow | undefined;
  shortLabel: string;
  historyRows: CurveHistoryRow[];
};

function CurveCard({ country, spreadRow, longRow, shortRow, shortLabel, historyRows }: CurveCardProps) {
  const val = spreadRow?.value ?? null;
  const status = curveStatus(val);
  const slug = spreadRow?.indicator ?? "";

  // Show bps change vs today: (current − historical spread) × 100
  const snapshots = [
    { label: "1M", days: 30 },
    { label: "3M", days: 91 },
    { label: "6M", days: 182 },
    { label: "1Y", days: 365 },
  ].map(({ label, days }) => {
    const hist = findHistoricalValue(historyRows, slug, days);
    const bps = hist !== null && val !== null ? Math.round((val - hist) * 100) : null;
    return { label, bps };
  });

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-gray-800">{country}</p>
        <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${status.colour}`}>
          {status.label}
        </span>
      </div>

      <div className={`text-3xl font-bold tabular-nums ${val !== null && val > 0 ? "text-green-600" : val !== null && val < 0 ? "text-red-600" : "text-gray-400"}`}>
        {val !== null ? (val >= 0 ? "+" : "") + val.toFixed(2) : "—"}
        <span className="text-sm font-normal text-gray-400 ml-1">%pts</span>
      </div>

      <div className="text-xs text-gray-400 flex flex-col gap-0.5">
        <span>10yr: {longRow?.value !== null && longRow?.value !== undefined ? longRow.value.toFixed(2) + "%" : "—"}</span>
        <span>{shortLabel}: {shortRow?.value !== null && shortRow?.value !== undefined ? shortRow.value.toFixed(2) + "%" : "—"}</span>
      </div>

      {/* Historical snapshots */}
      <div className="border-t border-gray-100 pt-2">
        <div className="grid grid-cols-4 gap-1 text-center">
          {snapshots.map(({ label, bps }) => (
            <div key={label}>
              <p className="text-xs text-gray-400">{label}</p>
              <p className={`text-xs font-semibold tabular-nums ${bps !== null && bps > 0 ? "text-green-600" : bps !== null && bps < 0 ? "text-red-500" : "text-gray-400"}`}>
                {bps !== null ? `${bps >= 0 ? "+" : ""}${bps}bps` : "—"}
              </p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function CrossSpreadCard({ row, historyRows }: { row: MacroIndicatorRow | undefined; historyRows: CurveHistoryRow[] }) {
  if (!row) return null;
  const val = row.value;
  const label = INDICATOR_LABELS[row.indicator] ?? row.indicator;

  // Show bps change vs N days ago (current - historical) * 100
  function bpsMove(daysAgo: number): string {
    if (val === null) return "—";
    const hist = findHistoricalValue(historyRows, row!.indicator, daysAgo);
    if (hist === null) return "—";
    const bps = Math.round((val - hist) * 100);
    return `${bps >= 0 ? "+" : ""}${bps}bps`;
  }

  const move1m = bpsMove(30);
  const move3m = bpsMove(91);

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm flex flex-col gap-2">
      <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">{label}</p>
      <div className={`text-2xl font-bold tabular-nums ${val !== null && val > 0 ? "text-green-600" : val !== null && val < 0 ? "text-red-600" : "text-gray-400"}`}>
        {val !== null ? (val >= 0 ? "+" : "") + val.toFixed(2) : "—"}
        <span className="text-xs font-normal text-gray-400 ml-1">%pts</span>
      </div>
      <div className={`text-sm font-medium ${pctColour(row.change_pct)}`}>{fmtChg(row.change_pct, row.indicator, row.value)} 1D</div>
      <div className="flex gap-3 text-xs text-gray-500">
        <span className={move1m.startsWith("+") ? "text-green-600 font-medium" : move1m.startsWith("-") ? "text-red-600 font-medium" : "text-gray-400"}>{move1m} 1M</span>
        <span className={move3m.startsWith("+") ? "text-green-600 font-medium" : move3m.startsWith("-") ? "text-red-600 font-medium" : "text-gray-400"}>{move3m} 3M</span>
      </div>
      {row.signal_label && <SignalBadge label={row.signal_label} />}
    </div>
  );
}

function YieldCurvesTab({ bySlug, curveHistory, spreadHistory }: { bySlug: Map<string, MacroIndicatorRow>; curveHistory: CurveHistoryRow[]; spreadHistory: CurveHistoryRow[] }) {
  return (
    <div className="flex flex-col gap-8">

      <section>
        <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-3">
          Government Bond Yields
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          <YieldLevelCard row={bySlug.get("us_10yr_yield")} />
          <YieldLevelCard row={bySlug.get("us_2yr_yield")} />
          <YieldLevelCard row={bySlug.get("uk_10yr_yield")} />
          <YieldLevelCard row={bySlug.get("de_10yr_yield")} />
          <YieldLevelCard row={bySlug.get("jp_10yr_yield")} />
        </div>
      </section>

      <section>
        <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-3">
          Global Curve Shapes (10yr − 3M)
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <CurveCard country="United States" spreadRow={bySlug.get("us_yield_spread")} longRow={bySlug.get("us_10yr_yield")} shortRow={bySlug.get("us_3m_rate")} shortLabel="3M T-Bill" historyRows={curveHistory} />
          <CurveCard country="United Kingdom" spreadRow={bySlug.get("uk_yield_curve")} longRow={bySlug.get("uk_10yr_yield")} shortRow={bySlug.get("uk_3m_rate")} shortLabel="3M" historyRows={curveHistory} />
          <CurveCard country="Germany" spreadRow={bySlug.get("de_yield_curve")} longRow={bySlug.get("de_10yr_yield")} shortRow={bySlug.get("de_3m_rate")} shortLabel="3M" historyRows={curveHistory} />
          <CurveCard country="Japan" spreadRow={bySlug.get("jp_yield_curve")} longRow={bySlug.get("jp_10yr_yield")} shortRow={bySlug.get("jp_3m_rate")} shortLabel="3M" historyRows={curveHistory} />
        </div>
        <p className="text-xs text-gray-400 mt-2">
          Positive = normal curve · Near zero = flat · Negative = inverted (historically precedes slowdowns)
          · History shows the spread at 1M / 3M / 6M / 1Y ago
          · All four countries use 10yr govt bond vs 3M rate — same methodology as the NY Fed recession model
          · US uses daily T-bill (DGS3MO); UK/DE/JP use monthly interbank rates (slight lag)
        </p>
      </section>

      <section>
        <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-3">
          Cross-Country Differentials (US 10yr minus foreign 10yr)
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <CrossSpreadCard row={bySlug.get("us_uk_spread")} historyRows={spreadHistory} />
          <CrossSpreadCard row={bySlug.get("us_de_spread")} historyRows={spreadHistory} />
          <CrossSpreadCard row={bySlug.get("us_jp_spread")} historyRows={spreadHistory} />
        </div>
        <p className="text-xs text-gray-400 mt-2">
          Positive = US yields higher than foreign · Wider spread tends to strengthen USD vs that currency
        </p>
      </section>

    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab 4: Relationships & Volatility
// ---------------------------------------------------------------------------

function vixBand(v: number | null): { label: string; colour: string } {
  if (v === null) return { label: "No data", colour: "text-gray-400" };
  if (v >= 30) return { label: "Fear", colour: "text-red-600" };
  if (v >= 20) return { label: "Elevated", colour: "text-amber-600" };
  if (v >= 15) return { label: "Normal", colour: "text-gray-600" };
  return { label: "Calm", colour: "text-green-600" };
}

const EXPECTED_DIRECTION: Record<string, { label: string; positive: boolean; rationale: string }> = {
  gold_dxy: { label: "Inverse", positive: false, rationale: "Gold priced in USD — dollar strength tends to push gold lower" },
  gbpusd_us_uk_spread: { label: "Inverse", positive: false, rationale: "Wider US-UK spread = stronger USD = weaker GBP/USD" },
  eurusd_us_de_spread: { label: "Inverse", positive: false, rationale: "Wider US-DE spread = stronger USD = weaker EUR/USD" },
  usdjpy_us_jp_spread: { label: "Positive", positive: true, rationale: "Wider US-JP spread = stronger USD = higher USD/JPY" },
};

function corStatus(cor90: number | null, cor30: number | null, expectedPositive: boolean): { label: string; colour: string } {
  if (cor90 === null) return { label: "No data", colour: "bg-gray-100 text-gray-500" };
  const signMatch = expectedPositive ? cor90 > 0 : cor90 < 0;
  if (!signMatch || (!isStrongEnough(cor90) && cor30 !== null && !isStrongEnough(cor30)))
    return { label: "Breaking Down", colour: "bg-amber-100 text-amber-700" };
  return { label: "Holding", colour: "bg-gray-100 text-gray-600" };
}

function isStrongEnough(cor: number): boolean { return Math.abs(cor) >= 0.2; }

function intramarketRegime(cor: number | null): { label: string; colour: string } {
  if (cor === null) return { label: "No data", colour: "text-gray-400" };
  if (cor >= 0.7) return { label: "High Regime", colour: "text-red-600" };
  if (cor >= 0.5) return { label: "Elevated", colour: "text-amber-600" };
  if (cor >= 0.3) return { label: "Moderate", colour: "text-gray-600" };
  return { label: "Dispersed", colour: "text-green-600" };
}

function interpretIntramarketCorrelation(cor: number | null): string {
  if (cor === null) return "Insufficient data";
  if (cor >= 0.7) return "High correlation regime — macro factors dominating";
  if (cor >= 0.5) return "Elevated correlation — macro still influential";
  if (cor >= 0.3) return "Moderate correlation — mixed drivers";
  return "Low correlation — stock-pickers' market";
}

function corColour(cor: number | null): string {
  if (cor === null) return "text-gray-400";
  const abs = Math.abs(cor);
  if (abs >= 0.7) return cor > 0 ? "text-green-600" : "text-red-600";
  if (abs >= 0.4) return cor > 0 ? "text-green-500" : "text-red-500";
  return "text-gray-500";
}

function interpretCorrelation(cor: number | null): string {
  if (cor === null) return "Insufficient data";
  const abs = Math.abs(cor);
  const direction = cor > 0 ? "moving together" : "moving inversely";
  if (abs >= 0.7) return `Strongly ${direction}`;
  if (abs >= 0.4) return `Moderately ${direction}`;
  if (abs >= 0.2) return `Weakly ${direction}`;
  return "No clear relationship";
}

function RelationshipCard({ row }: { row: MacroCorrelationRow }) {
  const exp = EXPECTED_DIRECTION[row.pair];
  const status = exp ? corStatus(row.cor_90d, row.cor_30d, exp.positive) : null;
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm flex flex-col gap-3">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-semibold text-gray-800">{row.label ?? row.pair}</p>
        {status && (
          <span className={`text-xs font-medium px-2 py-0.5 rounded-full shrink-0 ${status.colour}`}>
            {status.label}
          </span>
        )}
      </div>
      {exp && (
        <p className="text-xs text-gray-400">
          Expected: <span className="font-medium text-gray-600">{exp.label}</span> · {exp.rationale}
        </p>
      )}
      <div className="flex gap-4">
        <div>
          <p className="text-xs text-gray-400 mb-0.5">30-day</p>
          <p className={`text-xl font-bold tabular-nums ${corColour(row.cor_30d)}`}>
            {row.cor_30d !== null ? (row.cor_30d >= 0 ? "+" : "") + row.cor_30d.toFixed(3) : "—"}
          </p>
        </div>
        <div className="w-px bg-gray-100" />
        <div>
          <p className="text-xs text-gray-400 mb-0.5">90-day</p>
          <p className={`text-xl font-bold tabular-nums ${corColour(row.cor_90d)}`}>
            {row.cor_90d !== null ? (row.cor_90d >= 0 ? "+" : "") + row.cor_90d.toFixed(3) : "—"}
          </p>
        </div>
      </div>
      <p className="text-xs text-gray-500">{interpretCorrelation(row.cor_90d)}</p>
    </div>
  );
}

function RelationshipsTab({ vixRow, correlations }: { vixRow: MacroIndicatorRow | undefined; correlations: MacroCorrelationRow[] }) {
  const vixBandInfo = vixBand(vixRow?.value ?? null);
  const intramarketRow = correlations.find((r) => r.pair === "sp500_intramarket") ?? null;
  const pairCorrelations = correlations.filter((r) => r.pair !== "sp500_intramarket");
  const regime = intramarketRegime(intramarketRow?.cor_90d ?? null);

  return (
    <div className="flex flex-col gap-8">
      <section>
        <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-3">Volatility Gauges</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-gray-800">VIX — Equity Fear Gauge</p>
              <span className={`text-sm font-bold ${vixBandInfo.colour}`}>{vixBandInfo.label}</span>
            </div>
            <p className={`text-4xl font-bold tabular-nums ${vixBandInfo.colour}`}>
              {vixRow?.value !== null && vixRow?.value !== undefined ? vixRow.value.toFixed(2) : "—"}
            </p>
            <div className="flex gap-3 text-xs flex-wrap">
              <span className="text-green-600 font-medium">&lt;15 Calm</span>
              <span className="text-gray-500 font-medium">15–20 Normal</span>
              <span className="text-amber-600 font-medium">20–30 Elevated</span>
              <span className="text-red-600 font-medium">30+ Fear</span>
            </div>
            <p className={`text-sm font-medium ${pctColour(vixRow?.change_pct ?? null)}`}>
              {fmtPct(vixRow?.change_pct ?? null)} today
            </p>
          </div>
          <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-gray-800">S&P Intra-Market Correlation</p>
              <span className={`text-sm font-bold ${regime.colour}`}>{regime.label}</span>
            </div>
            <p className={`text-4xl font-bold tabular-nums ${corColour(intramarketRow?.cor_90d ?? null)}`}>
              {intramarketRow?.cor_90d !== null && intramarketRow?.cor_90d !== undefined
                ? (intramarketRow.cor_90d >= 0 ? "+" : "") + intramarketRow.cor_90d.toFixed(3)
                : "—"}
            </p>
            <div className="flex gap-4">
              <div>
                <p className="text-xs text-gray-400 mb-0.5">30-day avg</p>
                <p className={`text-lg font-bold tabular-nums ${corColour(intramarketRow?.cor_30d ?? null)}`}>
                  {intramarketRow?.cor_30d !== null && intramarketRow?.cor_30d !== undefined
                    ? (intramarketRow.cor_30d >= 0 ? "+" : "") + intramarketRow.cor_30d.toFixed(3)
                    : "—"}
                </p>
              </div>
              <div>
                <p className="text-xs text-gray-400 mb-0.5">90-day avg</p>
                <p className={`text-lg font-bold tabular-nums ${corColour(intramarketRow?.cor_90d ?? null)}`}>
                  {intramarketRow?.cor_90d !== null && intramarketRow?.cor_90d !== undefined
                    ? (intramarketRow.cor_90d >= 0 ? "+" : "") + intramarketRow.cor_90d.toFixed(3)
                    : "—"}
                </p>
              </div>
            </div>
            <div className="flex gap-3 text-xs flex-wrap">
              <span className="text-green-600 font-medium">&lt;0.3 Dispersed</span>
              <span className="text-gray-500 font-medium">0.3–0.5 Moderate</span>
              <span className="text-amber-600 font-medium">0.5–0.7 Elevated</span>
              <span className="text-red-600 font-medium">0.7+ High Regime</span>
            </div>
            <p className="text-xs text-gray-500">{interpretIntramarketCorrelation(intramarketRow?.cor_90d ?? null)}</p>
          </div>
        </div>
      </section>

      <section>
        <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-1">Macro Relationships</h2>
        <p className="text-xs text-gray-400 mb-3">
          Pearson correlation (−1 to +1) over 30- and 90-day windows. "Holding" = relationship matches theory.
          "Breaking Down" = diverging — watch for regime shifts.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {pairCorrelations.map((row) => <RelationshipCard key={row.pair} row={row} />)}
        </div>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main: tab container
// ---------------------------------------------------------------------------

const TABS = [
  { key: "overview",      label: "Overview" },
  { key: "signals",       label: "Signals" },
  { key: "yield_curves",  label: "Yield Curves" },
  { key: "relationships", label: "Relationships" },
] as const;

type TabKey = typeof TABS[number]["key"];

type Props = {
  indicators: MacroIndicatorRow[];
  correlations: MacroCorrelationRow[];
  curveHistory: CurveHistoryRow[];
  spreadHistory: CurveHistoryRow[];
  sp500Rows: SP500CompanyRow[];
  europeRows: EuropeanCompanyRow[];
};

type Section = "macro" | "sp500" | "europe";

const SECTIONS: { key: Section; label: string }[] = [
  { key: "macro", label: "Macro" },
  { key: "sp500", label: "S&P 500" },
  { key: "europe", label: "European" },
];

export function DashboardTabs({ indicators, correlations, curveHistory, spreadHistory, sp500Rows, europeRows }: Props) {
  const [section, setSection] = useState<Section>("macro");
  const [active, setActive] = useState<TabKey>("overview");

  const bySlug = new Map<string, MacroIndicatorRow>();
  for (const row of indicators) bySlug.set(row.indicator, row);

  // Inject S&P intra-market correlation as a synthetic indicator row
  const imCorr = correlations.find((r) => r.pair === "sp500_intramarket");
  let allIndicators = indicators;
  if (imCorr?.cor_90d != null) {
    const imRow: MacroIndicatorRow = {
      id: -1,
      indicator: "sp500_intramarket",
      value: imCorr.cor_90d,
      previous_value: imCorr.cor_30d,
      change_pct: null,
      currency: null,
      last_updated: imCorr.last_updated,
      source: "computed",
      ma_20: null, ma_50: null, ma_200: null,
      rsi_14: null, macd_line: null, macd_signal: null, macd_hist: null,
      macd_state: null, ema_trend: null, adx: null, dmi_trend: null,
      signal_label: interpretIntramarketCorrelation(imCorr.cor_90d),
      signal_confidence: imCorr.cor_90d >= 0.7 || imCorr.cor_90d < 0.3 ? "high" : "medium",
      chg_5d: null, chg_21d: null, chg_63d: null, chg_252d: null,
    };
    bySlug.set("sp500_intramarket", imRow);
    allIndicators = [...indicators, imRow];
  }

  return (
    <div className="flex flex-col gap-6">
      {/* ── Top-level section switcher ── */}
      <div className="flex gap-2 border-b border-gray-300 pb-0">
        {SECTIONS.map((s) => (
          <button
            key={s.key}
            onClick={() => setSection(s.key)}
            className={`px-5 py-2 text-sm font-semibold border-b-2 transition-colors -mb-px ${
              section === s.key
                ? "border-gray-900 text-gray-900"
                : "border-transparent text-gray-400 hover:text-gray-700"
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>

      {/* ── Macro section ── */}
      {section === "macro" && (
        <div className="flex flex-col gap-6">
          <div className="border-b border-gray-200">
            <nav className="flex gap-1 -mb-px">
              {TABS.map((tab) => (
                <button
                  key={tab.key}
                  onClick={() => setActive(tab.key)}
                  className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                    active === tab.key
                      ? "border-gray-900 text-gray-900"
                      : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </nav>
          </div>

          <p className="text-xs text-gray-400 -mt-4">All prices are end-of-day. Data updates when sync is run manually.</p>

          {active === "overview" && <OverviewTab indicators={allIndicators} />}
          {active === "signals" && <SignalsTab bySlug={bySlug} />}
          {active === "yield_curves" && <YieldCurvesTab bySlug={bySlug} curveHistory={curveHistory} spreadHistory={spreadHistory} />}
          {active === "relationships" && (
            <RelationshipsTab vixRow={bySlug.get("vix")} correlations={correlations} />
          )}
        </div>
      )}

      {/* ── S&P 500 section ── */}
      {section === "sp500" && (
        sp500Rows.length === 0 ? (
          <div className="rounded-lg border border-dashed border-gray-200 p-12 text-center text-sm text-gray-500">
            No S&amp;P 500 data available. Check the database connection.
          </div>
        ) : (
          <SP500Section rows={sp500Rows} />
        )
      )}

      {/* ── European section ── */}
      {section === "europe" && (
        europeRows.length === 0 ? (
          <div className="rounded-lg border border-dashed border-gray-200 p-12 text-center text-sm text-gray-500">
            No European data available. Check the database connection.
          </div>
        ) : (
          <EuropeSection rows={europeRows} />
        )
      )}
    </div>
  );
}

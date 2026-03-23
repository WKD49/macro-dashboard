"use client";

import { useState, useMemo } from "react";
import { AIAssistant } from "@/components/reporting/AIAssistant";
import { SignalsTable } from "@/components/reporting/SignalsTable";
import type { EuropeanCompanyRow } from "@/lib/europe/types";
import { startOfWeek, endOfWeek, isWithinWeek, isWithinNextWeek } from "@/lib/europe/eurofirst";

// ── Formatting helpers ──────────────────────────────────────────────────────

function returnColour(x: unknown): string {
  const n = typeof x === "number" ? x : Number(x);
  if (!Number.isFinite(n)) return "";
  return n > 0 ? "text-green-600" : n < 0 ? "text-red-600" : "";
}

function peColour(x: unknown): string {
  const n = typeof x === "number" ? x : Number(x);
  if (!Number.isFinite(n) || n <= 0) return "";
  if (n < 15) return "text-green-600";
  if (n <= 25) return "text-amber-600";
  return "text-red-600";
}

function pegColour(x: unknown): string {
  const n = typeof x === "number" ? x : Number(x);
  if (!Number.isFinite(n) || n <= 0) return "";
  if (n < 1) return "text-green-600";
  if (n <= 2) return "text-amber-600";
  return "text-red-600";
}

function fmtPct(x: unknown) {
  if (x === null || x === undefined || x === "") return "—";
  const n = typeof x === "number" ? x : Number(x);
  if (!Number.isFinite(n)) return "—";
  return `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
}

function fmtW(x: unknown) {
  if (x === null || x === undefined || x === "") return "—";
  const n = typeof x === "number" ? x : Number(x);
  if (!Number.isFinite(n)) return "—";
  return `${(n * 100).toFixed(2)}%`;
}

function fmtNum(x: unknown, dp = 2) {
  if (x === null || x === undefined || x === "") return "—";
  const n = typeof x === "number" ? x : Number(x);
  if (!Number.isFinite(n)) return "—";
  return n.toFixed(dp);
}

function fmtPrice(x: unknown) {
  if (x === null || x === undefined || x === "") return "—";
  const n = typeof x === "number" ? x : Number(x);
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtUKDate(d: Date) {
  return `${String(d.getDate()).padStart(2, "0")}-${String(d.getMonth() + 1).padStart(2, "0")}-${d.getFullYear()}`;
}

function iso(d: Date) {
  return d.toISOString().slice(0, 10);
}

function inRange(d: string | null, a: Date, b: Date) {
  if (!d) return false;
  const x = new Date(d);
  return x >= a && x <= b;
}

function avg(nums: number[]): number | null {
  if (nums.length === 0) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

// ── Signal UI helpers ────────────────────────────────────────────────────────

const SIGNAL_STYLES: Record<string, string> = {
  "Strong Bullish Trend":          "bg-green-100 text-green-800 border-green-200",
  "Bullish Momentum Increasing":   "bg-emerald-100 text-emerald-800 border-emerald-200",
  "Bullish Trend Losing Momentum": "bg-amber-100 text-amber-800 border-amber-200",
  "Uptrend Under Pressure":        "bg-amber-100 text-amber-800 border-amber-200",
  "Counter-Trend Rally":           "bg-orange-100 text-orange-800 border-orange-200",
  "Bearish Momentum Weakening":    "bg-orange-100 text-orange-800 border-orange-200",
  "Bearish Trend Losing Momentum": "bg-red-100 text-red-800 border-red-200",
  "Strong Bearish Trend":          "bg-red-100 text-red-800 border-red-200",
  "Mixed Signals":                 "bg-gray-100 text-gray-600 border-gray-200",
  "Sideways / Choppy":             "bg-gray-100 text-gray-600 border-gray-200",
};

function SignalBadge({ label }: { label: string | null | undefined }) {
  if (!label) return null;
  const style = SIGNAL_STYLES[label] ?? "bg-gray-100 text-gray-600 border-gray-200";
  return <span className={`inline-flex rounded border px-2 py-0.5 text-xs font-medium ${style}`}>{label}</span>;
}

function ConfidenceDot({ level }: { level: string | null | undefined }) {
  if (!level) return null;
  const colours = { high: "bg-green-500", medium: "bg-amber-400", low: "bg-gray-300" };
  const colour = colours[level as keyof typeof colours] ?? "bg-gray-300";
  return (
    <span className="inline-flex items-center gap-1 text-xs text-gray-600">
      <span className={`inline-block h-2 w-2 rounded-full ${colour}`} />
      {level.charAt(0).toUpperCase() + level.slice(1)} confidence
    </span>
  );
}

function InfoTip({ text }: { text: string }) {
  return (
    <span className="group relative ml-1 inline-block cursor-help">
      <span className="text-xs text-gray-400 group-hover:text-gray-600">ⓘ</span>
      <span className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-1 w-52 -translate-x-1/2 rounded bg-gray-800 px-2 py-1.5 text-xs leading-snug text-white opacity-0 transition-opacity group-hover:opacity-100 whitespace-normal">
        {text}
      </span>
    </span>
  );
}

function DimBadge({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  const colours: Record<string, string> = {
    up: "bg-green-50 text-green-700", down: "bg-red-50 text-red-700", neutral: "bg-gray-50 text-gray-500",
    positive: "bg-green-50 text-green-700", improving: "bg-emerald-50 text-emerald-700",
    weakening: "bg-amber-50 text-amber-700", negative: "bg-red-50 text-red-700",
  };
  const cls = colours[value] ?? "bg-gray-50 text-gray-500";
  return <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${cls}`}>{label}: {value}</span>;
}

// ── Table components ─────────────────────────────────────────────────────────

function TradeCard({ r, rank }: { r: EuropeanCompanyRow; rank: number }) {
  const changedAgo = r.signal_changed_at
    ? Math.round((Date.now() - new Date(r.signal_changed_at).getTime()) / 86_400_000)
    : null;
  const earningsWarning = r.days_to_earnings != null && r.days_to_earnings >= 0 && r.days_to_earnings <= 10;

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-gray-400">#{rank}</span>
            <a href={`https://finance.yahoo.com/chart/${r.symbol}`} target="_blank" rel="noopener noreferrer"
               className="font-mono text-sm font-semibold text-blue-700 hover:underline">{r.symbol}</a>
            <span className="text-sm text-gray-600">{r.name}</span>
          </div>
          <div className="mt-0.5 text-xs text-gray-500">{r.country ?? "—"} · {r.sector ?? "—"}</div>
        </div>
        {earningsWarning && (
          <span className="shrink-0 rounded border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs text-amber-700">
            ⚠ {r.days_to_earnings}d to earnings
          </span>
        )}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <SignalBadge label={r.signal_label} />
        <ConfidenceDot level={r.signal_confidence} />
      </div>
      <div className="mt-2 flex flex-wrap gap-1">
        <DimBadge label="MACD" value={r.macd_state} />
        <DimBadge label="EMA" value={r.ema_trend} />
        <DimBadge label="DMI" value={r.dmi_trend} />
        {r.adx != null && <span className="rounded px-1.5 py-0.5 text-xs text-gray-500 bg-gray-50">ADX {r.adx.toFixed(0)}</span>}
      </div>
      <div className="mt-4 grid grid-cols-3 gap-3 border-t pt-3">
        <div>
          <div className="text-xs text-gray-500">Entry</div>
          <div className="mt-0.5 font-mono text-sm font-semibold text-gray-900">{r.entry_level != null ? fmtPrice(r.entry_level) : "—"}</div>
        </div>
        <div>
          <div className="text-xs text-gray-500">Stop</div>
          <div className="mt-0.5 font-mono text-sm font-semibold text-red-600">{r.stop_level != null ? fmtPrice(r.stop_level) : "—"}</div>
        </div>
        <div>
          <div className="text-xs text-gray-500">R/R</div>
          <div className={`mt-0.5 font-mono text-sm font-semibold ${(r.risk_reward ?? 0) >= 2 ? "text-green-700" : "text-gray-700"}`}>
            {r.risk_reward != null ? `${r.risk_reward.toFixed(1)}:1` : "—"}
          </div>
        </div>
      </div>
      <div className="mt-3 flex items-center justify-between text-xs text-gray-500">
        <span>5D <span className={returnColour(r.return_5d)}>{fmtPct(r.return_5d)}</span> · 30D <span className={returnColour(r.return_30d)}>{fmtPct(r.return_30d)}</span></span>
        {r.mom_rank_pct != null && <span>Momentum rank: top {100 - r.mom_rank_pct}%</span>}
        {changedAgo != null && <span className="text-gray-400">Signal: {changedAgo === 0 ? "today" : `${changedAgo}d ago`}</span>}
      </div>
    </div>
  );
}

function WatchRow({ r }: { r: EuropeanCompanyRow }) {
  const bars = r.macd_improving_bars ?? 0;
  return (
    <div className="flex items-center justify-between border-t py-2 text-sm">
      <div className="flex items-center gap-3">
        <span className="font-mono text-xs text-gray-500 w-6">{bars}/3</span>
        <div>
          <span className="font-medium text-gray-900">{r.name}</span>
          <span className="ml-2 font-mono text-xs text-gray-400">{r.symbol}</span>
        </div>
        <span className="text-xs text-gray-500">{r.country ?? "—"} · {r.sector ?? "—"}</span>
      </div>
      <div className="flex items-center gap-3">
        <span className="rounded border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs text-amber-700">
          Watch — {bars === 1 ? "forming" : "near confirm"}
        </span>
        <span className={`text-xs tabular-nums ${returnColour(r.return_5d)}`}>{fmtPct(r.return_5d)}</span>
      </div>
    </div>
  );
}

function DataTable({ title, rows, highlightSymbols }: { title: string; rows: EuropeanCompanyRow[]; highlightSymbols?: Set<string> }) {
  return (
    <div className="rounded-lg border bg-white p-4">
      <div className="flex items-baseline justify-between">
        <h2 className="text-base font-semibold">{title}</h2>
        <div className="text-xs text-gray-500">to last close</div>
      </div>
      <div className="mt-3 overflow-auto rounded border">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50">
            <tr className="text-left">
              <th className="px-3 py-2">Symbol</th>
              <th className="px-3 py-2">Company</th>
              <th className="px-3 py-2">Country</th>
              <th className="px-3 py-2 text-right">Weight</th>
              <th className="px-3 py-2 text-right">5D</th>
              <th className="px-3 py-2 text-right">30D</th>
              <th className="px-3 py-2 text-right">vs 200d</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.symbol} className="border-t">
                <td className="px-3 py-2 font-mono">{r.symbol}</td>
                <td className={"px-3 py-2 " + (highlightSymbols?.has(r.symbol) ? "font-semibold" : "")}>{r.name}</td>
                <td className="px-3 py-2 text-gray-600">{r.country ?? "—"}</td>
                <td className="px-3 py-2 text-right tabular-nums">{fmtW(r.index_weight)}</td>
                <td className={"px-3 py-2 text-right tabular-nums " + returnColour(r.return_5d)}>{fmtPct(r.return_5d)}</td>
                <td className={"px-3 py-2 text-right tabular-nums " + returnColour(r.return_30d)}>{fmtPct(r.return_30d)}</td>
                <td className={"px-3 py-2 text-right tabular-nums " + returnColour(r.price_vs_200d)}>{fmtPct(r.price_vs_200d)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function MoversTable({ title, rows, highlightSymbols }: { title: string; rows: EuropeanCompanyRow[]; highlightSymbols: Set<string> }) {
  return (
    <div className="rounded-lg border bg-white p-4">
      <div className="flex items-baseline justify-between">
        <h2 className="text-base font-semibold">{title}</h2>
        <div className="text-xs text-gray-500">to last close</div>
      </div>
      <div className="mt-3 overflow-auto rounded border">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50">
            <tr className="text-left">
              <th className="px-3 py-2">Symbol</th>
              <th className="px-3 py-2">Company</th>
              <th className="px-3 py-2">Country</th>
              <th className="px-3 py-2 text-right">5D</th>
              <th className="px-3 py-2 text-right">30D</th>
              <th className="px-3 py-2 text-right">vs 200d</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.symbol} className="border-t">
                <td className="px-3 py-2 font-mono">{r.symbol}</td>
                <td className={"px-3 py-2 " + (highlightSymbols.has(r.symbol) ? "font-semibold" : "")}>{r.name}</td>
                <td className="px-3 py-2 text-gray-600">{r.country ?? "—"}</td>
                <td className={"px-3 py-2 text-right tabular-nums " + returnColour(r.return_5d)}>{fmtPct(r.return_5d)}</td>
                <td className={"px-3 py-2 text-right tabular-nums " + returnColour(r.return_30d)}>{fmtPct(r.return_30d)}</td>
                <td className={"px-3 py-2 text-right tabular-nums " + returnColour(r.price_vs_200d)}>{fmtPct(r.price_vs_200d)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-gray-500">Bold = reporting this week or next.</p>
    </div>
  );
}

function ValuationTable({ title, rows }: { title: string; rows: EuropeanCompanyRow[] }) {
  return (
    <div className="rounded-lg border bg-white p-4">
      <div className="flex items-baseline justify-between">
        <h2 className="text-base font-semibold">{title}</h2>
        <div className="text-xs text-gray-500">to last close</div>
      </div>
      <div className="mt-3 overflow-auto rounded border">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50">
            <tr className="text-left">
              <th className="px-3 py-2">Symbol</th>
              <th className="px-3 py-2">Company</th>
              <th className="px-3 py-2">Country</th>
              <th className="px-3 py-2 text-right">Weight</th>
              <th className="px-3 py-2 text-right">5D</th>
              <th className="px-3 py-2 text-right">30D</th>
              <th className="px-3 py-2 text-right">vs 200d</th>
              <th className="px-3 py-2 text-right">Trailing P/E</th>
              <th className="px-3 py-2 text-right">Forward P/E</th>
              <th className="px-3 py-2 text-right">PEG</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.symbol} className="border-t">
                <td className="px-3 py-2 font-mono">{r.symbol}</td>
                <td className="px-3 py-2">{r.name}</td>
                <td className="px-3 py-2 text-gray-600">{r.country ?? "—"}</td>
                <td className="px-3 py-2 text-right tabular-nums">{fmtW(r.index_weight)}</td>
                <td className={"px-3 py-2 text-right tabular-nums " + returnColour(r.return_5d)}>{fmtPct(r.return_5d)}</td>
                <td className={"px-3 py-2 text-right tabular-nums " + returnColour(r.return_30d)}>{fmtPct(r.return_30d)}</td>
                <td className={"px-3 py-2 text-right tabular-nums " + returnColour(r.price_vs_200d)}>{fmtPct(r.price_vs_200d)}</td>
                <td className={"px-3 py-2 text-right tabular-nums " + peColour(r.trailing_pe)}>{fmtNum(r.trailing_pe)}</td>
                <td className={"px-3 py-2 text-right tabular-nums " + peColour(r.forward_pe)}>{fmtNum(r.forward_pe)}</td>
                <td className={"px-3 py-2 text-right tabular-nums " + pegColour(r.peg_ratio)}>{fmtNum(r.peg_ratio)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function EarningsFilter({ rows }: { rows: EuropeanCompanyRow[] }) {
  const [query, setQuery] = useState("");
  const [sector, setSector] = useState("All");

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (sector !== "All" && r.sector !== sector) return false;
      if (!query) return true;
      const q = query.toLowerCase();
      return r.symbol.toLowerCase().includes(q) || r.name.toLowerCase().includes(q) || (r.country ?? "").toLowerCase().includes(q);
    });
  }, [rows, query, sector]);

  const thisWeek = useMemo(() => filtered.filter((r) => isWithinWeek(r.report_date)).sort((a, b) => {
    if (!a.report_date && !b.report_date) return 0;
    if (!a.report_date) return 1;
    if (!b.report_date) return -1;
    return a.report_date.localeCompare(b.report_date);
  }), [filtered]);

  const nextWeek = useMemo(() => filtered.filter((r) => isWithinNextWeek(r.report_date)).sort((a, b) => {
    if (!a.report_date && !b.report_date) return 0;
    if (!a.report_date) return 1;
    if (!b.report_date) return -1;
    return a.report_date.localeCompare(b.report_date);
  }), [filtered]);

  const sectors = useMemo(() => ["All", ...Array.from(new Set(rows.map((r) => r.sector).filter(Boolean))).sort()], [rows]);

  return (
    <div className="mt-4">
      <div className="flex flex-col gap-3 rounded-lg border bg-white p-4 sm:flex-row sm:items-end">
        <div className="flex-1">
          <label className="block text-sm font-medium text-gray-700">Search</label>
          <input value={query} onChange={(e) => setQuery(e.target.value)}
            placeholder="Ticker, name, or country…"
            className="mt-1 w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring" />
        </div>
        <div className="sm:w-64">
          <label className="block text-sm font-medium text-gray-700">Sector</label>
          <select value={sector} onChange={(e) => setSector(e.target.value)}
            className="mt-1 w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring">
            {sectors.map((s) => <option key={s}>{s}</option>)}
          </select>
        </div>
      </div>
      <div className="mt-3 text-sm text-gray-700"><span className="font-semibold">Showing:</span> {filtered.length} companies</div>
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        {[{ title: "Reporting this week", rows: thisWeek }, { title: "Reporting next week", rows: nextWeek }].map(({ title, rows: wRows }) => (
          <div key={title} className="rounded-lg border bg-gray-50 p-4">
            <div className="flex items-baseline justify-between">
              <h2 className="text-base font-semibold">{title}</h2>
              <div className="text-sm text-gray-600">{wRows.length} companies</div>
            </div>
            {wRows.length === 0 ? (
              <p className="mt-2 text-sm text-gray-600">None match your filters.</p>
            ) : (
              <div className="mt-3 overflow-auto rounded border bg-white">
                <table className="min-w-full text-sm">
                  <thead className="bg-gray-100">
                    <tr className="text-left">
                      <th className="px-3 py-2">Date</th>
                      <th className="px-3 py-2">Symbol</th>
                      <th className="px-3 py-2">Name</th>
                      <th className="px-3 py-2">Country</th>
                      <th className="px-3 py-2">Sector</th>
                    </tr>
                  </thead>
                  <tbody>
                    {wRows.slice(0, 40).map((r) => (
                      <tr key={r.symbol} className="border-t">
                        <td className="px-3 py-2">{r.report_date ?? "—"}</td>
                        <td className="px-3 py-2 font-mono">{r.symbol}</td>
                        <td className="px-3 py-2">{r.name}</td>
                        <td className="px-3 py-2">{r.country ?? "—"}</td>
                        <td className="px-3 py-2">{r.sector}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Main EuropeSection ────────────────────────────────────────────────────────

const TABS = ["Summary", "Signals", "Movers", "Earnings", "Valuations"] as const;
type Tab = typeof TABS[number];

export function EuropeSection({ rows, indexValue, indexChangePct }: { rows: EuropeanCompanyRow[]; indexValue: number | null; indexChangePct: number | null }) {
  const [activeTab, setActiveTab] = useState<Tab>("Summary");

  const now = new Date();
  const thisWkStart = startOfWeek(now);
  const thisWkEnd = endOfWeek(now);
  const nextRef = new Date(now.getTime() + 7 * 86400_000);
  const nextWkStart = startOfWeek(nextRef);
  const nextWkEnd = endOfWeek(nextRef);

  const thisWeek = useMemo(() => rows.filter((r) => inRange(r.report_date, thisWkStart, thisWkEnd)), [rows]);
  const nextWeek = useMemo(() => rows.filter((r) => inRange(r.report_date, nextWkStart, nextWkEnd)), [rows]);
  const reportingThisOrNext = useMemo(() => new Set([...thisWeek, ...nextWeek].map((r) => r.symbol)), [thisWeek, nextWeek]);

  function top10ByWeight(rr: EuropeanCompanyRow[]) {
    return [...rr].filter((r) => r.index_weight != null).sort((a, b) => (b.index_weight ?? 0) - (a.index_weight ?? 0)).slice(0, 10);
  }

  const top10ThisWeekByWeight = useMemo(() => top10ByWeight(thisWeek), [thisWeek]);
  const top10NextWeekByWeight = useMemo(() => top10ByWeight(nextWeek), [nextWeek]);

  const topRunups5d = useMemo(() => [...rows].filter((r) => r.return_5d != null).sort((a, b) => (b.return_5d ?? -999) - (a.return_5d ?? -999)).slice(0, 10), [rows]);
  const topRunups30d = useMemo(() => [...rows].filter((r) => r.return_30d != null).sort((a, b) => (b.return_30d ?? -999) - (a.return_30d ?? -999)).slice(0, 10), [rows]);
  const topFallers5d = useMemo(() => [...rows].filter((r) => r.return_5d != null).sort((a, b) => (a.return_5d ?? 999) - (b.return_5d ?? 999)).slice(0, 10), [rows]);
  const topFallers30d = useMemo(() => [...rows].filter((r) => r.return_30d != null).sort((a, b) => (a.return_30d ?? 999) - (b.return_30d ?? 999)).slice(0, 10), [rows]);

  const pulseBull = useMemo(() => rows.filter((r) => r.ema_trend === "up" && r.dmi_trend === "up").length, [rows]);
  const pulseBear = useMemo(() => rows.filter((r) => r.ema_trend === "down" && r.dmi_trend === "down").length, [rows]);
  const pulseNeutral = rows.length - pulseBull - pulseBear;
  const highConfSignals = useMemo(
    () => rows.filter((r) => r.signal_confidence === "high" && (r.signal_label === "Strong Bullish Trend" || r.signal_label === "Bullish Momentum Increasing")).length,
    [rows]
  );

  const top5 = useMemo(() =>
    rows.filter((r) => r.signal_confidence === "high" && (r.signal_label === "Strong Bullish Trend" || r.signal_label === "Bullish Momentum Increasing"))
      .sort((a, b) => {
        const aDate = a.signal_changed_at ? new Date(a.signal_changed_at).getTime() : 0;
        const bDate = b.signal_changed_at ? new Date(b.signal_changed_at).getTime() : 0;
        if (bDate !== aDate) return bDate - aDate;
        return (b.mom_rank_pct ?? 0) - (a.mom_rank_pct ?? 0);
      }).slice(0, 6),
    [rows]
  );

  const watchList = useMemo(() =>
    rows.filter((r) => r.macd_improving_bars != null && r.macd_improving_bars >= 1 && r.macd_improving_bars < 3 && r.ema_trend === "up")
      .sort((a, b) => (b.macd_improving_bars ?? 0) - (a.macd_improving_bars ?? 0)).slice(0, 10),
    [rows]
  );

  const top3Reporting = useMemo(() =>
    [...thisWeek, ...nextWeek]
      .sort((a, b) => {
        const aMom = a.mom_rank_pct ?? -1, bMom = b.mom_rank_pct ?? -1;
        if (bMom !== aMom) return bMom - aMom;
        return (b.index_weight ?? 0) - (a.index_weight ?? 0);
      }).slice(0, 3),
    [thisWeek, nextWeek]
  );

  const sectorPerf = useMemo(() => {
    const sectorMap = new Map<string, { r5: number[]; r30: number[]; r252: number[] }>();
    for (const r of rows) {
      if (!r.sector) continue;
      if (!sectorMap.has(r.sector)) sectorMap.set(r.sector, { r5: [], r30: [], r252: [] });
      const s = sectorMap.get(r.sector)!;
      if (r.return_5d != null) s.r5.push(r.return_5d);
      if (r.return_30d != null) s.r30.push(r.return_30d);
      if (r.return_252d != null) s.r252.push(r.return_252d);
    }
    return [...sectorMap.entries()]
      .map(([sector, d]) => ({ sector, ret5d: avg(d.r5), ret30d: avg(d.r30), ret252d: avg(d.r252) }))
      .sort((a, b) => (b.ret30d ?? -999) - (a.ret30d ?? -999));
  }, [rows]);

  return (
    <div>
      {/* Sub-tab bar */}
      <div className="flex gap-1 border-b border-gray-200 pb-0">
        {TABS.map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
              activeTab === tab
                ? "border-gray-900 text-gray-900"
                : "border-transparent text-gray-500 hover:text-gray-700"
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {indexValue !== null && (
        <div className="mt-3 flex items-baseline gap-2">
          <span className="text-sm font-medium text-gray-700">Stoxx 600</span>
          <span className="text-sm font-semibold text-gray-900">{indexValue.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
          {indexChangePct !== null && (
            <span className={`text-xs font-medium ${indexChangePct >= 0 ? "text-green-600" : "text-red-600"}`}>
              {indexChangePct >= 0 ? "+" : ""}{indexChangePct.toFixed(2)}%
            </span>
          )}
          <span className="text-xs text-gray-400">(last price)</span>
        </div>
      )}
      <p className="mt-2 text-xs text-gray-400">All prices below are end-of-day. Data updates when sync is run manually.</p>

      <div className="mt-4">

        {/* ── Summary ── */}
        {activeTab === "Summary" && (
          <div>
            <div className="grid grid-cols-4 gap-3">
              <div className="rounded-lg border bg-green-50 p-4">
                <div className="text-xs font-medium text-green-700">Bullish</div>
                <div className="mt-1 text-2xl font-bold text-green-800">{pulseBull}</div>
                <div className="text-xs text-green-600">{rows.length > 0 ? Math.round((pulseBull / rows.length) * 100) : 0}% of universe</div>
              </div>
              <div className="rounded-lg border bg-red-50 p-4">
                <div className="text-xs font-medium text-red-700">Bearish</div>
                <div className="mt-1 text-2xl font-bold text-red-800">{pulseBear}</div>
                <div className="text-xs text-red-600">{rows.length > 0 ? Math.round((pulseBear / rows.length) * 100) : 0}% of universe</div>
              </div>
              <div className="rounded-lg border bg-gray-50 p-4">
                <div className="text-xs font-medium text-gray-600">Neutral / Mixed</div>
                <div className="mt-1 text-2xl font-bold text-gray-700">{pulseNeutral}</div>
                <div className="text-xs text-gray-500">{rows.length > 0 ? Math.round((pulseNeutral / rows.length) * 100) : 0}% of universe</div>
              </div>
              <div className="rounded-lg border bg-blue-50 p-4">
                <div className="text-xs font-medium text-blue-700">High-conviction buys</div>
                <div className="mt-1 text-2xl font-bold text-blue-800">{highConfSignals}</div>
                <div className="text-xs text-blue-600">actionable setups today</div>
              </div>
            </div>

            <div className="mt-6">
              <h2 className="text-sm font-semibold text-gray-700">Market commentary — week beginning {fmtUKDate(thisWkStart)}</h2>
              <div className="mt-3"><AIAssistant apiPath="/api/ai/europe" /></div>
            </div>

            <div className="mt-8">
              <h2 className="text-sm font-semibold text-gray-700">Sector performance (average returns across all 299 companies)</h2>
              <div className="mt-3 overflow-auto rounded border">
                <table className="min-w-full text-sm">
                  <thead className="bg-gray-50">
                    <tr className="text-left">
                      <th className="px-3 py-2">Sector</th>
                      <th className="px-3 py-2 text-right">5D</th>
                      <th className="px-3 py-2 text-right">30D</th>
                      <th className="px-3 py-2 text-right">1Y</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sectorPerf.map((s) => (
                      <tr key={s.sector} className="border-t">
                        <td className="px-3 py-2 font-medium">{s.sector}</td>
                        <td className={"px-3 py-2 text-right tabular-nums " + returnColour(s.ret5d)}>{fmtPct(s.ret5d)}</td>
                        <td className={"px-3 py-2 text-right tabular-nums " + returnColour(s.ret30d)}>{fmtPct(s.ret30d)}</td>
                        <td className={"px-3 py-2 text-right tabular-nums " + returnColour(s.ret252d)}>{fmtPct(s.ret252d)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="mt-8">
              <div className="flex items-baseline justify-between">
                <h2 className="text-sm font-semibold text-gray-700">Potential trades</h2>
                <span className="text-xs text-gray-400">{top5.length} setup{top5.length !== 1 ? "s" : ""}</span>
              </div>
              {top5.length === 0 ? (
                <div className="mt-4 rounded-lg border border-dashed border-gray-200 p-6 text-center text-sm text-gray-500">
                  No high-conviction setups today.
                </div>
              ) : (
                <div className="mt-3 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                  {top5.map((r, i) => <TradeCard key={r.symbol} r={r} rank={i + 1} />)}
                </div>
              )}
            </div>

            {watchList.length > 0 && (
              <div className="mt-8">
                <h2 className="text-sm font-semibold text-gray-700">Developing setups — not yet confirmed</h2>
                <div className="mt-3 rounded-lg border bg-amber-50/40 px-4 py-1">
                  {watchList.map((r) => <WatchRow key={r.symbol} r={r} />)}
                </div>
                <p className="mt-2 text-xs text-gray-400">X/3 = bars of rising MACD histogram so far. Signal confirms at 3/3.</p>
              </div>
            )}

            {top3Reporting.length > 0 && (
              <div className="mt-8">
                <h2 className="text-sm font-semibold text-gray-700">Reporting soon — strongest momentum</h2>
                <div className="mt-3 flex flex-wrap gap-3">
                  {top3Reporting.map((r, i) => {
                    const weekLabel = inRange(r.report_date, thisWkStart, thisWkEnd) ? "This week" : "Next week";
                    return (
                      <div key={r.symbol} className="flex-1 min-w-48 rounded-lg border border-blue-100 bg-blue-50 p-4">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold text-blue-300">#{i + 1}</span>
                          <a href={`https://finance.yahoo.com/chart/${r.symbol}`} target="_blank" rel="noopener noreferrer"
                             className="font-mono text-sm font-semibold text-blue-800 hover:underline">{r.symbol}</a>
                          <span className="rounded bg-blue-100 px-1.5 py-0.5 text-xs text-blue-600">{weekLabel}</span>
                        </div>
                        <div className="mt-0.5 text-xs text-blue-700">{r.name}</div>
                        <div className="mt-1 text-xs text-blue-500">{r.sector ?? "—"} · {r.country ?? "—"}{r.report_date && <span className="ml-2 font-medium">{r.report_date}</span>}</div>
                        {r.signal_label && (
                          <div className="mt-2 flex flex-wrap items-center gap-1.5">
                            <SignalBadge label={r.signal_label} />
                            <ConfidenceDot level={r.signal_confidence} />
                          </div>
                        )}
                        <div className="mt-2 flex gap-3 text-xs">
                          <span className={returnColour(r.return_5d)}>5D {fmtPct(r.return_5d)}</span>
                          <span className={returnColour(r.return_30d)}>30D {fmtPct(r.return_30d)}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Signals ── */}
        {activeTab === "Signals" && (
          <div>
            <div className="mb-2 text-sm text-gray-600">MACD / EMA / DMI signals for all 299 European large cap companies</div>
            <SignalsTable rows={rows} showCountry />
          </div>
        )}

        {/* ── Movers ── */}
        {activeTab === "Movers" && (
          <div>
            <div className="mb-4 text-sm text-gray-600">
              Bold = reporting this week or next. Week beginning {fmtUKDate(thisWkStart)} / {fmtUKDate(nextWkStart)}.
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <MoversTable title="Biggest run-ups (5D)" rows={topRunups5d} highlightSymbols={reportingThisOrNext} />
              <MoversTable title="Biggest run-ups (30D)" rows={topRunups30d} highlightSymbols={reportingThisOrNext} />
              <MoversTable title="Biggest fallers (5D)" rows={topFallers5d} highlightSymbols={reportingThisOrNext} />
              <MoversTable title="Biggest fallers (30D)" rows={topFallers30d} highlightSymbols={reportingThisOrNext} />
            </div>
          </div>
        )}

        {/* ── Earnings ── */}
        {activeTab === "Earnings" && (
          <div>
            <div className="mb-4 text-sm text-gray-600">
              This week: {iso(thisWkStart)}..{iso(thisWkEnd)} · Next week: {iso(nextWkStart)}..{iso(nextWkEnd)}
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <DataTable title="Reporting this week (top 10 by weight)" rows={top10ThisWeekByWeight} />
              <DataTable title="Reporting next week (top 10 by weight)" rows={top10NextWeekByWeight} />
            </div>
            <div className="mt-4 text-sm text-gray-700"><span className="font-semibold">Total in database:</span> {rows.length}</div>
            <EarningsFilter rows={rows} />
          </div>
        )}

        {/* ── Valuations ── */}
        {activeTab === "Valuations" && (
          <div>
            <div className="mb-4 text-sm text-gray-600">
              This week: {iso(thisWkStart)}..{iso(thisWkEnd)} · Next week: {iso(nextWkStart)}..{iso(nextWkEnd)}
            </div>
            <div className="grid gap-4">
              <ValuationTable title="Reporting this week (top 10 by weight)" rows={top10ThisWeekByWeight} />
              <ValuationTable title="Reporting next week (top 10 by weight)" rows={top10NextWeekByWeight} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

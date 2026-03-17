"use client";

import { useState, useMemo } from "react";

type Row = {
  symbol: string;
  name: string;
  sector: string | null;
  country?: string | null;
  report_date?: string | null;
  signal_label?: string | null;
  signal_confidence?: string | null;
  macd_state?: string | null;
  ema_trend?: string | null;
  dmi_trend?: string | null;
  adx?: number | null;
  mom_rank_pct?: number | null;
  return_5d?: number | null;
  return_30d?: number | null;
  price_vs_200d?: number | null;
  macd_improving_bars?: number | null;
};

type SortKey = "signal_label" | "mom_rank_pct" | "return_5d" | "return_30d" | "price_vs_200d" | "adx" | "name";
type SortDir = "asc" | "desc";

function fmtPct(x: number | null | undefined) {
  if (x == null || !Number.isFinite(x)) return "—";
  return `${x >= 0 ? "+" : ""}${x.toFixed(2)}%`;
}

function returnCls(x: number | null | undefined) {
  if (x == null || !Number.isFinite(x)) return "text-gray-400";
  return x > 0 ? "text-green-600" : x < 0 ? "text-red-500" : "text-gray-500";
}

function daysToEarnings(reportDate: string | null | undefined): number | null {
  if (!reportDate) return null;
  const today = new Date().toISOString().slice(0, 10);
  const diffMs = new Date(reportDate).getTime() - new Date(today).getTime();
  return Math.round(diffMs / 86_400_000);
}

const SIGNAL_STYLES: Record<string, string> = {
  "Strong Bullish Trend":            "bg-green-100 text-green-800",
  "Bullish Momentum Increasing":     "bg-emerald-100 text-emerald-800",
  "Bullish Trend Losing Momentum":   "bg-yellow-100 text-yellow-800",
  "Uptrend Under Pressure":          "bg-orange-100 text-orange-800",
  "Counter-Trend Rally":             "bg-purple-100 text-purple-800",
  "Bearish Momentum Weakening":      "bg-orange-100 text-orange-800",
  "Bearish Trend Losing Momentum":   "bg-orange-100 text-orange-800",
  "Strong Bearish Trend":            "bg-red-100 text-red-800",
  "Sideways / Choppy":               "bg-gray-100 text-gray-700",
  "Mixed Signals":                   "bg-gray-100 text-gray-600",
};

const CONF_STYLES: Record<string, string> = {
  high:   "bg-green-500",
  medium: "bg-amber-400",
  low:    "bg-gray-300",
};

const MACD_STYLES: Record<string, string> = {
  positive:  "bg-green-100 text-green-700",
  improving: "bg-emerald-100 text-emerald-700",
  weakening: "bg-orange-100 text-orange-700",
  negative:  "bg-red-100 text-red-700",
};

const TREND_STYLES: Record<string, string> = {
  up:      "bg-blue-100 text-blue-700",
  neutral: "bg-gray-100 text-gray-600",
  down:    "bg-red-100 text-red-700",
};

function SignalBadge({ label }: { label: string | null | undefined }) {
  if (!label) return <span className="text-xs text-gray-400">—</span>;
  const cls = SIGNAL_STYLES[label] ?? "bg-gray-100 text-gray-600";
  return (
    <span className={`inline-block max-w-[18ch] truncate rounded px-1.5 py-0.5 text-xs font-medium ${cls}`} title={label}>
      {label}
    </span>
  );
}

function ConfDot({ level }: { level: string | null | undefined }) {
  if (!level) return null;
  const bg = CONF_STYLES[level] ?? "bg-gray-300";
  return (
    <span
      className={`ml-1 inline-block h-2 w-2 rounded-full ${bg}`}
      title={`${level.charAt(0).toUpperCase() + level.slice(1)} confidence`}
    />
  );
}

function DimBadge({ value, styles }: { value: string | null | undefined; styles: Record<string, string> }) {
  if (!value) return <span className="text-xs text-gray-300">—</span>;
  const cls = styles[value] ?? "bg-gray-100 text-gray-600";
  return (
    <span className={`inline-block rounded px-1 py-0.5 text-xs font-medium ${cls}`}>
      {value.charAt(0).toUpperCase() + value.slice(1)}
    </span>
  );
}

function SortHeader({
  label, col, sortKey, sortDir, onSort, tooltip,
}: {
  label: string; col: SortKey; sortKey: SortKey; sortDir: SortDir;
  onSort: (c: SortKey) => void; tooltip?: string;
}) {
  const active = sortKey === col;
  return (
    <th
      className="group cursor-pointer select-none whitespace-nowrap px-3 py-2 text-left text-xs font-semibold text-gray-500 hover:text-gray-800"
      onClick={() => onSort(col)}
      title={tooltip}
    >
      {label}
      <span className="ml-1 text-gray-300 group-hover:text-gray-500">
        {active ? (sortDir === "asc" ? "↑" : "↓") : "↕"}
      </span>
    </th>
  );
}

export function SignalsTable({ rows, showCountry = false }: { rows: Row[]; showCountry?: boolean }) {
  const [search, setSearch]       = useState("");
  const [sector, setSector]       = useState("All");
  const [conf, setConf]           = useState("All");
  const [signalType, setSignalType] = useState("All");
  const [sortKey, setSortKey]     = useState<SortKey>("mom_rank_pct");
  const [sortDir, setSortDir]     = useState<SortDir>("desc");

  const sectors = useMemo(
    () => ["All", ...Array.from(new Set(rows.map((r) => r.sector).filter(Boolean))).sort()],
    [rows]
  );

  function handleSort(col: SortKey) {
    if (sortKey === col) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(col);
      setSortDir("desc");
    }
  }

  const filtered = useMemo(() => {
    let out = rows;

    if (search.trim()) {
      const q = search.toLowerCase();
      out = out.filter(
        (r) => r.symbol.toLowerCase().includes(q) ||
               (r.name ?? "").toLowerCase().includes(q) ||
               (r.country ?? "").toLowerCase().includes(q)
      );
    }

    if (sector !== "All") out = out.filter((r) => r.sector === sector);

    if (conf !== "All") {
      out = out.filter((r) => (r.signal_confidence ?? "").toLowerCase() === conf.toLowerCase());
    }

    if (signalType === "Bullish") {
      out = out.filter((r) => r.signal_label?.toLowerCase().includes("bull") || r.signal_label?.toLowerCase().includes("momentum increasing"));
    } else if (signalType === "Bearish") {
      out = out.filter((r) => r.signal_label?.toLowerCase().includes("bear"));
    } else if (signalType === "Developing") {
      out = out.filter((r) => (r.macd_improving_bars ?? 0) >= 1 && (r.macd_improving_bars ?? 0) < 3 && r.ema_trend === "up");
    }

    out = [...out].sort((a, b) => {
      if (sortKey === "name") {
        const av = a.name ?? a.symbol;
        const bv = b.name ?? b.symbol;
        return sortDir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
      }
      if (sortKey === "signal_label") {
        const av = a.signal_label ?? "";
        const bv = b.signal_label ?? "";
        return sortDir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
      }
      const numKey = sortKey as keyof Row;
      const an = ((a[numKey] as number | null) ?? null) ?? (sortDir === "desc" ? -Infinity : Infinity);
      const bn = ((b[numKey] as number | null) ?? null) ?? (sortDir === "desc" ? -Infinity : Infinity);
      return sortDir === "asc" ? (an as number) - (bn as number) : (bn as number) - (an as number);
    });

    return out;
  }, [rows, search, sector, conf, signalType, sortKey, sortDir]);

  return (
    <div className="mt-4">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <input
          type="text"
          placeholder={showCountry ? "Search ticker, name, or country…" : "Search ticker or name…"}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-8 w-52 rounded border border-gray-200 px-2 text-sm text-gray-700 placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-blue-400"
        />

        <select
          value={sector}
          onChange={(e) => setSector(e.target.value)}
          className="h-8 rounded border border-gray-200 px-2 text-sm text-gray-700 focus:outline-none focus:ring-1 focus:ring-blue-400"
        >
          {sectors.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>

        <div className="flex overflow-hidden rounded border border-gray-200 bg-gray-50">
          {["All", "High", "Medium", "Low"].map((c) => (
            <button
              key={c}
              onClick={() => setConf(c)}
              className={`px-3 py-1 text-xs transition-colors ${conf === c ? "bg-gray-800 text-white" : "text-gray-600 hover:bg-gray-100"}`}
            >
              {c}
            </button>
          ))}
        </div>

        <div className="flex overflow-hidden rounded border border-gray-200 bg-gray-50">
          {["All", "Bullish", "Bearish", "Developing"].map((t) => (
            <button
              key={t}
              onClick={() => setSignalType(t)}
              className={`px-3 py-1 text-xs transition-colors ${signalType === t ? "bg-gray-800 text-white" : "text-gray-600 hover:bg-gray-100"}`}
            >
              {t}
            </button>
          ))}
        </div>

        <span className="ml-auto text-xs text-gray-400">{filtered.length} companies</span>
      </div>

      <div className="overflow-auto rounded border">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              <SortHeader label="Company" col="name" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
              <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500">Signal</th>
              <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500">MACD</th>
              <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500">EMA</th>
              <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500">DMI</th>
              <SortHeader label="ADX" col="adx" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} tooltip="ADX measures trend strength 0–100. Above 20 = real trend." />
              <SortHeader label="Mom Rank" col="mom_rank_pct" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} tooltip="Momentum percentile rank. 90 = stronger than 90% of the universe." />
              <SortHeader label="5D" col="return_5d" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
              <SortHeader label="30D" col="return_30d" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
              <SortHeader label="vs 200d" col="price_vs_200d" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} tooltip="Price vs 200-day MA. Positive = above long-term trend." />
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={10} className="px-4 py-8 text-center text-sm text-gray-400">
                  No companies match the current filters.
                </td>
              </tr>
            ) : (
              filtered.map((r) => {
                const dte = daysToEarnings(r.report_date);
                const earningsFlag = dte != null && dte >= -2 && dte <= 10;
                return (
                  <tr key={r.symbol} className="border-t hover:bg-gray-50">
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono text-xs font-semibold text-gray-800">{r.symbol}</span>
                        {earningsFlag && (
                          <span className="text-xs text-amber-500" title={`Earnings in ${dte}d — check before trading`}>⚠</span>
                        )}
                      </div>
                      <div className="max-w-[16ch] truncate text-xs text-gray-500" title={r.name ?? ""}>{r.name}</div>
                      <div className="text-xs text-gray-400">
                        {showCountry && r.country ? `${r.country} · ` : ""}{r.sector ?? ""}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-1">
                        <SignalBadge label={r.signal_label} />
                        <ConfDot level={r.signal_confidence} />
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <DimBadge value={r.macd_state} styles={MACD_STYLES} />
                      {(r.macd_improving_bars ?? 0) > 0 && (r.macd_improving_bars ?? 0) < 3 && (
                        <span className="ml-1 text-xs text-amber-500">{r.macd_improving_bars}/3</span>
                      )}
                    </td>
                    <td className="px-3 py-2"><DimBadge value={r.ema_trend} styles={TREND_STYLES} /></td>
                    <td className="px-3 py-2"><DimBadge value={r.dmi_trend} styles={TREND_STYLES} /></td>
                    <td className="px-3 py-2 tabular-nums text-xs text-gray-700">{r.adx != null ? r.adx.toFixed(0) : "—"}</td>
                    <td className="px-3 py-2 text-xs">
                      {r.mom_rank_pct != null ? (
                        <span className={r.mom_rank_pct >= 80 ? "font-semibold text-green-700" : r.mom_rank_pct <= 20 ? "text-red-500" : "text-gray-700"}>
                          {r.mom_rank_pct.toFixed(0)}
                        </span>
                      ) : "—"}
                    </td>
                    <td className={`px-3 py-2 tabular-nums text-xs ${returnCls(r.return_5d)}`}>{fmtPct(r.return_5d)}</td>
                    <td className={`px-3 py-2 tabular-nums text-xs ${returnCls(r.return_30d)}`}>{fmtPct(r.return_30d)}</td>
                    <td className={`px-3 py-2 tabular-nums text-xs ${returnCls(r.price_vs_200d)}`}>{fmtPct(r.price_vs_200d)}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <p className="mt-2 text-xs text-gray-400">
        ⚠ = earnings within 10 days. Conf dot:{" "}
        <span className="inline-block h-2 w-2 rounded-full bg-green-500 align-middle" /> High{" "}
        <span className="inline-block h-2 w-2 rounded-full bg-amber-400 align-middle" /> Medium{" "}
        <span className="inline-block h-2 w-2 rounded-full bg-gray-300 align-middle" /> Low
      </p>
    </div>
  );
}

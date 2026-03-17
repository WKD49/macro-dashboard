import { fetchAllIndicators, fetchCorrelations, fetchYieldCurveHistory, fetchSpreadHistory, fetchLastSync } from "@/lib/macro/queries";
import { fetchAllSP500Companies } from "@/lib/sp500/queries";
import { fetchAllEuropeanCompanies } from "@/lib/europe/queries";
import { DashboardTabs } from "@/components/dashboard/DashboardTabs";

// Revalidate every 5 minutes (same pattern as existing dashboards)
export const revalidate = 300;

function fmtSyncTime(ts: string | null): string {
  if (!ts) return "—";
  return new Date(ts).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default async function DashboardPage() {
  const [indicators, correlations, curveHistory, spreadHistory, lastSync, sp500Rows, europeRows] = await Promise.all([
    fetchAllIndicators(),
    fetchCorrelations(),
    fetchYieldCurveHistory(),
    fetchSpreadHistory(),
    fetchLastSync(),
    fetchAllSP500Companies().catch(() => []),
    fetchAllEuropeanCompanies().catch(() => []),
  ]);

  return (
    <main className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between flex-wrap gap-2">
          <h1 className="text-lg font-semibold text-gray-900">
            Macro Dashboard
          </h1>
          <p className="text-xs text-gray-400">
            Last synced:{" "}
            <span className="font-medium text-gray-600">
              {fmtSyncTime(lastSync?.finished_at ?? null)}
            </span>
          </p>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
        {indicators.length === 0 ? (
          <div className="text-center py-20 text-gray-400">
            <p className="text-sm">No data yet.</p>
            <p className="text-xs mt-1">
              Run <code className="bg-gray-100 px-1 rounded">npm run sync:stooq</code> and{" "}
              <code className="bg-gray-100 px-1 rounded">npm run sync:fred</code> to populate.
            </p>
          </div>
        ) : (
          <DashboardTabs indicators={indicators} correlations={correlations} curveHistory={curveHistory} spreadHistory={spreadHistory} sp500Rows={sp500Rows} europeRows={europeRows} />
        )}
      </div>
    </main>
  );
}

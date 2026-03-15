import { fetchAllIndicators, fetchLastSync } from "@/lib/macro/queries";
import { CategorySection } from "@/components/dashboard/CategorySection";
import {
  CATEGORY_SLUGS,
  CATEGORY_LABELS,
  type MacroIndicatorRow,
} from "@/lib/macro/types";

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
  const [indicators, lastSync] = await Promise.all([
    fetchAllIndicators(),
    fetchLastSync(),
  ]);

  // Index rows by slug for quick lookup
  const bySlug = new Map<string, MacroIndicatorRow>();
  for (const row of indicators) {
    bySlug.set(row.indicator, row);
  }

  // Group rows by category, preserving the defined order
  const categories = Object.entries(CATEGORY_SLUGS).map(([key, slugs]) => ({
    key,
    label: CATEGORY_LABELS[key] ?? key,
    rows: slugs.flatMap((s) => {
      const row = bySlug.get(s);
      return row ? [row] : [];
    }),
  }));

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
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8 flex flex-col gap-10">
        {indicators.length === 0 ? (
          <div className="text-center py-20 text-gray-400">
            <p className="text-sm">No data yet.</p>
            <p className="text-xs mt-1">
              Run <code className="bg-gray-100 px-1 rounded">npm run sync:stooq</code> and{" "}
              <code className="bg-gray-100 px-1 rounded">npm run sync:fred</code> to populate.
            </p>
          </div>
        ) : (
          categories.map(({ key, label, rows }) => (
            <CategorySection key={key} title={label} rows={rows} />
          ))
        )}
      </div>
    </main>
  );
}

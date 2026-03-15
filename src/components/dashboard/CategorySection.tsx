import type { MacroIndicatorRow } from "@/lib/macro/types";
import { MacroCard } from "@/components/dashboard/MacroCard";

type Props = {
  title: string;
  rows: MacroIndicatorRow[];
};

export function CategorySection({ title, rows }: Props) {
  if (rows.length === 0) return null;

  return (
    <section>
      <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-3">
        {title}
      </h2>
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
        {rows.map((row) => (
          <MacroCard key={row.indicator} row={row} />
        ))}
      </div>
    </section>
  );
}

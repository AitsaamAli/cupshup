"use client";

import { formatPaisa } from "@/lib/money";
import { aggregateHourly, type HourlySalesRow } from "@/lib/reports";

/**
 * Hourly sales heatmap — Part 18. Hand-rolled as a coloured grid rather
 * than forced through Recharts: Recharts has no native heatmap chart
 * type, and bending a scatter/bar chart into one cell-per-hour would be
 * more code and less readable than 24 plain divs with a background
 * colour driven by revenue share.
 */
export function HourlyHeatmap({ rows }: { rows: HourlySalesRow[] }) {
  const buckets = aggregateHourly(rows);
  const max = Math.max(1, ...buckets.map((b) => b.revenuePaisa));

  return (
    <div className="grid grid-cols-6 gap-1.5 sm:grid-cols-8 lg:grid-cols-12">
      {buckets.map((b) => {
        const intensity = b.revenuePaisa / max; // 0..1
        return (
          <div
            key={b.hour}
            title={`${String(b.hour).padStart(2, "0")}:00 — ${b.orders} orders, ${formatPaisa(b.revenuePaisa)}`}
            className="flex flex-col items-center justify-center rounded-md border border-neutral-800 py-2 text-xs"
            style={{
              backgroundColor: intensity === 0 ? "transparent" : `rgba(34, 160, 106, ${0.15 + intensity * 0.7})`,
            }}
          >
            <span className="tabular-nums text-neutral-400">{String(b.hour).padStart(2, "0")}</span>
            <span className="tabular-nums font-medium">{b.orders}</span>
          </div>
        );
      })}
    </div>
  );
}

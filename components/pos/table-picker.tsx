"use client";

import { useTables, type TableWithStatus } from "@/lib/tables";
import { StatusBadge } from "@/components/ui/StatusBadge";

const STATUS_MAP = {
  empty: { status: "neutral" as const, label: "Empty" },
  running: { status: "waiting" as const, label: "Serving" },
  bill_requested: { status: "ready" as const, label: "Bill" },
};

/**
 * Table grid for dine-in. Status is live (lib/tables.ts): empty /
 * serving (order sent, not yet all served) / bill (served, awaiting
 * settlement). Picking an empty table starts a fresh order; picking an
 * occupied one resumes its open tab so more items can be added before
 * it's settled.
 */
export function TablePicker({
  outletId,
  onPick,
}: {
  outletId: string;
  onPick: (table: TableWithStatus) => void;
}) {
  const { tables, loading } = useTables(outletId);

  if (loading) return <p className="p-8 text-portal-sm text-ink-500">Loading tables…</p>;

  return (
    <div className="bg-canvas p-6">
      <h1 className="mb-6 text-terminal-lg font-semibold text-ink-900">Select a table</h1>
      <div className="grid grid-cols-4 gap-4 sm:grid-cols-5">
        {tables.map((t) => {
          const meta = STATUS_MAP[t.status];
          return (
            <button
              key={t.id}
              onClick={() => onPick(t)}
              className="flex min-h-24 flex-col items-center justify-center gap-2 rounded-md border border-line bg-surface p-3 transition-colors duration-[120ms] ease-out hover:border-brand-300"
            >
              <span className="text-terminal-lg font-medium tabular-nums text-ink-900">{t.label}</span>
              <StatusBadge status={meta.status} label={meta.label} />
              {t.openOrder && <span className="text-portal-xs text-ink-500">#{t.openOrder.order_no}</span>}
            </button>
          );
        })}
      </div>
      {tables.length === 0 && <p className="mt-6 text-portal-sm text-ink-500">No tables set up for this outlet yet.</p>}
    </div>
  );
}

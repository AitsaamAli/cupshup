import type { ReactNode } from "react";

/**
 * One labelled metric — Part 18. The Dashboard and Master P&L are both
 * mostly a grid of these; a single component keeps every tile's
 * spacing/type scale identical instead of forty one-off `<div>`s.
 */
export function KpiTile({
  label,
  value,
  hint,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
}) {
  return (
    <div className="rounded-md border border-neutral-800 bg-neutral-900 p-4">
      <div className="text-sm text-neutral-400">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
      {hint && <div className="mt-1 text-xs text-neutral-600">{hint}</div>}
    </div>
  );
}

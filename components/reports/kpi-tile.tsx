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
    <div className="rounded-lg border border-line bg-surface p-4">
      <div className="text-portal-xs text-ink-500">{label}</div>
      <div className="mt-1 text-portal-xl font-semibold tabular-nums text-ink-900">{value}</div>
      {hint && <div className="mt-1 text-portal-2xs text-ink-300">{hint}</div>}
    </div>
  );
}

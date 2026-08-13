import type { ReactNode } from "react";

/**
 * Sticky action/filter bar — Portal-density screens only. Sits directly
 * under the page header, holds date ranges, outlet switchers, search, and
 * primary actions so they're always reachable without scrolling back up.
 */
export function FilterBar({ children }: { children: ReactNode }) {
  return (
    <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 border-b border-line bg-surface/95 px-4 py-3 backdrop-blur-sm">
      {children}
    </div>
  );
}

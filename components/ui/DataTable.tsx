"use client";

import { useMemo, useState, type ReactNode } from "react";
import { ChevronUpIcon, ChevronDownIcon } from "./icons";

export interface DataTableColumn<T> {
  key: string;
  header: string;
  align?: "left" | "right";
  /** Applies tabular-nums so a column of numbers lines up vertically —
   * set this for any numeric column, money or otherwise. */
  numeric?: boolean;
  render: (row: T) => ReactNode;
  /** Omit for a column that shouldn't be sortable at all. */
  sortValue?: (row: T) => string | number;
}

/**
 * A sortable table with numbers right-aligned and tabular — Part 15.
 * The one table component every report/list screen should use going
 * forward, instead of a one-off `<table>` per page. Click a sortable
 * column's header to sort by it; click again to reverse.
 */
export function DataTable<T>({
  columns,
  rows,
  keyExtractor,
  emptyMessage = "No data.",
}: {
  columns: DataTableColumn<T>[];
  rows: T[];
  keyExtractor: (row: T) => string;
  emptyMessage?: string;
}) {
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  const sorted = useMemo(() => {
    const col = columns.find((c) => c.key === sortKey);
    if (!col?.sortValue) return rows;
    return [...rows].sort((a, b) => {
      const av = col.sortValue!(a);
      const bv = col.sortValue!(b);
      const cmp = av < bv ? -1 : av > bv ? 1 : 0;
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [rows, sortKey, sortDir, columns]);

  function toggleSort(key: string) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  if (rows.length === 0) {
    return <p className="text-portal-sm text-ink-500">{emptyMessage}</p>;
  }

  return (
    <table className="w-full text-left text-portal-sm">
      <thead className="sticky top-0 bg-surface text-ink-500">
        <tr>
          {columns.map((col) => (
            <th key={col.key} className={`border-b border-line pb-2 pr-4 font-medium ${col.align === "right" ? "text-right" : ""}`}>
              {col.sortValue ? (
                <button
                  onClick={() => toggleSort(col.key)}
                  className="inline-flex items-center gap-1 hover:text-ink-900"
                  aria-label={`Sort by ${col.header}`}
                >
                  {col.header}
                  {sortKey === col.key &&
                    (sortDir === "asc" ? <ChevronUpIcon size={12} /> : <ChevronDownIcon size={12} />)}
                </button>
              ) : (
                col.header
              )}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {sorted.map((row) => (
          <tr key={keyExtractor(row)} className="border-t border-line text-ink-900">
            {columns.map((col) => (
              <td
                key={col.key}
                className={`py-2 pr-4 ${col.align === "right" ? "text-right" : ""} ${col.numeric ? "tabular-nums" : ""}`}
              >
                {col.render(row)}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

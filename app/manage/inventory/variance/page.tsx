"use client";

import { useMemo } from "react";
import { useStaffSession } from "@/lib/auth";
import { useStockVariance } from "@/lib/inventory";
import { formatPaisa, type Paisa } from "@/lib/money";

const OUTLET_ID = process.env.NEXT_PUBLIC_SUPABASE_OUTLET_ID!;

/**
 * Variance report — Part 11, "yeh sabse ahem screen hai." Theoretical
 * use (recipe × sales) vs. declared loss (wastage + staff meals) vs.
 * what physical counts actually found. The gap that's left over —
 * count_adjustment, summed over every count ever taken — is stock that
 * left the building with no recipe line and no wastage entry behind it.
 * Sorted by rupee impact, biggest first, since that's what an owner
 * actually needs to see first.
 */
export default function VarianceReportPage() {
  const { staff } = useStaffSession("manage");
  const { rows, loading } = useStockVariance(OUTLET_ID);

  const sorted = useMemo(
    () => [...rows].sort((a, b) => Math.abs(b.unexplained_variance_paisa) - Math.abs(a.unexplained_variance_paisa)),
    [rows]
  );
  const totalVariancePaisa = rows.reduce((sum, r) => sum + r.unexplained_variance_paisa, 0);

  if (staff && staff.role !== "owner" && staff.role !== "manager") {
    return <p className="p-8 text-neutral-400">Only Owner/Manager can view the variance report.</p>;
  }
  if (loading) return <p className="p-8 text-neutral-400">Loading…</p>;

  return (
    <main className="min-h-screen bg-neutral-950 p-6 text-white">
      <h1 className="mb-1 text-xl font-semibold">Stock Variance Report</h1>
      <p className="mb-6 text-sm text-neutral-400">
        Total unexplained variance:{" "}
        <span className={totalVariancePaisa < 0 ? "text-red-400" : "text-neutral-300"}>
          {formatPaisa(totalVariancePaisa as Paisa)}
        </span>
      </p>

      <table className="w-full text-left text-sm">
        <thead className="text-neutral-500">
          <tr>
            <th className="pb-2 pr-4">Ingredient</th>
            <th className="pb-2 pr-4">Theoretical used</th>
            <th className="pb-2 pr-4">Declared loss</th>
            <th className="pb-2 pr-4">Count adjustment</th>
            <th className="pb-2 pr-4">Current stock</th>
            <th className="pb-2 pr-4">Variance (Rs)</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((row) => (
            <tr key={row.ingredient_id} className="border-t border-neutral-800">
              <td className="py-2 pr-4">{row.name}</td>
              <td className="py-2 pr-4 text-neutral-400">
                {Math.abs(row.theoretical_used)} {row.unit}
              </td>
              <td className="py-2 pr-4 text-neutral-400">
                {Math.abs(row.declared_loss)} {row.unit}
              </td>
              <td className="py-2 pr-4 text-neutral-400">
                {row.count_adjustment} {row.unit}
              </td>
              <td className="py-2 pr-4 text-neutral-400">
                {row.current_stock} {row.unit}
              </td>
              <td
                className={`py-2 pr-4 font-medium ${
                  row.unexplained_variance_paisa < 0
                    ? "text-red-400"
                    : row.unexplained_variance_paisa > 0
                      ? "text-emerald-400"
                      : "text-neutral-500"
                }`}
              >
                {formatPaisa(row.unexplained_variance_paisa as Paisa)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <p className="mt-6 text-xs text-neutral-500">
        Theoretical use = recipe × sales settled. Declared loss = wastage + staff meals logged.
        Count adjustment = every physical-count correction ever recorded — negative means stock
        vanished with no recipe line or wastage entry behind it.
      </p>
    </main>
  );
}

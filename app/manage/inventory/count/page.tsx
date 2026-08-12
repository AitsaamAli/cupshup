"use client";

import { useState } from "react";
import { useStaffSession } from "@/lib/auth";
import { useIngredientStock, recordStockCount } from "@/lib/inventory";

const OUTLET_ID = process.env.NEXT_PUBLIC_SUPABASE_OUTLET_ID!;
const CAN_COUNT = new Set(["owner", "manager"]);

/**
 * Physical stock count — Part 11. A manager types what's actually on
 * the shelf; record_stock_count() compares it to the ledger's
 * theoretical total and writes exactly the difference as a
 * count_adjustment. That difference is this ingredient's unexplained
 * variance since the last count (see /manage/inventory/variance).
 */
export default function StockCountPage() {
  const { staff } = useStaffSession("manage");
  const { rows, loading, reload } = useIngredientStock(OUTLET_ID);
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, { variance: number }>>({});
  const [error, setError] = useState<string | null>(null);

  const canCount = !!staff && CAN_COUNT.has(staff.role);

  async function submitCount(ingredientId: string) {
    const value = Number(counts[ingredientId]);
    if (!Number.isFinite(value) || value < 0) {
      setError("Enter a valid counted quantity.");
      return;
    }
    setSaving(ingredientId);
    setError(null);
    try {
      const result = await recordStockCount(ingredientId, value);
      setResults((r) => ({ ...r, [ingredientId]: { variance: result.variance } }));
      reload();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(null);
    }
  }

  if (loading) return <p className="p-8 text-neutral-400">Loading…</p>;

  if (!canCount) {
    return <p className="p-8 text-neutral-400">Only Owner/Manager can record a stock count.</p>;
  }

  return (
    <main className="min-h-screen bg-neutral-950 p-6 text-white">
      <h1 className="mb-2 text-xl font-semibold">Physical Stock Count</h1>
      <p className="mb-6 text-sm text-neutral-400">
        Enter what&apos;s actually on the shelf for each ingredient. The system compares it to the
        ledger and records the difference.
      </p>

      {error && <p className="mb-4 text-sm text-red-400">{error}</p>}

      <table className="w-full text-left text-sm">
        <thead className="text-neutral-500">
          <tr>
            <th className="pb-2 pr-4">Ingredient</th>
            <th className="pb-2 pr-4">System stock</th>
            <th className="pb-2 pr-4">Counted</th>
            <th className="pb-2 pr-4">Variance</th>
            <th className="pb-2 pr-4"></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="border-t border-neutral-800">
              <td className="py-2 pr-4">{row.name}</td>
              <td className="py-2 pr-4 text-neutral-400">
                {row.current_stock} {row.unit}
              </td>
              <td className="py-2 pr-4">
                <input
                  type="number"
                  step="0.001"
                  value={counts[row.id] ?? ""}
                  onChange={(e) => setCounts((c) => ({ ...c, [row.id]: e.target.value }))}
                  className="input w-28"
                />
              </td>
              <td className="py-2 pr-4">
                {results[row.id] !== undefined && (
                  <span className={results[row.id].variance !== 0 ? "text-amber-400" : "text-neutral-500"}>
                    {results[row.id].variance > 0 ? "+" : ""}
                    {results[row.id].variance} {row.unit}
                  </span>
                )}
              </td>
              <td className="py-2 pr-4">
                <button
                  onClick={() => submitCount(row.id)}
                  disabled={saving === row.id || !counts[row.id]}
                  className="rounded-lg bg-white px-3 py-1 text-xs font-medium text-neutral-950 disabled:opacity-40"
                >
                  {saving === row.id ? "Saving…" : "Submit"}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}

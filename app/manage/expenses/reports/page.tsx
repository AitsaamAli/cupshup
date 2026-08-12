"use client";

import { useMemo } from "react";
import { useStaffSession } from "@/lib/auth";
import {
  useExpenseCategories,
  useExpenses,
  summarizeByCategory,
  summarizeByVendor,
  summarizeCashVsNonCash,
} from "@/lib/expenses";
import { formatPaisa, type Paisa } from "@/lib/money";

const OUTLET_ID = process.env.NEXT_PUBLIC_SUPABASE_OUTLET_ID!;

/**
 * Expense reports — Part 14: category-wise, vendor-wise, a monthly
 * trend, and cash vs. non-cash. All computed client-side from the same
 * `expenses` rows `/manage/expenses` already loads — these are
 * aggregations for reading, not new financial calculations, so no new
 * RPC or view was needed beyond the amortization view already built.
 */
export default function ExpenseReportsPage() {
  const { staff } = useStaffSession("manage");
  const categories = useExpenseCategories(OUTLET_ID);
  const { expenses, loading } = useExpenses(OUTLET_ID, 500);

  const byCategory = useMemo(() => summarizeByCategory(expenses, categories), [expenses, categories]);
  const byVendor = useMemo(() => summarizeByVendor(expenses), [expenses]);
  const cashSplit = useMemo(() => summarizeCashVsNonCash(expenses), [expenses]);

  const byMonth = useMemo(() => {
    const totals = new Map<string, number>();
    for (const e of expenses) {
      const month = e.created_at.slice(0, 7); // YYYY-MM
      totals.set(month, (totals.get(month) ?? 0) + e.amount_paisa);
    }
    return [...totals.entries()].sort(([a], [b]) => b.localeCompare(a));
  }, [expenses]);

  if (staff && staff.role !== "owner" && staff.role !== "manager") {
    return <p className="p-8 text-neutral-400">Only Owner/Manager can view expense reports.</p>;
  }
  if (loading) return <p className="p-8 text-neutral-400">Loading…</p>;

  const total = cashSplit.cashPaisa + cashSplit.nonCashPaisa;

  return (
    <main className="min-h-screen bg-neutral-950 p-6 text-white">
      <h1 className="mb-6 text-xl font-semibold">Expense Reports</h1>

      <section className="mb-8 grid grid-cols-2 gap-6">
        <div>
          <h2 className="mb-2 font-medium">Cash vs. non-cash</h2>
          <p className="text-sm text-neutral-400">
            Cash: <span className="text-white">{formatPaisa(cashSplit.cashPaisa as Paisa)}</span>
          </p>
          <p className="text-sm text-neutral-400">
            Non-cash: <span className="text-white">{formatPaisa(cashSplit.nonCashPaisa as Paisa)}</span>
          </p>
          <p className="mt-1 text-xs text-neutral-600">
            Only the cash portion ever reduces a drawer&apos;s expected cash (Part 13).
          </p>
        </div>
        <div>
          <h2 className="mb-2 font-medium">Total recorded</h2>
          <p className="text-2xl">{formatPaisa(total as Paisa)}</p>
        </div>
      </section>

      <section className="mb-8">
        <h2 className="mb-3 font-medium">By category</h2>
        <table className="w-full text-left text-sm">
          <tbody>
            {byCategory.map((row) => (
              <tr key={row.categoryId} className="border-t border-neutral-800">
                <td className="py-1.5 pr-4 text-neutral-400">{row.categoryName}</td>
                <td className="py-1.5 text-right">{formatPaisa(row.totalPaisa as Paisa)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="mb-8">
        <h2 className="mb-3 font-medium">By vendor</h2>
        <table className="w-full text-left text-sm">
          <tbody>
            {byVendor.map((row) => (
              <tr key={row.vendor} className="border-t border-neutral-800">
                <td className="py-1.5 pr-4 text-neutral-400">{row.vendor}</td>
                <td className="py-1.5 text-right">{formatPaisa(row.totalPaisa as Paisa)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section>
        <h2 className="mb-3 font-medium">Monthly trend</h2>
        <table className="w-full text-left text-sm">
          <tbody>
            {byMonth.map(([month, amount]) => (
              <tr key={month} className="border-t border-neutral-800">
                <td className="py-1.5 pr-4 text-neutral-400">{month}</td>
                <td className="py-1.5 text-right">{formatPaisa(amount as Paisa)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-2 text-xs text-neutral-600">
          Full amounts per month, exactly as recorded — never amortised (that spreading only
          applies to daily P&L; see `daily_expenses_amortized`, Part 14).
        </p>
      </section>
    </main>
  );
}

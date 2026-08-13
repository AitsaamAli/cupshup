"use client";

import { useMemo } from "react";
import { useStaffSession } from "@/lib/auth";
import { useBusinessDay } from "@/lib/business-day";
import {
  useExpenseCategories,
  useExpenses,
  summarizeByCategory,
  summarizeByVendor,
  summarizeCashVsNonCash,
} from "@/lib/expenses";
import { formatPaisa, type Paisa } from "@/lib/money";
import { AppShell } from "@/components/ui/AppShell";
import { Card } from "@/components/ui/Card";

const OUTLET_ID = process.env.NEXT_PUBLIC_SUPABASE_OUTLET_ID!;

const PORTAL_NAV = [
  { label: "Dashboard", href: "/reports/dashboard" },
  { label: "Master P&L", href: "/reports/pl" },
  { label: "Menu", href: "/manage/menu" },
  { label: "Inventory", href: "/manage/inventory" },
  { label: "Purchases", href: "/manage/purchases" },
  { label: "Expenses", href: "/manage/expenses" },
  { label: "Business day", href: "/manage/day" },
];

/**
 * Expense reports — Part 14: category-wise, vendor-wise, a monthly
 * trend, and cash vs. non-cash. All computed client-side from the same
 * `expenses` rows `/manage/expenses` already loads — these are
 * aggregations for reading, not new financial calculations, so no new
 * RPC or view was needed beyond the amortization view already built.
 */
export default function ExpenseReportsPage() {
  const { staff, loading: staffLoading, lock } = useStaffSession("manage");
  const { day } = useBusinessDay(OUTLET_ID);
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

  if (staffLoading) return <div className="min-h-screen bg-canvas" />;

  if (staff && staff.role !== "owner" && staff.role !== "manager") {
    return <p className="p-8 text-portal-sm text-ink-500">Only Owner/Manager can view expense reports.</p>;
  }

  const total = cashSplit.cashPaisa + cashSplit.nonCashPaisa;

  return (
    <AppShell
      density="portal"
      nav={PORTAL_NAV}
      crumbs={[{ label: "Expenses" }, { label: "Reports" }]}
      staff={staff}
      dayStatus={day?.status === "open" ? "open" : "closed"}
      onLock={lock}
    >
      <div className="p-4">
        <h1 className="mb-4 text-portal-xl font-semibold text-ink-900">Expense Reports</h1>

        {loading ? (
          <p className="text-portal-sm text-ink-500">Loading…</p>
        ) : (
          <>
            <section className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Card className="p-4">
                <h2 className="mb-2 text-portal-sm font-semibold text-ink-900">Cash vs. non-cash</h2>
                <p className="text-portal-sm text-ink-500">
                  Cash: <span className="text-ink-900">{formatPaisa(cashSplit.cashPaisa as Paisa)}</span>
                </p>
                <p className="text-portal-sm text-ink-500">
                  Non-cash: <span className="text-ink-900">{formatPaisa(cashSplit.nonCashPaisa as Paisa)}</span>
                </p>
                <p className="mt-1 text-portal-xs text-ink-300">
                  Only the cash portion ever reduces a drawer&apos;s expected cash (Part 13).
                </p>
              </Card>
              <Card className="p-4">
                <h2 className="mb-2 text-portal-sm font-semibold text-ink-900">Total recorded</h2>
                <p className="text-portal-2xl tabular-nums text-ink-900">{formatPaisa(total as Paisa)}</p>
              </Card>
            </section>

            <Card className="mb-6 p-4">
              <h2 className="mb-3 text-portal-sm font-semibold text-ink-900">By category</h2>
              <table className="w-full text-left text-portal-sm">
                <tbody>
                  {byCategory.map((row) => (
                    <tr key={row.categoryId} className="border-t border-line">
                      <td className="py-1.5 pr-4 text-ink-500">{row.categoryName}</td>
                      <td className="py-1.5 text-right tabular-nums text-ink-900">{formatPaisa(row.totalPaisa as Paisa)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>

            <Card className="mb-6 p-4">
              <h2 className="mb-3 text-portal-sm font-semibold text-ink-900">By vendor</h2>
              <table className="w-full text-left text-portal-sm">
                <tbody>
                  {byVendor.map((row) => (
                    <tr key={row.vendor} className="border-t border-line">
                      <td className="py-1.5 pr-4 text-ink-500">{row.vendor}</td>
                      <td className="py-1.5 text-right tabular-nums text-ink-900">{formatPaisa(row.totalPaisa as Paisa)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>

            <Card className="p-4">
              <h2 className="mb-3 text-portal-sm font-semibold text-ink-900">Monthly trend</h2>
              <table className="w-full text-left text-portal-sm">
                <tbody>
                  {byMonth.map(([month, amount]) => (
                    <tr key={month} className="border-t border-line">
                      <td className="py-1.5 pr-4 text-ink-500">{month}</td>
                      <td className="py-1.5 text-right tabular-nums text-ink-900">{formatPaisa(amount as Paisa)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-2 text-portal-xs text-ink-300">
                Full amounts per month, exactly as recorded — never amortised (that spreading only
                applies to daily P&L; see `daily_expenses_amortized`, Part 14).
              </p>
            </Card>
          </>
        )}
      </div>
    </AppShell>
  );
}

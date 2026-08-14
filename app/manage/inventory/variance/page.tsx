"use client";

import { useMemo } from "react";
import { useStaffSession } from "@/lib/auth";
import { useBusinessDay } from "@/lib/business-day";
import { useStockVariance, type StockVarianceRow } from "@/lib/inventory";
import { formatPaisa, type Paisa } from "@/lib/money";
import { AppShell } from "@/components/ui/AppShell";
import { Card } from "@/components/ui/Card";
import { DataTable, type DataTableColumn } from "@/components/ui/DataTable";

const OUTLET_ID = process.env.NEXT_PUBLIC_SUPABASE_OUTLET_ID!;

const PORTAL_NAV = [
  { label: "Dashboard", href: "/reports/dashboard" },
  { label: "Master P&L", href: "/reports/pl" },
  { label: "Menu", href: "/manage/menu" },
  { label: "Inventory", href: "/manage/inventory" },
  { label: "Purchases", href: "/manage/purchases" },
  { label: "Expenses", href: "/manage/expenses" },
  { label: "Business day", href: "/manage/day" },
  { label: "House accounts", href: "/manage/house-accounts" },
];

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
  const { staff, loading: staffLoading, lock } = useStaffSession("manage");
  const { day } = useBusinessDay(OUTLET_ID);
  const { rows, loading } = useStockVariance(OUTLET_ID);

  const sorted = useMemo(
    () => [...rows].sort((a, b) => Math.abs(b.unexplained_variance_paisa) - Math.abs(a.unexplained_variance_paisa)),
    [rows]
  );
  const totalVariancePaisa = rows.reduce((sum, r) => sum + r.unexplained_variance_paisa, 0);

  const columns: DataTableColumn<StockVarianceRow>[] = [
    { key: "name", header: "Ingredient", sortValue: (r) => r.name, render: (r) => r.name },
    {
      key: "theoretical",
      header: "Theoretical used",
      align: "right",
      numeric: true,
      render: (r) => (
        <span className="text-ink-500">
          {Math.abs(r.theoretical_used)} {r.unit}
        </span>
      ),
    },
    {
      key: "declared",
      header: "Declared loss",
      align: "right",
      numeric: true,
      render: (r) => (
        <span className="text-ink-500">
          {Math.abs(r.declared_loss)} {r.unit}
        </span>
      ),
    },
    {
      key: "adjustment",
      header: "Count adjustment",
      align: "right",
      numeric: true,
      render: (r) => (
        <span className="text-ink-500">
          {r.count_adjustment} {r.unit}
        </span>
      ),
    },
    {
      key: "current",
      header: "Current stock",
      align: "right",
      numeric: true,
      render: (r) => (
        <span className="text-ink-500">
          {r.current_stock} {r.unit}
        </span>
      ),
    },
    {
      key: "variance",
      header: "Variance (Rs)",
      align: "right",
      numeric: true,
      sortValue: (r) => Math.abs(r.unexplained_variance_paisa),
      render: (r) => (
        <span
          className={`font-medium ${
            r.unexplained_variance_paisa < 0 ? "text-danger" : r.unexplained_variance_paisa > 0 ? "text-success" : "text-ink-500"
          }`}
        >
          {formatPaisa(r.unexplained_variance_paisa as Paisa)}
        </span>
      ),
    },
  ];

  if (staffLoading) return <div className="min-h-screen bg-canvas" />;

  if (staff && staff.role !== "owner" && staff.role !== "manager") {
    return <p className="p-8 text-portal-sm text-ink-500">Only Owner/Manager can view the variance report.</p>;
  }

  return (
    <AppShell
      density="portal"
      nav={PORTAL_NAV}
      crumbs={[{ label: "Inventory" }, { label: "Variance" }]}
      staff={staff}
      dayStatus={day?.status === "open" ? "open" : "closed"}
      onLock={lock}
    >
      <div className="p-4">
        <h1 className="mb-1 text-portal-xl font-semibold text-ink-900">Stock Variance Report</h1>
        <p className="mb-4 text-portal-sm text-ink-500">
          Total unexplained variance:{" "}
          <span className={totalVariancePaisa < 0 ? "text-danger" : "text-ink-700"}>
            {formatPaisa(totalVariancePaisa as Paisa)}
          </span>
        </p>

        <Card className="p-4">
          {loading ? (
            <p className="text-portal-sm text-ink-500">Loading…</p>
          ) : (
            <DataTable
              columns={columns}
              rows={sorted}
              keyExtractor={(r) => r.ingredient_id}
              emptyMessage="No variance data yet."
            />
          )}
        </Card>

        <p className="mt-4 text-portal-xs text-ink-500">
          Theoretical use = recipe × sales settled. Declared loss = wastage + staff meals logged.
          Count adjustment = every physical-count correction ever recorded — negative means stock
          vanished with no recipe line or wastage entry behind it.
        </p>
      </div>
    </AppShell>
  );
}

"use client";

import { useState } from "react";
import { useStaffSession } from "@/lib/auth";
import { useBusinessDay } from "@/lib/business-day";
import { useIngredientStock, recordStockCount, type IngredientStockRow } from "@/lib/inventory";
import { AppShell } from "@/components/ui/AppShell";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { DataTable, type DataTableColumn } from "@/components/ui/DataTable";

const OUTLET_ID = process.env.NEXT_PUBLIC_SUPABASE_OUTLET_ID!;
const CAN_COUNT = new Set(["owner", "manager"]);

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
 * Physical stock count — Part 11. A manager types what's actually on
 * the shelf; record_stock_count() compares it to the ledger's
 * theoretical total and writes exactly the difference as a
 * count_adjustment. That difference is this ingredient's unexplained
 * variance since the last count (see /manage/inventory/variance).
 */
export default function StockCountPage() {
  const { staff, loading: staffLoading, lock } = useStaffSession("manage");
  const { day } = useBusinessDay(OUTLET_ID);
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

  const columns: DataTableColumn<IngredientStockRow>[] = [
    { key: "name", header: "Ingredient", sortValue: (r) => r.name, render: (r) => r.name },
    {
      key: "system",
      header: "System stock",
      align: "right",
      numeric: true,
      render: (r) => (
        <span className="text-ink-500">
          {r.current_stock} {r.unit}
        </span>
      ),
    },
    {
      key: "counted",
      header: "Counted",
      render: (r) => (
        <Input
          type="number"
          step="0.001"
          value={counts[r.id] ?? ""}
          onChange={(e) => setCounts((c) => ({ ...c, [r.id]: e.target.value }))}
          className="w-28"
        />
      ),
    },
    {
      key: "variance",
      header: "Variance",
      render: (r) =>
        results[r.id] !== undefined && (
          <span className={results[r.id].variance !== 0 ? "text-warning" : "text-ink-500"}>
            {results[r.id].variance > 0 ? "+" : ""}
            {results[r.id].variance} {r.unit}
          </span>
        ),
    },
    {
      key: "actions",
      header: "",
      render: (r) => (
        <Button
          variant="primary"
          onClick={() => submitCount(r.id)}
          disabled={saving === r.id || !counts[r.id]}
        >
          {saving === r.id ? "Saving…" : "Submit"}
        </Button>
      ),
    },
  ];

  if (staffLoading) return <div className="min-h-screen bg-canvas" />;

  if (!canCount) {
    return <p className="p-8 text-portal-sm text-ink-500">Only Owner/Manager can record a stock count.</p>;
  }

  return (
    <AppShell
      density="portal"
      nav={PORTAL_NAV}
      crumbs={[{ label: "Inventory" }, { label: "Physical count" }]}
      staff={staff}
      dayStatus={day?.status === "open" ? "open" : "closed"}
      onLock={lock}
    >
      <div className="p-4">
        <h1 className="mb-1 text-portal-xl font-semibold text-ink-900">Physical Stock Count</h1>
        <p className="mb-4 text-portal-sm text-ink-500">
          Enter what&apos;s actually on the shelf for each ingredient. The system compares it to the
          ledger and records the difference.
        </p>

        {error && <p className="mb-4 text-portal-sm text-danger">{error}</p>}

        <Card className="p-4">
          {loading ? (
            <p className="text-portal-sm text-ink-500">Loading…</p>
          ) : (
            <DataTable columns={columns} rows={rows} keyExtractor={(r) => r.id} emptyMessage="No ingredients yet." />
          )}
        </Card>
      </div>
    </AppShell>
  );
}

"use client";

import { useEffect, useState } from "react";
import { useStaffSession } from "@/lib/auth";
import { useBusinessDay } from "@/lib/business-day";
import { createClient } from "@/lib/supabase/client";
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

interface PriceRow {
  id: string;
  menu_item_id: string;
  price_paisa: number;
  effective_from: string;
  effective_to: string | null;
  menu_items: { name: string } | null;
}

const columns: DataTableColumn<PriceRow>[] = [
  { key: "item", header: "Item", sortValue: (r) => r.menu_items?.name ?? r.menu_item_id, render: (r) => r.menu_items?.name ?? r.menu_item_id },
  { key: "price", header: "Price", numeric: true, render: (r) => formatPaisa(r.price_paisa as Paisa) },
  { key: "from", header: "From", sortValue: (r) => r.effective_from, render: (r) => r.effective_from },
  { key: "to", header: "To", render: (r) => <span className="text-ink-500">{r.effective_to ?? "current"}</span> },
];

/**
 * Owner-only price history: every price a menu item has ever had, and
 * the date range each one was actually charged. Matches Part 08's
 * feature table ("Price history dekhna | Owner") and RLS's
 * `manage_prices`/`read_prices` policies (Part 04) — a non-owner landing
 * here directly would still only see what those policies allow, this
 * page just doesn't bother rendering for them.
 */
export default function PriceHistoryPage() {
  const { staff, loading: staffLoading, lock } = useStaffSession("manage");
  const { day } = useBusinessDay(OUTLET_ID);
  const [rows, setRows] = useState<PriceRow[] | null>(null);

  useEffect(() => {
    if (!staff || staff.role !== "owner") return;
    const supabase = createClient();
    supabase
      .from("menu_item_prices")
      .select("id, menu_item_id, price_paisa, effective_from, effective_to, menu_items(name)")
      .order("effective_from", { ascending: false })
      .then(({ data }) => setRows((data as unknown as PriceRow[]) ?? []));
  }, [staff]);

  if (staffLoading) return <div className="min-h-screen bg-canvas" />;

  if (!staff || staff.role !== "owner") {
    return <p className="p-8 text-portal-sm text-ink-500">Only the Owner can view price history.</p>;
  }

  return (
    <AppShell
      density="portal"
      nav={PORTAL_NAV}
      crumbs={[{ label: "Menu" }, { label: "Price history" }]}
      staff={staff}
      dayStatus={day?.status === "open" ? "open" : "closed"}
      onLock={lock}
    >
      <div className="p-4">
        <h1 className="mb-4 text-portal-xl font-semibold text-ink-900">Price History</h1>

        <Card className="p-4">
          {!rows ? (
            <p className="text-portal-sm text-ink-500">Loading…</p>
          ) : (
            <DataTable columns={columns} rows={rows} keyExtractor={(r) => r.id} emptyMessage="No price changes yet." />
          )}
        </Card>
      </div>
    </AppShell>
  );
}

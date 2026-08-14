"use client";

import { useEffect, useMemo, useState } from "react";
import { useStaffSession } from "@/lib/auth";
import { useBusinessDay } from "@/lib/business-day";
import { useStockVariance } from "@/lib/inventory";
import {
  fetchDailyPl,
  fetchProductPerformance,
  fetchCashVarianceByCashier,
  fetchVoidByCashier,
  fetchReprintSummary,
  fetchLabourCost,
  fetchLabourCostHourly,
  fetchIngredientCostTrend,
  classifyMenuItems,
  flagCashVariance,
  flagStockVariance,
  flagVoidValue,
  flagLowMarginItems,
  flagIngredientCostIncrease,
  flagNetLoss,
  labourCostPercent,
  sumBy,
  type DailyPlRow,
  type ProductPerformanceRow,
  type CashVarianceByCashierRow,
  type VoidByCashierRow,
  type ReprintSummaryRow,
  type LabourCostRow,
  type IngredientCostTrendRow,
  type Flag,
} from "@/lib/reports";
import { startOfMonthIso, todayIso } from "@/lib/date-range";
import { Money } from "@/components/ui/Money";
import { DataTable, type DataTableColumn } from "@/components/ui/DataTable";
import { KpiTile } from "@/components/reports/kpi-tile";
import { DateRangePicker } from "@/components/reports/date-range-picker";
import { FlagsPanel } from "@/components/reports/flags-panel";
import { MenuMatrixChart } from "@/components/reports/menu-matrix-chart";
import { QUADRANT_LABEL, QUADRANT_ACTION } from "@/lib/reports";
import { AppShell } from "@/components/ui/AppShell";
import { Card } from "@/components/ui/Card";
import { FilterBar } from "@/components/ui/FilterBar";

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

/** YYYY-MM-DD -> YYYY-MM, for the month-wise rollup table. */
function monthOf(businessDate: string): string {
  return businessDate.slice(0, 7);
}

/**
 * Master P&L — Part 18 §3, owner only. "RLS + PIN dono se": the PIN side
 * is `useStaffSession("pl")` (Part 07's 5-minute idle re-lock,
 * unchanged), the RLS side is that every view fetched here
 * (product_performance, cash/void-by-cashier, reprint_summary,
 * labour_cost_daily, ingredient_cost_trend) returns literally zero rows
 * for anyone whose session isn't `has_role('owner')` — see
 * 0028_reports_views.sql. The role check below is a fast, honest UI
 * message; it is not what actually keeps this data private.
 */
export default function MasterPlPage() {
  const { staff, loading: staffLoading, lock } = useStaffSession("pl");
  const { day } = useBusinessDay(OUTLET_ID);
  const stockVariance = useStockVariance(OUTLET_ID);

  const [from, setFrom] = useState(startOfMonthIso());
  const [to, setTo] = useState(todayIso());
  const [loading, setLoading] = useState(true);

  const [dailyPl, setDailyPl] = useState<DailyPlRow[]>([]);
  const [productPerformance, setProductPerformance] = useState<ProductPerformanceRow[]>([]);
  const [cashVariance, setCashVariance] = useState<CashVarianceByCashierRow[]>([]);
  const [voidByCashier, setVoidByCashier] = useState<VoidByCashierRow[]>([]);
  const [reprintSummary, setReprintSummary] = useState<ReprintSummaryRow[]>([]);
  const [labourCost, setLabourCost] = useState<LabourCostRow[]>([]);
  const [labourCostHourly, setLabourCostHourly] = useState<LabourCostRow[]>([]);
  const [ingredientCostTrend, setIngredientCostTrend] = useState<IngredientCostTrendRow[]>([]);

  const isOwner = staff?.role === "owner";

  useEffect(() => {
    if (!isOwner) return;
    let mounted = true;
    setLoading(true);
    Promise.all([
      fetchDailyPl(OUTLET_ID, from, to),
      fetchProductPerformance(OUTLET_ID, from, to),
      fetchCashVarianceByCashier(OUTLET_ID, from, to),
      fetchVoidByCashier(OUTLET_ID, from, to),
      fetchReprintSummary(OUTLET_ID, from, to),
      fetchLabourCost(OUTLET_ID, from, to),
      fetchLabourCostHourly(OUTLET_ID, from, to),
      fetchIngredientCostTrend(OUTLET_ID),
    ]).then(([pl, pp, cash, voids, reprints, labour, labourHourly, ingredientCost]) => {
      if (!mounted) return;
      setDailyPl(pl);
      setProductPerformance(pp);
      setCashVariance(cash);
      setVoidByCashier(voids);
      setReprintSummary(reprints);
      setLabourCost(labour);
      setLabourCostHourly(labourHourly);
      setIngredientCostTrend(ingredientCost);
      setLoading(false);
    });
    return () => {
      mounted = false;
    };
  }, [from, to, isOwner]);

  const menuItems = useMemo(() => classifyMenuItems(productPerformance), [productPerformance]);

  const revenueByDate = useMemo(() => new Map(dailyPl.map((d) => [d.business_date, d.revenue_paisa])), [dailyPl]);
  const totalRevenuePaisa = useMemo(() => sumBy(dailyPl, (r) => r.revenue_paisa), [dailyPl]);
  // Total labour cost = amortised salary expenses (existing) + hourly-
  // worked cost from the time clock (Patch 2) — a staff member is
  // either salaried or hourly-rated, never both, so this never double-
  // counts. labourCost/labourCostHourly themselves are untouched.
  const totalLabourPaisa = useMemo(
    () => sumBy(labourCost, (r) => r.labour_cost_paisa) + sumBy(labourCostHourly, (r) => r.labour_cost_paisa),
    [labourCost, labourCostHourly]
  );
  const labourPercent = labourCostPercent(totalLabourPaisa, totalRevenuePaisa);

  const monthlyPl = useMemo(() => {
    const byMonth = new Map<string, DailyPlRow>();
    for (const d of dailyPl) {
      const key = monthOf(d.business_date);
      const acc = byMonth.get(key) ?? {
        business_date: key,
        orders: 0,
        revenue_paisa: 0,
        cogs_paisa: 0,
        tax_paisa: 0,
        gross_profit_paisa: 0,
        voided_orders: 0,
        voided_value_paisa: 0,
      };
      acc.orders += d.orders;
      acc.revenue_paisa += d.revenue_paisa;
      acc.cogs_paisa += d.cogs_paisa;
      acc.tax_paisa += d.tax_paisa;
      acc.gross_profit_paisa += d.gross_profit_paisa;
      acc.voided_orders += d.voided_orders;
      acc.voided_value_paisa += d.voided_value_paisa;
      byMonth.set(key, acc);
    }
    return [...byMonth.values()].sort((a, b) => b.business_date.localeCompare(a.business_date));
  }, [dailyPl]);

  const flags: Flag[] = useMemo(() => {
    const netLossFlags = dailyPl
      .map((d) => {
        const dayLabourPaisa =
          sumBy(labourCost.filter((l) => l.business_date === d.business_date), (r) => r.labour_cost_paisa) +
          sumBy(labourCostHourly.filter((l) => l.business_date === d.business_date), (r) => r.labour_cost_paisa);
        return flagNetLoss(d, dayLabourPaisa);
      })
      .filter((f): f is Flag => f !== null);
    return [
      ...netLossFlags,
      ...flagCashVariance(cashVariance),
      ...flagStockVariance(stockVariance.rows),
      ...flagVoidValue(voidByCashier, revenueByDate),
      ...flagLowMarginItems(menuItems),
      ...flagIngredientCostIncrease(ingredientCostTrend),
    ];
  }, [dailyPl, labourCost, labourCostHourly, cashVariance, stockVariance.rows, voidByCashier, revenueByDate, menuItems, ingredientCostTrend]);

  if (staffLoading) return <div className="min-h-screen bg-canvas" />;

  if (!isOwner) {
    return <p className="p-8 text-portal-sm text-ink-500">Master P&amp;L is owner-only.</p>;
  }

  const menuColumns: DataTableColumn<(typeof menuItems)[number]>[] = [
    { key: "name", header: "Item", render: (r) => r.name, sortValue: (r) => r.name },
    { key: "quadrant", header: "Quadrant", render: (r) => QUADRANT_LABEL[r.quadrant] },
    { key: "qty", header: "Sold", align: "right", numeric: true, render: (r) => r.qty, sortValue: (r) => r.qty },
    {
      key: "margin",
      header: "Margin %",
      align: "right",
      numeric: true,
      render: (r) => `${r.marginPercent.toFixed(1)}%`,
      sortValue: (r) => r.marginPercent,
    },
    {
      key: "revenue",
      header: "Revenue",
      align: "right",
      numeric: true,
      render: (r) => <Money paisa={r.revenuePaisa} />,
      sortValue: (r) => r.revenuePaisa,
    },
    { key: "action", header: "Suggested action", render: (r) => QUADRANT_ACTION[r.quadrant] },
  ];

  const stockColumns: DataTableColumn<(typeof stockVariance.rows)[number]>[] = [
    { key: "name", header: "Ingredient", render: (r) => r.name, sortValue: (r) => r.name },
    {
      key: "theoretical",
      header: "Theoretical used",
      align: "right",
      numeric: true,
      render: (r) => `${r.theoretical_used} ${r.unit}`,
      sortValue: (r) => r.theoretical_used,
    },
    {
      key: "adjustment",
      header: "Count adjustment",
      align: "right",
      numeric: true,
      render: (r) => `${r.count_adjustment} ${r.unit}`,
      sortValue: (r) => r.count_adjustment,
    },
    {
      key: "variance",
      header: "Unexplained (Rs)",
      align: "right",
      numeric: true,
      render: (r) => <Money paisa={r.unexplained_variance_paisa} />,
      sortValue: (r) => r.unexplained_variance_paisa,
    },
  ];

  const cashColumns: DataTableColumn<CashVarianceByCashierRow>[] = [
    { key: "cashier", header: "Cashier", render: (r) => r.cashier_name, sortValue: (r) => r.cashier_name },
    { key: "date", header: "Date", render: (r) => r.business_date, sortValue: (r) => r.business_date },
    { key: "shifts", header: "Shifts", align: "right", numeric: true, render: (r) => r.shifts },
    {
      key: "variance",
      header: "Total variance",
      align: "right",
      numeric: true,
      render: (r) => <Money paisa={r.total_variance_paisa} />,
      sortValue: (r) => r.total_variance_paisa,
    },
    { key: "over", header: "Over Rs 500", align: "right", numeric: true, render: (r) => r.shifts_over_threshold },
  ];

  const voidColumns: DataTableColumn<VoidByCashierRow>[] = [
    { key: "cashier", header: "Cashier", render: (r) => r.cashier_name, sortValue: (r) => r.cashier_name },
    { key: "date", header: "Date", render: (r) => r.business_date, sortValue: (r) => r.business_date },
    { key: "count", header: "Voids", align: "right", numeric: true, render: (r) => r.void_count, sortValue: (r) => r.void_count },
    {
      key: "value",
      header: "Value",
      align: "right",
      numeric: true,
      render: (r) => <Money paisa={r.void_value_paisa} />,
      sortValue: (r) => r.void_value_paisa,
    },
  ];

  const reprintColumns: DataTableColumn<ReprintSummaryRow>[] = [
    { key: "staff", header: "Staff", render: (r) => r.staff_name ?? "—" },
    { key: "date", header: "Date", render: (r) => r.business_date },
    { key: "total", header: "Total prints", align: "right", numeric: true, render: (r) => r.total_prints },
    { key: "reprints", header: "Reprints", align: "right", numeric: true, render: (r) => r.reprint_count },
  ];

  const dailyColumns: DataTableColumn<DailyPlRow>[] = [
    { key: "date", header: "Date", render: (r) => r.business_date, sortValue: (r) => r.business_date },
    { key: "orders", header: "Orders", align: "right", numeric: true, render: (r) => r.orders },
    {
      key: "revenue",
      header: "Revenue",
      align: "right",
      numeric: true,
      render: (r) => <Money paisa={r.revenue_paisa} />,
      sortValue: (r) => r.revenue_paisa,
    },
    {
      key: "cogs",
      header: "COGS",
      align: "right",
      numeric: true,
      render: (r) => <Money paisa={r.cogs_paisa} />,
      sortValue: (r) => r.cogs_paisa,
    },
    {
      key: "gross",
      header: "Gross profit",
      align: "right",
      numeric: true,
      render: (r) => <Money paisa={r.gross_profit_paisa} />,
      sortValue: (r) => r.gross_profit_paisa,
    },
    { key: "voided", header: "Voided", align: "right", numeric: true, render: (r) => r.voided_orders },
  ];

  return (
    <AppShell
      density="portal"
      nav={PORTAL_NAV}
      crumbs={[{ label: "Reports" }, { label: "Master P&L" }]}
      staff={staff}
      dayStatus={day?.status === "open" ? "open" : "closed"}
      onLock={lock}
    >
      <div className="px-4 pt-4">
        <h1 className="text-portal-xl font-semibold text-ink-900">Master P&amp;L</h1>
      </div>

      <FilterBar>
        <DateRangePicker
          from={from}
          to={to}
          onChange={(f, t) => {
            setFrom(f);
            setTo(t);
          }}
        />
      </FilterBar>

      <div className="p-4">
        {loading ? (
          <p className="text-portal-sm text-ink-500">Loading…</p>
        ) : (
          <>
            <section className="mb-8 grid grid-cols-2 gap-4 sm:grid-cols-3">
              <KpiTile label="Revenue" value={<Money paisa={totalRevenuePaisa} />} />
              <KpiTile label="Labour cost" value={<Money paisa={totalLabourPaisa} />} />
              <KpiTile
                label="Labour cost %"
                value={labourPercent === null ? "—" : `${labourPercent.toFixed(1)}%`}
                hint="Salaries + Daily Wages ÷ revenue"
              />
            </section>

            <Card className="mb-8 p-4">
              <h2 className="mb-3 text-portal-sm font-semibold text-ink-900">Flags</h2>
              <FlagsPanel flags={flags} />
            </Card>

            <Card className="mb-8 p-4">
              <h2 className="mb-1 text-portal-sm font-semibold text-ink-900">Menu Engineering Matrix</h2>
              <p className="mb-3 text-portal-xs text-ink-500">
                Popularity (units sold) vs. margin %, split at this range&apos;s own median of each.
              </p>
              <MenuMatrixChart items={menuItems} />
              <div className="mt-4 overflow-x-auto">
                <DataTable columns={menuColumns} rows={menuItems} keyExtractor={(r) => r.menuItemId} />
              </div>
            </Card>

            <Card className="mb-8 p-4">
              <h2 className="mb-3 text-portal-sm font-semibold text-ink-900">Stock variance (Rs)</h2>
              <div className="overflow-x-auto">
                <DataTable columns={stockColumns} rows={stockVariance.rows} keyExtractor={(r) => r.ingredient_id} />
              </div>
            </Card>

            <section className="mb-8 grid grid-cols-1 gap-6 lg:grid-cols-2">
              <Card className="p-4">
                <h2 className="mb-3 text-portal-sm font-semibold text-ink-900">Cash variance by cashier</h2>
                <div className="overflow-x-auto">
                  <DataTable
                    columns={cashColumns}
                    rows={cashVariance}
                    keyExtractor={(r) => `${r.cashier_id}-${r.business_date}`}
                  />
                </div>
              </Card>
              <Card className="p-4">
                <h2 className="mb-3 text-portal-sm font-semibold text-ink-900">Void analysis by cashier</h2>
                <div className="overflow-x-auto">
                  <DataTable
                    columns={voidColumns}
                    rows={voidByCashier}
                    keyExtractor={(r) => `${r.cashier_id}-${r.business_date}`}
                  />
                </div>
              </Card>
            </section>

            <Card className="mb-8 p-4">
              <h2 className="mb-3 text-portal-sm font-semibold text-ink-900">Reprints</h2>
              <p className="mb-3 text-portal-xs text-ink-500">
                Empty until Part 19 wires an actual Print button to record_invoice_print().
              </p>
              <div className="overflow-x-auto">
                <DataTable
                  columns={reprintColumns}
                  rows={reprintSummary}
                  keyExtractor={(r) => `${r.printed_by ?? "unknown"}-${r.business_date}`}
                />
              </div>
            </Card>

            <section className="mb-8 grid grid-cols-1 gap-6 lg:grid-cols-2">
              <Card className="p-4">
                <h2 className="mb-3 text-portal-sm font-semibold text-ink-900">Day-wise P&amp;L</h2>
                <div className="overflow-x-auto">
                  <DataTable columns={dailyColumns} rows={dailyPl} keyExtractor={(r) => r.business_date} />
                </div>
              </Card>
              <Card className="p-4">
                <h2 className="mb-3 text-portal-sm font-semibold text-ink-900">Month-wise P&amp;L</h2>
                <div className="overflow-x-auto">
                  <DataTable columns={dailyColumns} rows={monthlyPl} keyExtractor={(r) => r.business_date} />
                </div>
              </Card>
            </section>
          </>
        )}
      </div>
    </AppShell>
  );
}

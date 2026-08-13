"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useStaffSession } from "@/lib/auth";
import { useBusinessDay } from "@/lib/business-day";
import { useIngredientStock } from "@/lib/inventory";
import { fetchTicketTimeSamples, averageTicketMinutes } from "@/lib/kds";
import {
  fetchDailyPl,
  fetchHourlySales,
  fetchPaymentMix,
  fetchTaxSummary,
  fetchItemRevenue,
  fetchCategoryRevenue,
  fetchDailyAmortizedExpenses,
  sumBy,
  type DailyPlRow,
  type HourlySalesRow,
  type PaymentMixRow,
  type TaxSummaryRow,
  type ItemRevenueRow,
  type CategoryRevenueRow,
} from "@/lib/reports";
import { todayIso } from "@/lib/date-range";
import { Money } from "@/components/ui/Money";
import { KpiTile } from "@/components/reports/kpi-tile";
import { DateRangePicker } from "@/components/reports/date-range-picker";
import { HourlyHeatmap } from "@/components/reports/hourly-heatmap";
import { PaymentMixChart } from "@/components/reports/payment-mix-chart";
import { RevenueBarChart, type RevenueBarDatum } from "@/components/reports/revenue-bar-chart";
import { ExportPanel } from "@/components/reports/export-panel";
import { AppShell } from "@/components/ui/AppShell";
import { Card } from "@/components/ui/Card";
import { FilterBar } from "@/components/ui/FilterBar";

const PORTAL_NAV = [
  { label: "Dashboard", href: "/reports/dashboard" },
  { label: "Master P&L", href: "/reports/pl" },
  { label: "Menu", href: "/manage/menu" },
  { label: "Inventory", href: "/manage/inventory" },
  { label: "Purchases", href: "/manage/purchases" },
  { label: "Expenses", href: "/manage/expenses" },
  { label: "Business day", href: "/manage/day" },
];

const OUTLET_ID = process.env.NEXT_PUBLIC_SUPABASE_OUTLET_ID!;

function topN(rows: { label: string; revenuePaisa: number }[], n: number): RevenueBarDatum[] {
  const byLabel = new Map<string, number>();
  rows.forEach((r) => byLabel.set(r.label, (byLabel.get(r.label) ?? 0) + r.revenuePaisa));
  return [...byLabel.entries()]
    .map(([label, revenuePaisa]) => ({ label, revenuePaisa }))
    .sort((a, b) => b.revenuePaisa - a.revenuePaisa)
    .slice(0, n);
}

/**
 * Manager Dashboard — Part 18 §2. Every number here comes from a
 * server-side view (lib/reports.ts), scoped to the selected date range
 * — never the raw orders table loaded row-by-row into the browser (the
 * brief's own "yeh mat karna" #2). "Asli gross profit" replaces the old
 * system's flat PROFIT_RATE = 0.40 with order_items.unit_cost_paisa's
 * real per-line cost (Part 09), rolled up through daily_pl.
 */
export default function DashboardPage() {
  const { staff, loading: staffLoading, lock } = useStaffSession("manage");
  const { day } = useBusinessDay(OUTLET_ID);
  const stock = useIngredientStock(OUTLET_ID);

  const [from, setFrom] = useState(todayIso());
  const [to, setTo] = useState(todayIso());
  const [loading, setLoading] = useState(true);
  const [dailyPl, setDailyPl] = useState<DailyPlRow[]>([]);
  const [hourly, setHourly] = useState<HourlySalesRow[]>([]);
  const [paymentMix, setPaymentMix] = useState<PaymentMixRow[]>([]);
  const [taxSummary, setTaxSummary] = useState<TaxSummaryRow[]>([]);
  const [itemRevenue, setItemRevenue] = useState<ItemRevenueRow[]>([]);
  const [categoryRevenue, setCategoryRevenue] = useState<CategoryRevenueRow[]>([]);
  const [amortizedByDate, setAmortizedByDate] = useState<Map<string, number>>(new Map());
  const [avgTicketMinutes, setAvgTicketMinutes] = useState<number | null>(null);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    Promise.all([
      fetchDailyPl(OUTLET_ID, from, to),
      fetchHourlySales(OUTLET_ID, from, to),
      fetchPaymentMix(OUTLET_ID, from, to),
      fetchTaxSummary(OUTLET_ID, from, to),
      fetchItemRevenue(OUTLET_ID, from, to),
      fetchCategoryRevenue(OUTLET_ID, from, to),
      fetchDailyAmortizedExpenses(OUTLET_ID, from, to),
    ]).then(([pl, h, pm, tax, items, cats, amortized]) => {
      if (!mounted) return;
      setDailyPl(pl);
      setHourly(h);
      setPaymentMix(pm);
      setTaxSummary(tax);
      setItemRevenue(items);
      setCategoryRevenue(cats);
      setAmortizedByDate(amortized);
      setLoading(false);
    });
    return () => {
      mounted = false;
    };
  }, [from, to]);

  useEffect(() => {
    if (!day) return;
    let mounted = true;
    fetchTicketTimeSamples(OUTLET_ID, day.id).then(({ tickets }) => {
      if (mounted) setAvgTicketMinutes(averageTicketMinutes(tickets));
    });
    return () => {
      mounted = false;
    };
  }, [day]);

  const revenuePaisa = useMemo(() => sumBy(dailyPl, (r) => r.revenue_paisa), [dailyPl]);
  const cogsPaisa = useMemo(() => sumBy(dailyPl, (r) => r.cogs_paisa), [dailyPl]);
  const grossProfitPaisa = useMemo(() => sumBy(dailyPl, (r) => r.gross_profit_paisa), [dailyPl]);
  const ordersCount = useMemo(() => sumBy(dailyPl, (r) => r.orders), [dailyPl]);
  const voidedOrders = useMemo(() => sumBy(dailyPl, (r) => r.voided_orders), [dailyPl]);
  const voidedValuePaisa = useMemo(() => sumBy(dailyPl, (r) => r.voided_value_paisa), [dailyPl]);
  const amortizedTotalPaisa = useMemo(
    () => [...amortizedByDate.values()].reduce((a, b) => a + b, 0),
    [amortizedByDate]
  );
  const netProfitPaisa = grossProfitPaisa - amortizedTotalPaisa;
  const aov = ordersCount > 0 ? revenuePaisa / ordersCount : 0;

  const gstByClass = useMemo(() => {
    const cash = sumBy(
      taxSummary.filter((t) => t.class === "cash"),
      (r) => r.tax_paisa
    );
    const digital = sumBy(
      taxSummary.filter((t) => t.class === "digital"),
      (r) => r.tax_paisa
    );
    return { cash, digital };
  }, [taxSummary]);

  const topItems = useMemo(
    () => topN(itemRevenue.map((r) => ({ label: r.name_snapshot, revenuePaisa: r.revenue_paisa })), 8),
    [itemRevenue]
  );
  const topCategories = useMemo(
    () => topN(categoryRevenue.map((r) => ({ label: r.category_name, revenuePaisa: r.revenue_paisa })), 8),
    [categoryRevenue]
  );

  const lowStock = stock.rows.filter((r) => r.is_low);

  if (staffLoading) return <div className="min-h-screen bg-canvas" />;

  if (staff && !["owner", "manager", "supervisor"].includes(staff.role)) {
    return <p className="p-8 text-portal-sm text-ink-500">Only Owner/Manager/Supervisor can view the dashboard.</p>;
  }

  return (
    <AppShell
      density="portal"
      nav={PORTAL_NAV}
      crumbs={[{ label: "Reports" }, { label: "Dashboard" }]}
      staff={staff}
      dayStatus={day?.status === "open" ? "open" : "closed"}
      onLock={lock}
    >
      <div className="flex items-center justify-between px-4 pt-4">
        <h1 className="text-portal-xl font-semibold text-ink-900">Dashboard</h1>
        {staff?.role === "owner" && (
          <Link href="/reports/pl" className="text-portal-sm text-brand-700 hover:underline">
            Master P&amp;L →
          </Link>
        )}
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
            <section className="mb-8 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
              <KpiTile label="Revenue (ex-GST)" value={<Money paisa={revenuePaisa} />} />
              <KpiTile
                label="GST collected"
                value={<Money paisa={gstByClass.cash + gstByClass.digital} />}
                hint={`Cash 16%: Rs ${(gstByClass.cash / 100).toFixed(2)} · Digital 8%: Rs ${(gstByClass.digital / 100).toFixed(2)}`}
              />
              <KpiTile label="Gross profit" value={<Money paisa={grossProfitPaisa} />} hint="Revenue − real COGS" />
              <KpiTile label="Amortised expenses" value={<Money paisa={amortizedTotalPaisa} />} />
              <KpiTile
                label="Net profit"
                value={<Money paisa={netProfitPaisa} className={netProfitPaisa < 0 ? "text-danger" : ""} />}
              />
              <KpiTile label="Orders" value={ordersCount} />
              <KpiTile label="Average order value" value={<Money paisa={aov} />} />
              <KpiTile
                label="Avg. ticket time (today)"
                value={avgTicketMinutes === null ? "—" : `${avgTicketMinutes.toFixed(1)} min`}
                hint="Kitchen prep time, today's open day"
              />
              <KpiTile
                label="Voids"
                value={voidedOrders}
                hint={voidedOrders > 0 ? `Value: Rs ${(voidedValuePaisa / 100).toFixed(2)}` : undefined}
              />
              <KpiTile label="Low stock items" value={lowStock.length} hint={lowStock.map((i) => i.name).join(", ") || undefined} />
              <KpiTile label="COGS" value={<Money paisa={cogsPaisa} />} />
            </section>

            <section className="mb-8 grid grid-cols-1 gap-6 lg:grid-cols-2">
              <Card className="p-4">
                <h2 className="mb-3 text-portal-base font-semibold text-ink-900">Hourly sales (orders)</h2>
                <HourlyHeatmap rows={hourly} />
              </Card>
              <Card className="p-4">
                <h2 className="mb-3 text-portal-base font-semibold text-ink-900">Payment mix</h2>
                <PaymentMixChart rows={paymentMix} />
              </Card>
            </section>

            <section className="mb-8 grid grid-cols-1 gap-6 lg:grid-cols-2">
              <Card className="p-4">
                <h2 className="mb-3 text-portal-base font-semibold text-ink-900">Top items by revenue</h2>
                <RevenueBarChart data={topItems} />
              </Card>
              <Card className="p-4">
                <h2 className="mb-3 text-portal-base font-semibold text-ink-900">Category revenue</h2>
                <RevenueBarChart data={topCategories} />
              </Card>
            </section>

            <Card className="p-4">
              <h2 className="mb-3 text-portal-base font-semibold text-ink-900">Export</h2>
              <ExportPanel outletId={OUTLET_ID} from={from} to={to} />
            </Card>
          </>
        )}
      </div>
    </AppShell>
  );
}

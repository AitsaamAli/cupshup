"use client";

import { createClient } from "@/lib/supabase/client";
import { castRows } from "@/lib/supabase/rows";

// =======================================================================
// Cup Shup POS — Part 18 report data layer.
//
// Every fetch here reads a Postgres VIEW (supabase/migrations/0028_
// reports_views.sql) scoped by a date range, never the raw orders/
// order_items tables directly — "Har order browser mein load karna"
// (loading every order into the browser) is explicitly the brief's own
// "yeh mat karna" #2. The server aggregates; the browser only ever
// receives already-summed rows, one per business_date (or per
// business_date x cashier/item/hour), which stays small regardless of
// how many orders that day actually had.
//
// The owner-only views (product_performance, cash/void-by-cashier,
// reprint_summary, labour_cost_daily, ingredient_cost_trend) simply come
// back empty for a non-owner session — see 0028_reports_views.sql's
// header comment for why that's a real database-level gate, not just
// this file choosing not to call them.
// =======================================================================

export interface DailyPlRow {
  business_date: string;
  orders: number;
  revenue_paisa: number;
  cogs_paisa: number;
  tax_paisa: number;
  gross_profit_paisa: number;
  voided_orders: number;
  voided_value_paisa: number;
}

export interface ProductPerformanceRow {
  business_date: string;
  menu_item_id: string;
  name_snapshot: string;
  qty: number;
  revenue_paisa: number;
  cogs_paisa: number;
  margin_paisa: number;
}

export interface ItemRevenueRow {
  business_date: string;
  menu_item_id: string;
  name_snapshot: string;
  qty: number;
  revenue_paisa: number;
}

export interface CategoryRevenueRow {
  business_date: string;
  category_id: string;
  category_name: string;
  qty: number;
  revenue_paisa: number;
}

export interface HourlySalesRow {
  business_date: string;
  hour_of_day: number;
  orders: number;
  revenue_paisa: number;
}

export interface PaymentMixRow {
  business_date: string;
  method: string;
  payments: number;
  amount_paisa: number;
}

export interface TaxSummaryRow {
  business_date: string;
  class: "cash" | "digital";
  payments: number;
  base_paisa: number;
  tax_paisa: number;
  amount_paisa: number;
}

export interface CashVarianceByCashierRow {
  business_date: string;
  cashier_id: string;
  cashier_name: string;
  shifts: number;
  total_variance_paisa: number;
  avg_variance_paisa: number;
  shifts_over_threshold: number;
}

export interface VoidByCashierRow {
  business_date: string;
  cashier_id: string;
  cashier_name: string;
  void_count: number;
  void_value_paisa: number;
}

export interface ReprintSummaryRow {
  business_date: string;
  printed_by: string | null;
  staff_name: string | null;
  reprint_count: number;
  total_prints: number;
}

export interface LabourCostRow {
  business_date: string;
  labour_cost_paisa: number;
}

export interface IngredientCostTrendRow {
  ingredient_id: string;
  name: string;
  current_cost_paisa: number;
  prior_cost_paisa: number | null;
}

async function fetchDateRanged<T>(
  view: string,
  outletId: string,
  fromDate: string,
  toDate: string
): Promise<T[]> {
  const supabase = createClient();
  const { data } = await supabase
    .from(view)
    .select("*")
    .eq("outlet_id", outletId)
    .gte("business_date", fromDate)
    .lte("business_date", toDate);
  return castRows<T>(data);
}

export const fetchDailyPl = (o: string, f: string, t: string) => fetchDateRanged<DailyPlRow>("daily_pl", o, f, t);
export const fetchProductPerformance = (o: string, f: string, t: string) =>
  fetchDateRanged<ProductPerformanceRow>("product_performance", o, f, t);
export const fetchItemRevenue = (o: string, f: string, t: string) =>
  fetchDateRanged<ItemRevenueRow>("item_revenue_daily", o, f, t);
export const fetchCategoryRevenue = (o: string, f: string, t: string) =>
  fetchDateRanged<CategoryRevenueRow>("category_revenue_daily", o, f, t);
export const fetchHourlySales = (o: string, f: string, t: string) =>
  fetchDateRanged<HourlySalesRow>("hourly_sales", o, f, t);
export const fetchPaymentMix = (o: string, f: string, t: string) =>
  fetchDateRanged<PaymentMixRow>("payment_mix_daily", o, f, t);
export const fetchTaxSummary = (o: string, f: string, t: string) =>
  fetchDateRanged<TaxSummaryRow>("tax_summary_daily", o, f, t);
export const fetchCashVarianceByCashier = (o: string, f: string, t: string) =>
  fetchDateRanged<CashVarianceByCashierRow>("cash_variance_by_cashier", o, f, t);
export const fetchVoidByCashier = (o: string, f: string, t: string) =>
  fetchDateRanged<VoidByCashierRow>("void_analysis_by_cashier", o, f, t);
export const fetchReprintSummary = (o: string, f: string, t: string) =>
  fetchDateRanged<ReprintSummaryRow>("reprint_summary", o, f, t);
export const fetchLabourCost = (o: string, f: string, t: string) =>
  fetchDateRanged<LabourCostRow>("labour_cost_daily", o, f, t);

/** Not date-ranged — one row per active ingredient, current vs. 30-90
 * days ago (0028_reports_views.sql). */
export async function fetchIngredientCostTrend(outletId: string): Promise<IngredientCostTrendRow[]> {
  const supabase = createClient();
  const { data } = await supabase.from("ingredient_cost_trend").select("*").eq("outlet_id", outletId);
  return castRows<IngredientCostTrendRow>(data);
}

/** Total amortised expenses (every category, not just labour) per
 * business_date — what "Net profit" on the Dashboard subtracts from
 * daily_pl's gross_profit_paisa. Reuses Part 14's daily_expenses_amortized
 * view directly rather than re-deriving amortisation here; that view
 * already restricts to owner/manager/supervisor via expenses' own
 * read_expenses RLS policy (Part 04), so no extra has_role() gate is
 * needed on this query. */
export async function fetchDailyAmortizedExpenses(
  outletId: string,
  fromDate: string,
  toDate: string
): Promise<Map<string, number>> {
  const supabase = createClient();
  const { data } = await supabase
    .from("daily_expenses_amortized")
    .select("expense_date, amortized_amount_paisa")
    .eq("outlet_id", outletId)
    .gte("expense_date", fromDate)
    .lte("expense_date", toDate);
  const rows = castRows<{ expense_date: string; amortized_amount_paisa: number }>(data);
  const byDate = new Map<string, number>();
  for (const r of rows) byDate.set(r.expense_date, (byDate.get(r.expense_date) ?? 0) + r.amortized_amount_paisa);
  return byDate;
}

// =======================================================================
// Pure calculations — all testable without a database (tests/reports.test.ts)
// =======================================================================

/** Sums a numeric field across day rows. Small helper — every report
 * page needs "total X across the selected range" repeatedly. */
export function sumBy<T>(rows: T[], pick: (row: T) => number): number {
  return rows.reduce((total, row) => total + pick(row), 0);
}

export interface HourlyBucket {
  hour: number;
  orders: number;
  revenuePaisa: number;
}

/** Collapses hourly_sales rows (one per business_date x hour_of_day)
 * down to one total per hour-of-day across the whole selected range —
 * the heatmap answers "which hour is busiest overall", not "which hour
 * on which specific day". Always returns all 24 hours, zero-filled, so
 * the heatmap grid never has a gap. */
export function aggregateHourly(rows: HourlySalesRow[]): HourlyBucket[] {
  const buckets = new Map<number, HourlyBucket>();
  for (let h = 0; h < 24; h++) buckets.set(h, { hour: h, orders: 0, revenuePaisa: 0 });
  for (const r of rows) {
    const b = buckets.get(r.hour_of_day);
    if (b) {
      b.orders += r.orders;
      b.revenuePaisa += r.revenue_paisa;
    }
  }
  return [...buckets.values()];
}

// -----------------------------------------------------------------------
// Menu Engineering Matrix (Master P&L §3a) — the brief's own "sabse kaam
// ki report". Splits every item on BOTH popularity (units sold) and
// margin % at their respective medians, giving four quadrants.
// -----------------------------------------------------------------------

export type MenuQuadrant = "stars" | "plow_horses" | "puzzles" | "dogs";

export interface MenuQuadrantItem {
  menuItemId: string;
  name: string;
  qty: number;
  revenuePaisa: number;
  marginPaisa: number;
  marginPercent: number;
  quadrant: MenuQuadrant;
}

export const QUADRANT_LABEL: Record<MenuQuadrant, string> = {
  stars: "Stars",
  plow_horses: "Plow-horses",
  puzzles: "Puzzles",
  dogs: "Dogs",
};

export const QUADRANT_ACTION: Record<MenuQuadrant, string> = {
  stars: "Protect and promote — this is what the menu should sell more of.",
  plow_horses: "Sells well but thin margin — raise the price or cut its cost.",
  puzzles: "Good margin but nobody orders it — move it up the menu, promote it.",
  dogs: "Low margin, low popularity — a candidate to drop from the menu.",
};

/** Exported so the matrix chart's reference lines use the exact same
 * median calculation classifyMenuItems() classified items against —
 * two independent implementations could drift a fraction apart and
 * draw a line that doesn't actually match the quadrant a point landed in. */
export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/** Aggregates product_performance rows (which are per business_date) up
 * to one row per menu item across the whole selected range, then
 * classifies each into a quadrant by comparing it to the SET's own
 * median popularity and median margin % — "zyada/kam bikta" only means
 * anything relative to this outlet's own other items, never a fixed
 * external number. */
export function classifyMenuItems(rows: ProductPerformanceRow[]): MenuQuadrantItem[] {
  const byItem = new Map<string, { name: string; qty: number; revenuePaisa: number; marginPaisa: number }>();
  for (const r of rows) {
    const existing = byItem.get(r.menu_item_id) ?? { name: r.name_snapshot, qty: 0, revenuePaisa: 0, marginPaisa: 0 };
    existing.qty += r.qty;
    existing.revenuePaisa += r.revenue_paisa;
    existing.marginPaisa += r.margin_paisa;
    byItem.set(r.menu_item_id, existing);
  }

  const items = [...byItem.entries()].map(([menuItemId, v]) => ({
    menuItemId,
    name: v.name,
    qty: v.qty,
    revenuePaisa: v.revenuePaisa,
    marginPaisa: v.marginPaisa,
    marginPercent: v.revenuePaisa > 0 ? (v.marginPaisa / v.revenuePaisa) * 100 : 0,
  }));

  const qtyMedian = median(items.map((i) => i.qty));
  const marginMedian = median(items.map((i) => i.marginPercent));

  return items.map((i) => {
    const popular = i.qty >= qtyMedian;
    const highMargin = i.marginPercent >= marginMedian;
    const quadrant: MenuQuadrant = popular
      ? highMargin
        ? "stars"
        : "plow_horses"
      : highMargin
        ? "puzzles"
        : "dogs";
    return { ...i, quadrant };
  });
}

// -----------------------------------------------------------------------
// Flags (§4) — replaces the old system's "every month = fake alert"
// design. Net loss is the one flag that's structurally impossible to
// compute correctly from daily_pl alone: it needs amortised expenses
// subtracted first, which is why it takes them as a separate parameter
// rather than being folded into daily_pl itself (Part 14 deliberately
// keeps amortisation out of any cash-affecting calculation — see
// daily_expenses_amortized's own comment).
// -----------------------------------------------------------------------

export type FlagSeverity = "warning" | "danger";

export interface Flag {
  type: string;
  severity: FlagSeverity;
  message: string;
}

// Rs 500 cash-variance threshold is enforced in SQL (shifts_over_threshold,
// 0028_reports_views.sql) — not duplicated here as a constant, since this
// function only reads that column rather than recomputing the threshold.
const STOCK_VARIANCE_THRESHOLD_PERCENT = 5;
const VOID_VALUE_THRESHOLD_PERCENT = 3;
const LOW_MARGIN_THRESHOLD_PERCENT = 20;
const INGREDIENT_COST_INCREASE_THRESHOLD_PERCENT = 10;

export function flagCashVariance(rows: CashVarianceByCashierRow[]): Flag[] {
  return rows
    .filter((r) => r.shifts_over_threshold > 0)
    .map((r) => ({
      type: "cash_variance",
      severity: "danger",
      message: `${r.cashier_name}: ${r.shifts_over_threshold} shift(s) on ${r.business_date} varied more than Rs 500.`,
    }));
}

export interface StockVarianceInput {
  name: string;
  theoretical_used: number;
  count_adjustment: number;
}

export function flagStockVariance(rows: StockVarianceInput[]): Flag[] {
  return rows
    .filter((r) => r.theoretical_used > 0)
    .map((r) => ({ ...r, percent: (Math.abs(r.count_adjustment) / r.theoretical_used) * 100 }))
    .filter((r) => r.percent > STOCK_VARIANCE_THRESHOLD_PERCENT)
    .map((r) => ({
      type: "stock_variance",
      severity: "danger" as const,
      message: `${r.name}: ${r.percent.toFixed(1)}% unexplained variance — theoretical vs. actual.`,
    }));
}

/** Needs same-day revenue (daily_pl) to turn a void value into a
 * percentage — the two views are joined here by business_date, both
 * already scoped to the same outlet and range by the caller. */
export function flagVoidValue(voidRows: VoidByCashierRow[], revenueByDate: Map<string, number>): Flag[] {
  return voidRows
    .map((r) => {
      const revenue = revenueByDate.get(r.business_date) ?? 0;
      const percent = revenue > 0 ? (r.void_value_paisa / revenue) * 100 : 0;
      return { ...r, percent };
    })
    .filter((r) => r.percent > VOID_VALUE_THRESHOLD_PERCENT)
    .map((r) => ({
      type: "void_value",
      severity: "danger" as const,
      message: `${r.cashier_name}: voids on ${r.business_date} were ${r.percent.toFixed(1)}% of that day's revenue.`,
    }));
}

export function flagLowMarginItems(items: MenuQuadrantItem[]): Flag[] {
  return items
    .filter((i) => i.marginPercent < LOW_MARGIN_THRESHOLD_PERCENT)
    .map((i) => ({
      type: "low_margin",
      severity: "warning" as const,
      message: `${i.name}: margin is ${i.marginPercent.toFixed(1)}% — review its price or recipe cost.`,
    }));
}

export function flagIngredientCostIncrease(rows: IngredientCostTrendRow[]): Flag[] {
  return rows
    .filter((r) => r.prior_cost_paisa !== null && r.prior_cost_paisa > 0)
    .map((r) => ({
      ...r,
      percent: ((r.current_cost_paisa - r.prior_cost_paisa!) / r.prior_cost_paisa!) * 100,
    }))
    .filter((r) => r.percent > INGREDIENT_COST_INCREASE_THRESHOLD_PERCENT)
    .map((r) => ({
      type: "ingredient_cost",
      severity: "warning" as const,
      message: `${r.name}: cost is up ${r.percent.toFixed(1)}% vs. 30-90 days ago — review menu prices using it.`,
    }));
}

/** The one flag the old system got structurally wrong every month — see
 * docs/reports-and-pl.md §4. `labourAndOtherExpensesPaisa` must already
 * be the AMORTISED total for that business_date (daily_expenses_amortized),
 * never the full one-time amount a rent/salary row was recorded at. */
export function flagNetLoss(day: DailyPlRow, amortisedExpensesPaisa: number): Flag | null {
  const netProfit = day.gross_profit_paisa - amortisedExpensesPaisa;
  if (netProfit >= 0) return null;
  return {
    type: "net_loss",
    severity: "danger",
    message: `${day.business_date}: net loss of Rs ${(Math.abs(netProfit) / 100).toFixed(2)} after amortised expenses.`,
  };
}

/** Labour cost as a percentage of that day's revenue — null when there's
 * no revenue to divide by (a day with expenses but zero sales shouldn't
 * report a meaningless percentage). */
export function labourCostPercent(labourPaisa: number, revenuePaisa: number): number | null {
  if (revenuePaisa <= 0) return null;
  return (labourPaisa / revenuePaisa) * 100;
}

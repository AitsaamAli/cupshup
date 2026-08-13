"use client";

import { createClient } from "@/lib/supabase/client";
import { castRows } from "@/lib/supabase/rows";

// =======================================================================
// CSV export — Part 18 §5. "CSV/Excel" in the brief means CSV: Excel
// opens a .csv natively, and a real .xlsx needs a whole extra library
// for formatting Excel doesn't actually require here. Every export below
// pulls RAW rows for a bounded date range the caller picks (e.g. "this
// month for the accountant") — a deliberately different case from the
// Dashboard/P&L's own rule against loading every order into the browser
// (lib/reports.ts): those run continuously against however much history
// exists, this is a one-off, explicitly bounded pull a human asked for.
// =======================================================================

/** Turns an array of flat objects into a CSV string. Escapes any value
 * containing a comma, quote, or newline by wrapping it in quotes and
 * doubling internal quotes — the standard CSV escaping rule, not
 * anything Excel-specific. */
const FORMULA_TRIGGER = /^[=+\-@\t\r]/;

export function toCsv<T>(rows: T[], columns: (keyof T & string)[]): string {
  const escape = (value: unknown): string => {
    let s = value === null || value === undefined ? "" : String(value);
    // Formula-injection guard: a field that STARTS with =, +, -, or @ is
    // read as a formula (not literal text) by Excel/Sheets/LibreOffice
    // when the file is opened — a free-text field a staff member
    // controls (e.g. an expense's vendor name) could carry something
    // like =cmd|'/c calc'!A1 and execute in the accountant's spreadsheet.
    // A leading apostrophe forces every major spreadsheet app to treat
    // the cell as plain text; it's never displayed and doesn't affect
    // any other CSV consumer.
    if (FORMULA_TRIGGER.test(s)) s = `'${s}`;
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = columns.join(",");
  const lines = rows.map((row) => columns.map((c) => escape(row[c])).join(","));
  return [header, ...lines].join("\r\n");
}

/** Triggers a browser download of a CSV string — no server round trip,
 * the file never leaves the device beyond what the OS's own save/share
 * flow does with it. */
export function downloadCsv(filename: string, csv: string) {
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" }); // BOM so Excel reads UTF-8 (rupee sign, names) correctly
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

interface OrderExportRow {
  order_no: number;
  order_type: string;
  status: string;
  subtotal_paisa: number;
  discount_paisa: number;
  tax_paisa: number;
  total_paisa: number;
  created_at: string;
}

export async function fetchOrdersForExport(outletId: string, fromDate: string, toDate: string) {
  const supabase = createClient();
  const { data } = await supabase
    .from("orders")
    .select("order_no, order_type, status, subtotal_paisa, discount_paisa, tax_paisa, total_paisa, created_at")
    .eq("outlet_id", outletId)
    .gte("created_at", `${fromDate}T00:00:00`)
    .lte("created_at", `${toDate}T23:59:59`)
    .order("created_at");
  return castRows<OrderExportRow>(data);
}

interface PaymentExportRow {
  order_id: string;
  method: string;
  class: string;
  base_paisa: number;
  tax_paisa: number;
  amount_paisa: number;
  created_at: string;
}

export async function fetchPaymentsForExport(outletId: string, fromDate: string, toDate: string) {
  const supabase = createClient();
  // payments has no outlet_id of its own — scoped through its order.
  // Two flat queries + a manual filter, same pattern as every other
  // cross-table read in this app (lib/tables.ts, lib/menu.ts), rather
  // than a nested PostgREST embed.
  const { data: orderRows } = await supabase
    .from("orders")
    .select("id")
    .eq("outlet_id", outletId)
    .gte("created_at", `${fromDate}T00:00:00`)
    .lte("created_at", `${toDate}T23:59:59`);
  const orderIds = castRows<{ id: string }>(orderRows).map((o) => o.id);
  if (orderIds.length === 0) return [];

  const { data } = await supabase
    .from("payments")
    .select("order_id, method, class, base_paisa, tax_paisa, amount_paisa, created_at")
    .in("order_id", orderIds)
    .order("created_at");
  return castRows<PaymentExportRow>(data);
}

interface ExpenseExportRow {
  category_id: string;
  vendor: string | null;
  payment_method: string;
  amount_paisa: number;
  accrual_type: string;
  created_at: string;
}

export async function fetchExpensesForExport(outletId: string, fromDate: string, toDate: string) {
  const supabase = createClient();
  const { data } = await supabase
    .from("expenses")
    .select("category_id, vendor, payment_method, amount_paisa, accrual_type, created_at")
    .eq("outlet_id", outletId)
    .gte("created_at", `${fromDate}T00:00:00`)
    .lte("created_at", `${toDate}T23:59:59`)
    .order("created_at");
  return castRows<ExpenseExportRow>(data);
}

interface StockMovementExportRow {
  ingredient_id: string;
  movement_type: string;
  qty: number;
  reason: string | null;
  created_at: string;
}

export async function fetchStockMovementsForExport(outletId: string, fromDate: string, toDate: string) {
  const supabase = createClient();
  const { data } = await supabase
    .from("stock_movements")
    .select("ingredient_id, movement_type, qty, reason, created_at")
    .eq("outlet_id", outletId)
    .gte("created_at", `${fromDate}T00:00:00`)
    .lte("created_at", `${toDate}T23:59:59`)
    .order("created_at");
  return castRows<StockMovementExportRow>(data);
}

export const ORDER_EXPORT_COLUMNS: (keyof OrderExportRow)[] = [
  "order_no",
  "order_type",
  "status",
  "subtotal_paisa",
  "discount_paisa",
  "tax_paisa",
  "total_paisa",
  "created_at",
];

export const PAYMENT_EXPORT_COLUMNS: (keyof PaymentExportRow)[] = [
  "order_id",
  "method",
  "class",
  "base_paisa",
  "tax_paisa",
  "amount_paisa",
  "created_at",
];

export const EXPENSE_EXPORT_COLUMNS: (keyof ExpenseExportRow)[] = [
  "category_id",
  "vendor",
  "payment_method",
  "amount_paisa",
  "accrual_type",
  "created_at",
];

export const STOCK_MOVEMENT_EXPORT_COLUMNS: (keyof StockMovementExportRow)[] = [
  "ingredient_id",
  "movement_type",
  "qty",
  "reason",
  "created_at",
];

/** The PRA-return shape specifically: 16%/8% kept as separate rows, per
 * the brief's own "16% aur 8% alag alag" — never blended into one
 * combined tax line, since that's not how the return itself is filed. */
export interface TaxSummaryExportRow {
  business_date: string;
  class: string;
  base_paisa: number;
  tax_paisa: number;
  amount_paisa: number;
}

export const TAX_SUMMARY_EXPORT_COLUMNS: (keyof TaxSummaryExportRow)[] = [
  "business_date",
  "class",
  "base_paisa",
  "tax_paisa",
  "amount_paisa",
];

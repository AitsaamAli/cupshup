"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { castRows } from "@/lib/supabase/rows";
import type { PaymentMethod } from "@/lib/settlement";

export interface ExpenseCategory {
  id: string;
  outlet_id: string;
  name: string;
  accrual_type: "immediate" | "monthly" | "annual";
  color: string | null;
}

export interface Expense {
  id: string;
  outlet_id: string;
  business_day_id: string | null;
  shift_id: string | null;
  category_id: string;
  amount_paisa: number;
  payment_method: PaymentMethod;
  vendor: string | null;
  note: string | null;
  receipt_url: string | null;
  period_start: string | null;
  period_end: string | null;
  created_by: string | null;
  approved_by: string | null;
  created_at: string;
}

// Amount thresholds from Part 14's brief, in paisa.
export const APPROVAL_THRESHOLD_MANAGER_PAISA = 500000; // Rs 5,000
export const APPROVAL_THRESHOLD_OWNER_PAISA = 2500000; // Rs 25,000

/** Which role tier an expense of this size needs sign-off from — for
 * showing the right hint in the entry form before submitting. The
 * actual enforcement is server-side, in record_expense() (Part 14). */
export function requiredApprovalRole(amountPaisa: number): "supervisor" | "manager" | "owner" {
  if (amountPaisa < APPROVAL_THRESHOLD_MANAGER_PAISA) return "supervisor";
  if (amountPaisa <= APPROVAL_THRESHOLD_OWNER_PAISA) return "manager";
  return "owner";
}

/**
 * Client-side preview of daily_expenses_amortized's formula (Part 14),
 * including the last-day-absorbs-the-remainder fix found by actually
 * querying the view against a real 31-day test row before calling this
 * part done (plain per-day rounding lost 9 paisa over a real August).
 * `dayIndex` is 0-based; `totalDays` is the period length.
 */
export function previewAmortizedDailyAmount(
  amountPaisa: number,
  accrualType: "immediate" | "monthly" | "annual",
  dayIndex: number,
  totalDays: number
): number {
  if (accrualType === "immediate") return amountPaisa;
  const days = Math.max(totalDays, 1);
  const perDay = Math.round(amountPaisa / days);
  const isLastDay = dayIndex === days - 1;
  return isLastDay ? amountPaisa - (days - 1) * perDay : perDay;
}

export function useExpenseCategories(outletId: string) {
  const [categories, setCategories] = useState<ExpenseCategory[]>([]);

  useEffect(() => {
    const supabase = createClient();
    supabase
      .from("expense_categories")
      .select("*")
      .eq("outlet_id", outletId)
      .order("name")
      .then(({ data }) => setCategories(castRows<ExpenseCategory>(data)));
  }, [outletId]);

  return categories;
}

export function useExpenses(outletId: string, limit = 100) {
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase
      .from("expenses")
      .select("*")
      .eq("outlet_id", outletId)
      .order("created_at", { ascending: false })
      .limit(limit);
    setExpenses(castRows<Expense>(data));
    setLoading(false);
  }, [outletId, limit]);

  useEffect(() => {
    reload();
  }, [reload]);

  return { expenses, loading, reload };
}

export interface RecordExpenseInput {
  categoryId: string;
  amountPaisa: number;
  paymentMethod: PaymentMethod;
  vendor?: string;
  note?: string;
  receiptUrl?: string;
  periodStart?: string;
  periodEnd?: string;
}

export async function recordExpense(input: RecordExpenseInput): Promise<Expense> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("record_expense", {
    p_category_id: input.categoryId,
    p_amount_paisa: input.amountPaisa,
    p_payment_method: input.paymentMethod,
    p_vendor: input.vendor ?? null,
    p_note: input.note ?? null,
    p_receipt_url: input.receiptUrl ?? null,
    p_period_start: input.periodStart ?? null,
    p_period_end: input.periodEnd ?? null,
  });
  if (error) throw new Error(error.message);
  return data as Expense;
}

export async function approveExpense(expenseId: string) {
  const supabase = createClient();
  const { error } = await supabase.rpc("approve_expense", { p_expense_id: expenseId });
  if (error) throw new Error(error.message);
}

export async function updateExpense(
  expenseId: string,
  input: Omit<RecordExpenseInput, "categoryId">
) {
  const supabase = createClient();
  const { error } = await supabase.rpc("update_expense", {
    p_expense_id: expenseId,
    p_amount_paisa: input.amountPaisa,
    p_payment_method: input.paymentMethod,
    p_vendor: input.vendor ?? null,
    p_note: input.note ?? null,
    p_receipt_url: input.receiptUrl ?? null,
    p_period_start: input.periodStart ?? null,
    p_period_end: input.periodEnd ?? null,
  });
  if (error) throw new Error(error.message);
}

export async function deleteExpense(expenseId: string) {
  const supabase = createClient();
  const { error } = await supabase.rpc("delete_expense", { p_expense_id: expenseId });
  if (error) throw new Error(error.message);
}

// ---------------------------------------------------------------------
// Reports: category-wise, vendor-wise, cash vs non-cash
// ---------------------------------------------------------------------

export interface CategoryTotal {
  categoryId: string;
  categoryName: string;
  totalPaisa: number;
}

export interface VendorTotal {
  vendor: string;
  totalPaisa: number;
}

export function summarizeByCategory(
  expenses: Expense[],
  categories: ExpenseCategory[]
): CategoryTotal[] {
  const nameById = new Map(categories.map((c) => [c.id, c.name]));
  const totals = new Map<string, number>();
  for (const e of expenses) {
    totals.set(e.category_id, (totals.get(e.category_id) ?? 0) + e.amount_paisa);
  }
  return [...totals.entries()]
    .map(([categoryId, totalPaisa]) => ({
      categoryId,
      categoryName: nameById.get(categoryId) ?? categoryId,
      totalPaisa,
    }))
    .sort((a, b) => b.totalPaisa - a.totalPaisa);
}

export function summarizeByVendor(expenses: Expense[]): VendorTotal[] {
  const totals = new Map<string, number>();
  for (const e of expenses) {
    const vendor = e.vendor ?? "(no vendor)";
    totals.set(vendor, (totals.get(vendor) ?? 0) + e.amount_paisa);
  }
  return [...totals.entries()]
    .map(([vendor, totalPaisa]) => ({ vendor, totalPaisa }))
    .sort((a, b) => b.totalPaisa - a.totalPaisa);
}

export function summarizeCashVsNonCash(expenses: Expense[]): { cashPaisa: number; nonCashPaisa: number } {
  let cashPaisa = 0;
  let nonCashPaisa = 0;
  for (const e of expenses) {
    if (e.payment_method === "cash") cashPaisa += e.amount_paisa;
    else nonCashPaisa += e.amount_paisa;
  }
  return { cashPaisa, nonCashPaisa };
}

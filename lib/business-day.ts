"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { castRows } from "@/lib/supabase/rows";

export interface BusinessDay {
  id: string;
  outlet_id: string;
  business_date: string;
  status: "open" | "closed" | "locked";
  opened_by: string | null;
  opened_at: string;
  closed_by: string | null;
  closed_at: string | null;
  closing_snapshot: ClosingSnapshot | null;
}

export interface ClosingSnapshot {
  orders: number;
  revenue_paisa: number;
  tax_paisa: number;
  collected_paisa: number;
  cogs_paisa: number;
  gross_profit_paisa: number;
  expenses_paisa: number;
  net_profit_paisa: number;
  cash_sales_paisa: number;
  opening_float_paisa: number;
  cash_drops_paisa: number;
  expected_cash_paisa: number;
  counted_cash_paisa: number;
  variance_paisa: number;
}

export interface Shift {
  id: string;
  business_day_id: string;
  cashier_id: string;
  terminal_id: string | null;
  opened_at: string;
  opening_float_paisa: number;
  closed_at: string | null;
  counted_cash_paisa: number | null;
  expected_cash_paisa: number | null;
  variance_paisa: number | null;
}

export type CashMovementType = "float_in" | "drop" | "pickup" | "paid_out" | "paid_in";

/** The outlet's currently open business day, if any, plus its shifts —
 * kept live via Realtime so a manager's screen updates the instant
 * anyone opens/closes a shift or the day itself. */
export function useBusinessDay(outletId: string) {
  const [day, setDay] = useState<BusinessDay | null>(null);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    const supabase = createClient();
    const { data: days } = await supabase
      .from("business_days")
      .select("*")
      .eq("outlet_id", outletId)
      .order("opened_at", { ascending: false })
      .limit(1);
    const latest = castRows<BusinessDay>(days)[0] ?? null;
    setDay(latest);

    if (latest) {
      const { data: shiftRows } = await supabase
        .from("shifts")
        .select("*")
        .eq("business_day_id", latest.id)
        .order("opened_at");
      setShifts(castRows<Shift>(shiftRows));
    } else {
      setShifts([]);
    }
    setLoading(false);
  }, [outletId]);

  useEffect(() => {
    reload();
    const supabase = createClient();
    const channel = supabase
      .channel(`business-day-${outletId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "business_days" }, reload)
      .on("postgres_changes", { event: "*", schema: "public", table: "shifts" }, reload)
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [outletId, reload]);

  return { day, shifts, loading, reload };
}

export async function openBusinessDay(outletId: string, openingFloatPaisa: number) {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("open_business_day", {
    p_outlet: outletId,
    p_opening_float_paisa: openingFloatPaisa,
  });
  if (error) throw new Error(error.message);
  return data;
}

export async function closeBusinessDay(businessDayId: string, countedCashPaisa: number) {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("close_business_day", {
    p_business_day_id: businessDayId,
    p_counted_cash_paisa: countedCashPaisa,
  });
  if (error) throw new Error(error.message);
  return data as ClosingSnapshot;
}

export async function openShift(openingFloatPaisa: number, terminalId?: string) {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("open_shift", {
    p_terminal_id: terminalId ?? null,
    p_opening_float_paisa: openingFloatPaisa,
  });
  if (error) throw new Error(error.message);
  return data as Shift;
}

export async function closeShift(shiftId: string, countedCashPaisa: number) {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("close_shift", {
    p_shift_id: shiftId,
    p_counted_cash_paisa: countedCashPaisa,
  });
  if (error) throw new Error(error.message);
  return data as Shift;
}

export async function recordCashMovement(
  shiftId: string,
  type: CashMovementType,
  amountPaisa: number,
  reason?: string
) {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("record_cash_movement", {
    p_shift_id: shiftId,
    p_type: type,
    p_amount_paisa: amountPaisa,
    p_reason: reason ?? null,
  });
  if (error) throw new Error(error.message);
  return data;
}

/**
 * Client-side preview of close_shift()'s expected-cash formula — same
 * "preview only, server computes the real value identically" pattern as
 * previewSplitTax() (Part 10) and previewWeightedAvgCost() (Part 12).
 * Deliberately excludes cash expenses unless the caller already knows
 * them, since expenses aren't reliably shift-attributed yet (see
 * docs/business-day-and-shifts.md).
 */
export function previewExpectedCash(
  openingFloatPaisa: number,
  cashSalesPaisa: number,
  paidInPaisa: number,
  cashExpensesPaisa: number,
  dropsPaisa: number
): number {
  return openingFloatPaisa + cashSalesPaisa + paidInPaisa - cashExpensesPaisa - dropsPaisa;
}

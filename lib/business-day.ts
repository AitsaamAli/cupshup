"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { castRows } from "@/lib/supabase/rows";
import { offlineDb } from "@/lib/offline-db";
import { isNetworkError } from "@/lib/offline-network";

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
  /** Cash from orders that were settled and then voided during this
   * business day (0043_settled_void_reconciliation.sql). Deliberately
   * NOT folded into expected_cash_paisa/variance_paisa — a genuine
   * settled-then-voided refund should reduce expected cash, same as it
   * already does. This figure exists so an owner reviewing the close can
   * see it and go verify each one, instead of it being unrecoverable
   * from the snapshot entirely. */
  // Optional — 0043_settled_void_reconciliation.sql added this key going
  // forward; a closing_snapshot saved by an earlier migration won't have
  // it, so callers must handle undefined (ClosingReport below does).
  voided_after_settle_cash_paisa?: number;
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
/**
 * Part 20: this is the single most important place the "network
 * failure looks identical to empty data" bug (see lib/menu.ts's own
 * fix) could bite — `data: null` on a dead connection previously meant
 * `latest = null`, which every day-gated screen (POS, KDS) reads as
 * "no open day," and POS's own day-closed screen would then block a
 * cashier from taking ANY order while genuinely offline, which is
 * exactly backwards from "POS ko chalte rehna hai." reload() now checks
 * the query's own `error` for a network failure and falls back to the
 * last cached day status (IndexedDB) instead, flagged `offline: true`
 * so the UI can say "using last known status" rather than pretend
 * nothing's wrong.
 */
export function useBusinessDay(outletId: string) {
  const [day, setDay] = useState<BusinessDay | null>(null);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [loading, setLoading] = useState(true);
  const [offline, setOffline] = useState(false);

  const reload = useCallback(async () => {
    const supabase = createClient();
    const daysRes = await supabase
      .from("business_days")
      .select("*")
      .eq("outlet_id", outletId)
      .order("opened_at", { ascending: false })
      .limit(1);

    if (daysRes.error && isNetworkError(daysRes.error)) {
      const cached = await offlineDb.dayCache.get(outletId);
      if (cached) {
        setDay({
          id: `offline-${outletId}`,
          outlet_id: outletId,
          business_date: cached.business_date,
          status: cached.status,
          opened_by: null,
          opened_at: cached.cachedAt,
          closed_by: null,
          closed_at: null,
          closing_snapshot: null,
        });
      }
      setOffline(true);
      setLoading(false);
      return;
    }

    const latest = castRows<BusinessDay>(daysRes.data)[0] ?? null;
    setDay(latest);
    setOffline(false);
    if (latest) {
      await offlineDb.dayCache.put({
        outletId,
        business_date: latest.business_date,
        status: latest.status,
        cachedAt: new Date().toISOString(),
      });
    }

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

  return { day, shifts, loading, offline, reload };
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

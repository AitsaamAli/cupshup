"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { castRows } from "@/lib/supabase/rows";

export interface Supplier {
  id: string;
  outlet_id: string;
  name: string;
  phone: string | null;
  terms: string | null;
  active: boolean;
}

export interface SupplierPayableRow {
  supplier_id: string;
  outlet_id: string;
  name: string;
  active: boolean;
  payable_paisa: number;
  open_invoices: number;
  last_purchase_at: string | null;
}

export interface Purchase {
  id: string;
  outlet_id: string;
  supplier_id: string;
  invoice_ref: string | null;
  invoice_photo_url: string | null;
  total_paisa: number;
  payment_status: "paid" | "credit" | "partial";
  amount_paid_paisa: number;
  received_by: string | null;
  note: string | null;
  created_at: string;
}

export interface PurchaseLine {
  id: string;
  purchase_id: string;
  ingredient_id: string;
  qty: number;
  unit_cost_paisa: number;
  line_total_paisa: number;
}

export interface GrnLineInput {
  ingredient_id: string;
  qty: number;
  unit_cost_paisa: number;
}

// ---------------------------------------------------------------------
// Suppliers
// ---------------------------------------------------------------------

export function useSuppliers(outletId: string) {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase
      .from("suppliers")
      .select("*")
      .eq("outlet_id", outletId)
      .order("name");
    setSuppliers(castRows<Supplier>(data));
    setLoading(false);
  }, [outletId]);

  useEffect(() => {
    reload();
  }, [reload]);

  return { suppliers, loading, reload };
}

export async function upsertSupplier(
  id: string | null,
  name: string,
  options: { phone?: string; terms?: string } = {}
) {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("upsert_supplier", {
    p_id: id,
    p_name: name,
    p_phone: options.phone ?? null,
    p_terms: options.terms ?? null,
  });
  if (error) throw new Error(error.message);
  return data as string;
}

export async function setSupplierActive(supplierId: string, active: boolean) {
  const supabase = createClient();
  const { error } = await supabase.rpc("set_supplier_active", {
    p_supplier_id: supplierId,
    p_active: active,
  });
  if (error) throw new Error(error.message);
}

/** "Kis supplier ka kitna udhaar hai" — Part 12. */
export function useSupplierPayables(outletId: string) {
  const [rows, setRows] = useState<SupplierPayableRow[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase
      .from("supplier_payables")
      .select("*")
      .eq("outlet_id", outletId);
    setRows(castRows<SupplierPayableRow>(data));
    setLoading(false);
  }, [outletId]);

  useEffect(() => {
    reload();
  }, [reload]);

  return { rows, loading, reload };
}

/**
 * Client-side preview of record_purchase_grn()'s (and record_purchase()'s)
 * weighted-average cost formula — used to show "new average will be
 * ~Rs X" while a GRN is being entered. The server computes the real
 * value identically; this is a preview only, same relationship
 * previewSplitTax() has to settle_order()'s tax math (Part 10).
 *
 *   new_avg = (current_stock × current_avg + new_qty × new_cost)
 *             ÷ (current_stock + new_qty)
 */
export function previewWeightedAvgCost(
  currentStockQty: number,
  currentAvgCostPaisa: number,
  newQty: number,
  newCostPaisa: number
): number {
  if (currentStockQty <= 0) return newCostPaisa;
  return Math.round(
    (currentStockQty * currentAvgCostPaisa + newQty * newCostPaisa) / (currentStockQty + newQty)
  );
}

// ---------------------------------------------------------------------
// Purchases (GRN)
// ---------------------------------------------------------------------

export interface RecordGrnOptions {
  invoiceRef?: string;
  paymentStatus?: "paid" | "credit" | "partial";
  amountPaidPaisa?: number;
  invoicePhotoUrl?: string;
  note?: string;
}

/** Records a full goods-receipt note: one or more ingredient lines,
 * each updating that ingredient's weighted-average cost, all in one
 * transaction (record_purchase_grn(), Part 12). */
export async function recordPurchaseGrn(
  supplierId: string,
  lines: GrnLineInput[],
  options: RecordGrnOptions = {}
): Promise<Purchase> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("record_purchase_grn", {
    p_supplier_id: supplierId,
    p_lines: lines,
    p_invoice_ref: options.invoiceRef ?? null,
    p_payment_status: options.paymentStatus ?? "credit",
    p_amount_paid_paisa: options.amountPaidPaisa ?? 0,
    p_invoice_photo_url: options.invoicePhotoUrl ?? null,
    p_note: options.note ?? null,
  });
  if (error) throw new Error(error.message);
  return data as Purchase;
}

/** Returns part of a delivery to the supplier — a reversal record, the
 * original GRN is never edited or deleted (record_purchase_return()). */
export async function recordPurchaseReturn(
  purchaseId: string,
  ingredientId: string,
  qty: number,
  reason?: string
) {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("record_purchase_return", {
    p_purchase_id: purchaseId,
    p_ingredient_id: ingredientId,
    p_qty: qty,
    p_reason: reason ?? null,
  });
  if (error) throw new Error(error.message);
  return data;
}

export function usePurchases(outletId: string, limit = 50) {
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase
      .from("purchases")
      .select("*")
      .eq("outlet_id", outletId)
      .order("created_at", { ascending: false })
      .limit(limit);
    setPurchases(castRows<Purchase>(data));
    setLoading(false);
  }, [outletId, limit]);

  useEffect(() => {
    reload();
  }, [reload]);

  return { purchases, loading, reload };
}

export async function fetchPurchaseLines(purchaseId: string): Promise<PurchaseLine[]> {
  const supabase = createClient();
  const { data } = await supabase.from("purchase_lines").select("*").eq("purchase_id", purchaseId);
  return castRows<PurchaseLine>(data);
}

// ---------------------------------------------------------------------
// Ingredient price history + rate-increase alerts
// ---------------------------------------------------------------------

export interface PriceHistoryPoint {
  created_at: string;
  unit_cost_paisa: number;
}

export interface PriceAlert {
  ingredientId: string;
  ingredientName: string;
  previousCostPaisa: number;
  latestCostPaisa: number;
  percentIncrease: number;
}

/** Every purchase-line price point for one ingredient, oldest first —
 * what the price-history chart plots. Sorted client-side after fetching
 * rather than via an embedded-resource `.order()`, which is finicky
 * across supabase-js/PostgREST versions — plain and guaranteed correct
 * instead. */
export async function fetchIngredientPriceHistory(ingredientId: string): Promise<PriceHistoryPoint[]> {
  const supabase = createClient();
  const { data } = await supabase
    .from("purchase_lines")
    .select("unit_cost_paisa, purchases!inner(created_at)")
    .eq("ingredient_id", ingredientId);
  return castRows<{ unit_cost_paisa: number; purchases: { created_at: string } }>(data)
    .map((row) => ({
      created_at: row.purchases.created_at,
      unit_cost_paisa: row.unit_cost_paisa,
    }))
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
}

/**
 * Flags any ingredient whose most recent purchase cost is >10% above
 * the one before it — "Cheese ka rate pichle mahine se 18% barh gaya"
 * (Part 12). Computed client-side from purchase_lines rather than a
 * dedicated view, since it's a simple last-two-points comparison per
 * ingredient rather than an aggregate.
 */
export async function findPriceIncreaseAlerts(
  outletId: string,
  thresholdPercent = 10
): Promise<PriceAlert[]> {
  const supabase = createClient();
  const { data: ingredients } = await supabase
    .from("ingredients")
    .select("id, name")
    .eq("outlet_id", outletId)
    .eq("active", true);

  const alerts: PriceAlert[] = [];
  for (const ing of castRows<{ id: string; name: string }>(ingredients)) {
    const history = await fetchIngredientPriceHistory(ing.id);
    if (history.length < 2) continue;
    const [previous, latest] = history.slice(-2);
    if (previous.unit_cost_paisa <= 0) continue;
    const percentIncrease =
      ((latest.unit_cost_paisa - previous.unit_cost_paisa) / previous.unit_cost_paisa) * 100;
    if (percentIncrease >= thresholdPercent) {
      alerts.push({
        ingredientId: ing.id,
        ingredientName: ing.name,
        previousCostPaisa: previous.unit_cost_paisa,
        latestCostPaisa: latest.unit_cost_paisa,
        percentIncrease,
      });
    }
  }
  return alerts;
}

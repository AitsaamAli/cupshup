"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { castRows } from "@/lib/supabase/rows";

export interface Ingredient {
  id: string;
  outlet_id: string;
  name: string;
  unit: string;
  min_stock: number;
  moving_avg_cost_paisa: number;
  active: boolean;
}

export interface IngredientStockRow {
  id: string;
  outlet_id: string;
  name: string;
  unit: string;
  min_stock: number;
  moving_avg_cost_paisa: number;
  current_stock: number;
  is_low: boolean;
}

export interface StockVarianceRow {
  ingredient_id: string;
  outlet_id: string;
  name: string;
  unit: string;
  moving_avg_cost_paisa: number;
  theoretical_used: number;
  declared_loss: number;
  count_adjustment: number;
  current_stock: number;
  unexplained_variance_paisa: number;
}

export interface RecipeLine {
  menu_item_id: string;
  ingredient_id: string;
  qty: number;
}

/** Wastage/staff-meal reason codes shown in the UI. Both map to
 * movement_type = 'wastage', except staff_meal which is its own
 * movement_type — see 0001_schema.sql's movement_type enum. */
export const WASTAGE_REASONS = [
  { code: "spoiled", label: "Spoiled", movementType: "wastage" as const },
  { code: "dropped", label: "Dropped", movementType: "wastage" as const },
  { code: "burnt", label: "Burnt", movementType: "wastage" as const },
  { code: "expired", label: "Expired", movementType: "wastage" as const },
  { code: "staff_meal", label: "Staff meal", movementType: "staff_meal" as const },
];

/**
 * Logs wastage or a staff meal directly against the ledger. No RPC
 * needed — 0005_rls.sql's log_wastage policy already lets kitchen roles
 * INSERT stock_movements for exactly these two movement types (and
 * nothing else), so this is a plain, RLS-gated insert. qty is always
 * recorded negative (stock leaving), regardless of what's typed in.
 */
export async function logWastage(
  outletId: string,
  ingredientId: string,
  qty: number,
  reasonCode: string,
  movementType: "wastage" | "staff_meal"
) {
  const supabase = createClient();
  const { error } = await supabase.from("stock_movements").insert({
    outlet_id: outletId,
    ingredient_id: ingredientId,
    movement_type: movementType,
    qty: -Math.abs(qty),
    reference_type: "manual",
    reason: reasonCode,
  });
  if (error) throw new Error(error.message);
}

export interface RecordPurchaseResult {
  new_stock: number;
  new_avg_cost_paisa: number;
}

/** Records a delivery and updates the ingredient's weighted-average cost
 * (record_purchase(), Part 11). Owner/manager only — enforced inside the
 * function itself. */
export async function recordPurchase(
  ingredientId: string,
  qty: number,
  unitCostPaisa: number,
  options: { supplierId?: string; note?: string } = {}
): Promise<RecordPurchaseResult> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("record_purchase", {
    p_ingredient_id: ingredientId,
    p_qty: qty,
    p_unit_cost_paisa: unitCostPaisa,
    p_supplier_id: options.supplierId ?? null,
    p_note: options.note ?? null,
  });
  if (error) throw new Error(error.message);
  return data as RecordPurchaseResult;
}

export interface StockCountResult {
  theoretical: number;
  counted: number;
  variance: number;
}

/** Compares a physical count to the ledger and writes exactly the
 * difference as a count_adjustment (record_stock_count(), Part 11). */
export async function recordStockCount(
  ingredientId: string,
  countedQty: number,
  note?: string
): Promise<StockCountResult> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("record_stock_count", {
    p_ingredient_id: ingredientId,
    p_counted_qty: countedQty,
    p_note: note ?? null,
  });
  if (error) throw new Error(error.message);
  return data as StockCountResult;
}

export async function upsertRecipeLine(menuItemId: string, ingredientId: string, qty: number) {
  const supabase = createClient();
  const { error } = await supabase.rpc("upsert_recipe_line", {
    p_menu_item_id: menuItemId,
    p_ingredient_id: ingredientId,
    p_qty: qty,
  });
  if (error) throw new Error(error.message);
}

export async function removeRecipeLine(menuItemId: string, ingredientId: string) {
  const supabase = createClient();
  const { error } = await supabase.rpc("remove_recipe_line", {
    p_menu_item_id: menuItemId,
    p_ingredient_id: ingredientId,
  });
  if (error) throw new Error(error.message);
}

/**
 * Live ingredient stock levels (the `ingredient_stock` view — current
 * stock is always the ledger SUM, never a stored column) with low-stock
 * flags, kept fresh via Realtime so a manager's screen updates the
 * instant a sale, wastage entry, or count adjustment changes anything.
 */
export function useIngredientStock(outletId: string) {
  const [rows, setRows] = useState<IngredientStockRow[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase
      .from("ingredient_stock")
      .select("*")
      .eq("outlet_id", outletId)
      .order("name");
    setRows(castRows<IngredientStockRow>(data));
    setLoading(false);
  }, [outletId]);

  useEffect(() => {
    reload();
    const supabase = createClient();
    const channel = supabase
      .channel(`ingredient-stock-${outletId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "stock_movements" }, reload)
      .on("postgres_changes", { event: "*", schema: "public", table: "ingredients" }, reload)
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [outletId, reload]);

  return { rows, loading, reload };
}

/** The variance report — theoretical vs. declared vs. counted, per
 * ingredient, in both quantity and rupees. */
export function useStockVariance(outletId: string) {
  const [rows, setRows] = useState<StockVarianceRow[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase
      .from("stock_variance")
      .select("*")
      .eq("outlet_id", outletId);
    setRows(castRows<StockVarianceRow>(data));
    setLoading(false);
  }, [outletId]);

  useEffect(() => {
    reload();
  }, [reload]);

  return { rows, loading, reload };
}

/** All ingredients for an outlet (for pickers — recipe editor, purchase
 * form, wastage form, count screen). */
export function useIngredients(outletId: string) {
  const [ingredients, setIngredients] = useState<Ingredient[]>([]);

  useEffect(() => {
    const supabase = createClient();
    supabase
      .from("ingredients")
      .select("*")
      .eq("outlet_id", outletId)
      .eq("active", true)
      .order("name")
      .then(({ data }) => setIngredients(castRows<Ingredient>(data)));
  }, [outletId]);

  return ingredients;
}

/** A single menu item's recipe lines. */
export function useRecipe(menuItemId: string | null) {
  const [lines, setLines] = useState<RecipeLine[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    if (!menuItemId) {
      setLines([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const supabase = createClient();
    const { data } = await supabase
      .from("recipe_lines")
      .select("*")
      .eq("menu_item_id", menuItemId);
    setLines(castRows<RecipeLine>(data));
    setLoading(false);
  }, [menuItemId]);

  useEffect(() => {
    reload();
  }, [reload]);

  return { lines, loading, reload };
}

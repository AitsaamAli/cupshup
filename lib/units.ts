"use client";

import { createClient } from "@/lib/supabase/client";

/**
 * UI convenience only — see 0014_unit_conversions.sql. The ledger never
 * needs this: every quantity is already stored as a decimal fraction of
 * the ingredient's own unit. This exists so an input form can accept
 * "50" grams for a kg-tracked ingredient and convert it to 0.050 before
 * it ever reaches a stock_movements/recipe_lines row.
 */
export async function convertQty(qty: number, fromUnit: string, toUnit: string): Promise<number> {
  if (fromUnit === toUnit) return qty;
  const supabase = createClient();
  const { data, error } = await supabase
    .from("unit_conversions")
    .select("factor")
    .eq("from_unit", fromUnit)
    .eq("to_unit", toUnit)
    .single();
  if (error || !data) {
    throw new Error(`No conversion known from ${fromUnit} to ${toUnit}`);
  }
  return qty * (data as { factor: number }).factor;
}

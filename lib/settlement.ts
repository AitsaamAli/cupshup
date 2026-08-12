"use client";

import { createClient } from "@/lib/supabase/client";

export type PaymentMethod = "cash" | "card" | "jazzcash" | "easypaisa" | "qr" | "foodpanda";

export interface PaymentSplitInput {
  method: PaymentMethod;
  /** The PRE-TAX portion of the bill settled by this method. Never a
   * tax amount, never a total — settle_order() computes tax itself. */
  base_paisa: number;
  tendered_paisa?: number;
  processor_ref?: string;
}

export interface SettleOrderOptions {
  discountPaisa?: number;
  serviceChargePaisa?: number;
  deliveryFeePaisa?: number;
}

/**
 * Settles an order. Payment is split-friendly by design — Punjab taxes
 * by payment method (16% cash / 8% digital), so a bill paid half-cash
 * half-card genuinely has two different tax rates on it, computed and
 * rounded independently per split by settle_order() (Part 10). The
 * client only ever sends each split's pre-tax base amount.
 */
export async function settleOrder(
  orderId: string,
  payments: PaymentSplitInput[],
  options: SettleOrderOptions = {}
) {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("settle_order", {
    p_order_id: orderId,
    p_payments: payments,
    p_discount_paisa: options.discountPaisa ?? 0,
    p_service_charge_paisa: options.serviceChargePaisa ?? 0,
    p_delivery_fee_paisa: options.deliveryFeePaisa ?? 0,
  });
  if (error) throw new Error(error.message);
  return data;
}

export interface TaxRateInfo {
  class: "cash" | "digital";
  rate_bp: number;
}

/**
 * Loads the CURRENT tax rate per payment method, straight from the
 * database, for display only — e.g. showing "16%" next to the Cash
 * button before the cashier taps it. This is a preview: settle_order()
 * looks the rate up itself, server-side, at the actual moment of
 * settlement, using the business day's date. Never hardcode these rates
 * in the UI (Part 05's rule) — that's exactly the bug this whole project
 * exists to fix.
 */
export async function loadPaymentMethodTaxRates(): Promise<Record<PaymentMethod, TaxRateInfo>> {
  const supabase = createClient();
  const [{ data: pmClasses }, { data: rates }] = await Promise.all([
    supabase.from("payment_method_tax_class").select("*"),
    supabase.from("tax_rates").select("*").is("effective_to", null),
  ]);

  const rateByClass: Record<string, number> = {};
  ((rates as { class: string; rate_bp: number }[] | null) ?? []).forEach((r) => {
    rateByClass[r.class] = r.rate_bp;
  });

  const result = {} as Record<PaymentMethod, TaxRateInfo>;
  ((pmClasses as { method: PaymentMethod; class: "cash" | "digital" }[] | null) ?? []).forEach(
    (pm) => {
      result[pm.method] = { class: pm.class, rate_bp: rateByClass[pm.class] ?? 0 };
    }
  );
  return result;
}

/** Client-side preview of settle_order()'s own rounding rule — round
 * EACH split independently, never the whole bill at once. Used only to
 * show the cashier what to expect before submitting; the server's own
 * computation (identical formula) is what's actually charged. */
export function previewSplitTax(basePaisa: number, rateBp: number): number {
  return Math.round((basePaisa * rateBp) / 10000);
}

"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { castRows } from "@/lib/supabase/rows";

export type OrderType = "dine_in" | "takeaway" | "delivery";

export interface CartModifier {
  modifier_id: string;
  price_delta_paisa: number;
}

export interface CartItem {
  menu_item_id: string;
  qty: number;
  modifiers?: CartModifier[];
  note?: string;
}

export interface OrderRecord {
  id: string;
  order_no: number;
  status: string;
  subtotal_paisa: number;
  cogs_paisa: number;
  [key: string]: unknown;
}

export interface PlaceOrderResult {
  order: OrderRecord;
  duplicate: boolean;
}

/**
 * Thrown by placeOrder() on any failure. Carries the idempotency key
 * that was actually used, so a caller can retry with the EXACT same key
 * — reusing it is always safe (place_order() returns the original order
 * instead of creating a second one), generating a fresh one on retry is
 * not (a network error after the write succeeded, followed by a "new"
 * key, creates a real duplicate order).
 */
export class OrderError extends Error {
  constructor(
    message: string,
    public readonly idempotencyKey: string
  ) {
    super(message);
    this.name = "OrderError";
  }
}

export interface PlaceOrderOptions {
  tableId?: string;
  customerId?: string;
  note?: string;
  /** Pass this back in only when retrying a call that may have already
   * gone through. Omit it for every brand-new order. */
  idempotencyKey?: string;
}

/**
 * Places an order. The browser never sends a price here — only
 * menu_item_id/qty/modifiers — place_order() (Part 09) looks up every
 * price and cost itself, inside one transaction.
 *
 * Part 20: verified empirically against this project's actual
 * supabase-js version — a dead connection does NOT make `.rpc()`
 * throw; it resolves normally with
 * `{ data: null, error: { message: "TypeError: fetch failed" } }`,
 * indistinguishable in shape from any other rejected call. That text
 * flows straight through into `OrderError.message` below, which is
 * exactly what `isNetworkError()` (lib/offline-network.ts) checks to
 * decide whether Part 20's offline-aware wrapper
 * (lib/offline-orders.ts) should queue the order instead of surfacing
 * a hard failure. The try/catch stays as defensive coverage for a
 * genuinely thrown error (a future supabase-js version, or some other
 * failure mode this project hasn't hit) — either way the result is
 * still a well-formed OrderError carrying the idempotency key, never a
 * raw unwrapped exception.
 */
export async function placeOrder(
  outletId: string,
  orderType: OrderType,
  items: CartItem[],
  options: PlaceOrderOptions = {}
): Promise<PlaceOrderResult> {
  const idempotencyKey = options.idempotencyKey ?? crypto.randomUUID();
  const supabase = createClient();

  try {
    const { data, error } = await supabase.rpc("place_order", {
      p_outlet: outletId,
      p_order_type: orderType,
      p_items: items,
      p_idempotency_key: idempotencyKey,
      p_table_id: options.tableId ?? null,
      p_customer_id: options.customerId ?? null,
      p_note: options.note ?? null,
    });

    if (error) throw new OrderError(error.message, idempotencyKey);
    return data as PlaceOrderResult;
  } catch (err) {
    if (err instanceof OrderError) throw err;
    throw new OrderError((err as Error).message, idempotencyKey);
  }
}

/** Adds more items to an order that hasn't been settled/voided yet — the
 * "customer orders dessert after the mains" case. */
export async function addItemsToOrder(orderId: string, items: CartItem[]) {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("add_items_to_order", {
    p_order_id: orderId,
    p_items: items,
  });
  if (error) throw new Error(error.message);
  return data;
}

/** Advances an order one step forward (sent_to_kitchen -> ready ->
 * served). Any other transition is rejected server-side. */
export async function advanceOrderStatus(orderId: string, newStatus: "ready" | "served") {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("advance_order_status", {
    p_order_id: orderId,
    p_new_status: newStatus,
  });
  if (error) throw new Error(error.message);
  return data;
}

/** Voids a whole order, or a single line within it (pass orderItemId).
 * Manager/Owner/Supervisor only — enforced inside void_order() itself,
 * not by whatever this UI happens to show. */
export async function voidOrder(
  orderId: string,
  reasonCode: string,
  options: { reasonNote?: string; orderItemId?: string } = {}
) {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("void_order", {
    p_order_id: orderId,
    p_reason_code: reasonCode,
    p_reason_note: options.reasonNote ?? null,
    p_order_item_id: options.orderItemId ?? null,
  });
  if (error) throw new Error(error.message);
  return data;
}

// ---------------------------------------------------------------------
// Optimistic submit hook — shows "sending" the instant the cashier taps
// Send, before the server has responded, and reconciles once it does.
// On failure, `retry()` reuses the exact idempotency key from the failed
// attempt (see OrderError above) rather than generating a new one.
// ---------------------------------------------------------------------

export type PlaceOrderState =
  | { status: "idle" }
  | { status: "submitting" }
  | { status: "success"; order: OrderRecord }
  | { status: "error"; message: string; idempotencyKey: string };

export function usePlaceOrder(outletId: string) {
  const [state, setState] = useState<PlaceOrderState>({ status: "idle" });

  const run = useCallback(
    async (orderType: OrderType, items: CartItem[], options: PlaceOrderOptions = {}) => {
      setState({ status: "submitting" }); // optimistic — UI reflects "sent" immediately
      try {
        const result = await placeOrder(outletId, orderType, items, options);
        setState({ status: "success", order: result.order });
        return result;
      } catch (err) {
        const e = err as OrderError;
        setState({ status: "error", message: e.message, idempotencyKey: e.idempotencyKey });
        throw e;
      }
    },
    [outletId]
  );

  const submit = useCallback(
    (orderType: OrderType, items: CartItem[], options?: PlaceOrderOptions) =>
      run(orderType, items, options),
    [run]
  );

  const retry = useCallback(
    (orderType: OrderType, items: CartItem[], options?: PlaceOrderOptions) => {
      if (state.status !== "error") return Promise.resolve(undefined);
      return run(orderType, items, { ...options, idempotencyKey: state.idempotencyKey });
    },
    [run, state]
  );

  return { state, submit, retry };
}

// ---------------------------------------------------------------------
// Live order board — new/changed orders reach this within moments of
// place_order()/advance_order_status() committing, no polling. This is
// what KDS (Part 17) and POS (Part 16) are meant to consume.
// ---------------------------------------------------------------------

export function useIncomingOrders(outletId: string) {
  const [orders, setOrders] = useState<OrderRecord[]>([]);

  const reload = useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase
      .from("orders")
      .select("*")
      .eq("outlet_id", outletId)
      .in("status", ["sent_to_kitchen", "ready"])
      .order("created_at", { ascending: true });
    setOrders(castRows<OrderRecord>(data));
  }, [outletId]);

  useEffect(() => {
    reload();
    const supabase = createClient();
    const channel = supabase
      .channel(`orders-${outletId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "orders", filter: `outlet_id=eq.${outletId}` },
        reload
      )
      .on("postgres_changes", { event: "*", schema: "public", table: "order_items" }, reload)
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [outletId, reload]);

  return orders;
}

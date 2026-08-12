"use client";

import { useCallback, useEffect, useState } from "react";
import { placeOrder, OrderError, type OrderType, type CartItem, type PlaceOrderOptions } from "./orders";
import { isNetworkError } from "./offline-network";
import { offlineDb, type QueuedOrder } from "./offline-db";

/**
 * Offline-aware order placement — Part 20. "Order banao -> IndexedDB
 * mein likho (foran) -> UI update -> sync queue -> online hote hi
 * Supabase par bhejo -> idempotency key duplicate rokta hai" (brief §1),
 * built as a drop-in-shaped replacement for Part 09's usePlaceOrder()
 * rather than a change to it — that hook, and its tests
 * (tests/orders.test.ts), are untouched. app/pos/page.tsx uses THIS
 * hook instead.
 *
 * Deliberately does NOT cover addItemsToOrder() ("send more" to an
 * already-open table order) — that RPC has no idempotency-key concept
 * at all (see its own test's comment in tests/orders.test.ts), so
 * queuing it offline would risk a genuine duplicate insert on retry.
 * See docs/offline-mode.md for the reasoning and the resulting UI rule:
 * offline, a NEW order can be taken and queued; adding to an existing
 * open order cannot, and the POS screen says so plainly rather than
 * pretending it queued something it didn't.
 */

export type OfflineAwareState =
  | { status: "idle" }
  | { status: "submitting" }
  | { status: "success"; order: { id: string; order_no: number; status: string; [key: string]: unknown } }
  | { status: "queued"; idempotencyKey: string }
  | { status: "error"; message: string; idempotencyKey: string };

export function useOfflineAwarePlaceOrder(outletId: string) {
  const [state, setState] = useState<OfflineAwareState>({ status: "idle" });

  const run = useCallback(
    async (orderType: OrderType, items: CartItem[], options: PlaceOrderOptions = {}) => {
      setState({ status: "submitting" });
      const idempotencyKey = options.idempotencyKey ?? crypto.randomUUID();
      try {
        const result = await placeOrder(outletId, orderType, items, { ...options, idempotencyKey });
        setState({ status: "success", order: result.order });
        return { queued: false as const, duplicate: result.duplicate, order: result.order };
      } catch (err) {
        const e = err as OrderError;
        if (isNetworkError(e)) {
          await offlineDb.orderQueue.add({
            idempotencyKey,
            outletId,
            orderType,
            items,
            tableId: options.tableId,
            customerId: options.customerId,
            note: options.note,
            createdAt: new Date().toISOString(),
            attempts: 0,
            status: "pending",
          });
          setState({ status: "queued", idempotencyKey });
          return { queued: true as const, idempotencyKey };
        }
        setState({ status: "error", message: e.message, idempotencyKey });
        throw e;
      }
    },
    [outletId]
  );

  const submit = useCallback(
    (orderType: OrderType, items: CartItem[], options?: PlaceOrderOptions) => run(orderType, items, options),
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
// Draining the queue — one attempt per queued order, per reconnect.
// ---------------------------------------------------------------------

export type SyncOutcome = "synced" | "offline" | "rejected";

/** Pure — what a sync attempt's outcome means for the queue, given
 * whatever placeOrder() threw (or didn't). Split out from the hook
 * below so the actual decision logic is testable without touching
 * IndexedDB at all. */
export function classifySyncAttempt(err: unknown): SyncOutcome {
  if (!err) return "synced";
  return isNetworkError(err) ? "offline" : "rejected";
}

export function useSyncOfflineOrders(outletId: string) {
  const [pendingCount, setPendingCount] = useState(0);
  const [rejectedCount, setRejectedCount] = useState(0);
  const [syncing, setSyncing] = useState(false);

  const refresh = useCallback(async () => {
    const all = await offlineDb.orderQueue.where({ outletId }).toArray();
    setPendingCount(all.filter((o) => o.status === "pending").length);
    setRejectedCount(all.filter((o) => o.status === "rejected").length);
  }, [outletId]);

  /** Drains every PENDING queued order, oldest first — one at a time,
   * stopping the moment one attempt is still offline (no point burning
   * through the rest of the queue against the same dead connection). A
   * REJECTED order (a real server rejection, not a network problem) is
   * marked, kept visible, and never auto-retried again — see
   * classifySyncAttempt() above and this module's own header comment. */
  const sync = useCallback(async () => {
    setSyncing(true);
    try {
      const queued = (await offlineDb.orderQueue.where({ outletId }).toArray())
        .filter((o) => o.status === "pending")
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

      for (const q of queued) {
        let err: unknown = null;
        try {
          await placeOrder(q.outletId, q.orderType, q.items, {
            idempotencyKey: q.idempotencyKey,
            tableId: q.tableId,
            customerId: q.customerId,
            note: q.note,
          });
        } catch (e) {
          err = e;
        }

        const outcome = classifySyncAttempt(err);
        if (outcome === "synced") {
          await offlineDb.orderQueue.delete(q.id!);
        } else if (outcome === "rejected") {
          await offlineDb.orderQueue.update(q.id!, {
            status: "rejected",
            attempts: q.attempts + 1,
            lastError: (err as Error).message,
          });
        } else {
          // still offline — stop here, the rest of the queue will get
          // the same result right now.
          break;
        }
      }
    } finally {
      await refresh();
      setSyncing(false);
    }
  }, [outletId, refresh]);

  /** Lets a manager clear a rejected entry once they've handled it
   * (told the customer, re-entered it correctly, whatever the real
   * rejection reason called for) — never automatic, since silently
   * discarding a customer's order attempt is exactly the failure mode
   * this whole queue exists to prevent. */
  const dismissRejected = useCallback(
    async (id: number) => {
      await offlineDb.orderQueue.delete(id);
      await refresh();
    },
    [refresh]
  );

  useEffect(() => {
    refresh();
    sync();
    const onOnline = () => sync();
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outletId]);

  return { pendingCount, rejectedCount, syncing, sync, dismissRejected };
}

export async function listRejectedOrders(outletId: string): Promise<QueuedOrder[]> {
  return offlineDb.orderQueue.where({ outletId, status: "rejected" }).toArray();
}

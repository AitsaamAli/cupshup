"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { castRows } from "@/lib/supabase/rows";

/**
 * PRA eIMS integration — client side. The actual government API call
 * lives server-side only (app/api/pra/submit/route.ts) — never in
 * browser code, since a real vendor integration will need credentials
 * that must never reach the client. This file is the browser's view of
 * that pipe: submit one order, and reconcile whatever's stuck in the
 * queue.
 */

export interface PraSubmitResult {
  praInvoiceNo: string;
  praQrPayload: string;
}

export class PraSubmitError extends Error {}

/** Submits one order's invoice to PRA via the server route. On failure,
 * the route itself has already enqueued the order for retry
 * (enqueue_pra_submission()/record_pra_failure(), 0030_printing_
 * functions.sql) — the caller doesn't need to queue anything itself,
 * just decide how to tell the cashier ("printed locally, PRA sync
 * pending" is not a failure the print flow should block on). */
export async function submitToPra(orderId: string): Promise<PraSubmitResult> {
  const res = await fetch("/api/pra/submit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ orderId }),
  });
  const body = await res.json();
  if (!res.ok) throw new PraSubmitError(body.error ?? "PRA submission failed");
  return body as PraSubmitResult;
}

/**
 * The backoff schedule for a queued PRA submission — 2^attempts
 * minutes, capped at 60. Mirrors record_pra_failure()'s own SQL
 * (`least(power(2, attempts), 60) * interval '1 minute'`,
 * 0030_printing_functions.sql) exactly; kept as two independent
 * implementations (one authoritative in Postgres, one here for the
 * reconcile loop's own scheduling) rather than one calling the other,
 * since the database is the one that actually enforces it — this copy
 * only needs to roughly agree with it, not be its source of truth.
 */
export function nextRetryDelayMs(attempts: number): number {
  return Math.min(Math.pow(2, attempts), 60) * 60_000;
}

export interface PraQueueRow {
  id: string;
  order_id: string;
  status: "pending" | "failed" | "submitted";
  attempts: number;
  last_error: string | null;
  next_attempt_at: string;
}

/**
 * Reconciles the PRA queue — "connection aate hi bhejo aur reconcile
 * karo". Runs once on mount, and again whenever the browser regains
 * connectivity (same `online`-event pattern Part 17's KDS board uses to
 * catch up after a dropped connection), retrying every queued order
 * whose `next_attempt_at` has already passed.
 */
export function usePraReconcile(outletId: string) {
  const [pending, setPending] = useState<PraQueueRow[]>([]);
  const [reconciling, setReconciling] = useState(false);

  const reload = useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase
      .from("pra_submission_queue")
      .select("id, order_id, status, attempts, last_error, next_attempt_at")
      .in("status", ["pending", "failed"])
      .order("created_at");
    setPending(castRows<PraQueueRow>(data));
  }, []);

  const reconcile = useCallback(async () => {
    setReconciling(true);
    try {
      await reload();
      const supabase = createClient();
      const { data } = await supabase
        .from("pra_submission_queue")
        .select("id, order_id, status, attempts, last_error, next_attempt_at")
        .in("status", ["pending", "failed"])
        .lte("next_attempt_at", new Date().toISOString());
      const due = castRows<PraQueueRow>(data);
      for (const row of due) {
        try {
          await submitToPra(row.order_id);
        } catch {
          // The route already recorded the failure and rescheduled it —
          // nothing more to do here than move on to the next row.
          // Part 20's own alert: a PRA submission stuck past 5 attempts
          // (~30+ minutes of backoff, nextRetryDelayMs above) is no
          // longer "will sync momentarily" — someone should actually
          // look at it. Sentry.captureMessage() is a no-op until
          // NEXT_PUBLIC_SENTRY_DSN is set (instrumentation-client.ts).
          if (row.attempts >= 5) {
            import("@sentry/nextjs").then(({ captureMessage }) =>
              captureMessage(`PRA submission stuck: order ${row.order_id}, ${row.attempts} attempts`, "warning")
            );
          }
        }
      }
      await reload();
    } finally {
      setReconciling(false);
    }
  }, [reload]);

  useEffect(() => {
    reload();
    reconcile();
    const onOnline = () => reconcile();
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
    // outletId isn't read directly here — RLS already scopes every row
    // to the caller's own outlet (0029_printing_schema.sql's
    // read_pra_queue policy) — kept as a parameter anyway so a future
    // multi-outlet build has an obvious place to add an explicit filter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outletId]);

  return { pending, reconciling, reconcile };
}

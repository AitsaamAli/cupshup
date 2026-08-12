"use client";

import { usePrintQueue } from "@/lib/print-queue";

/**
 * Small header indicator for this device's own stuck-print queue —
 * "printer band ho to ... reprint queue mein aa jaye" needs to be
 * visible somewhere, or a queued kitchen ticket silently never reaches
 * the kitchen. Retries automatically (lib/print-queue.ts's own
 * on-reconnect logic); the button here is for "try again right now"
 * rather than waiting for the next automatic pass.
 */
export function PendingPrintsIndicator() {
  const { jobs, retrying, retryAll } = usePrintQueue();
  if (jobs.length === 0) return null;

  return (
    <button
      type="button"
      onClick={retryAll}
      disabled={retrying}
      className="rounded-md bg-danger/20 px-2 py-1 text-xs font-medium text-red-300 hover:bg-danger/30"
      title={jobs.map((j) => j.lastError).filter(Boolean).join("; ")}
    >
      {retrying ? "Retrying…" : `${jobs.length} print${jobs.length > 1 ? "s" : ""} pending — tap to retry`}
    </button>
  );
}

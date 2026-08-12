"use client";

import { useEffect, useState } from "react";

/**
 * Distinguishes a genuine network failure (the request never reached
 * the server at all) from the server actively REJECTING it — a real
 * business-rule error like "day closed" or "item 86'd" throws too, but
 * queuing that offline for later retry would just hide a legitimate
 * rejection behind a misleading "will sync when back online" message
 * forever, since reconnecting changes nothing about why it was
 * rejected. Every offline-queueing decision in this app
 * (lib/offline-orders.ts) goes through this check first.
 *
 * IMPORTANT, verified empirically against this project's actual
 * supabase-js version (not assumed): a network failure does NOT throw
 * — `.rpc()`/`.from().select()` resolve normally with
 * `{ data: null, error: { message: "TypeError: fetch failed", ... } }`,
 * a plain object, not a real thrown `Error`. So this checks the
 * MESSAGE TEXT of whatever it's given — a real `Error`/`OrderError`
 * instance (its `.message` already carries that same text straight
 * through from `error.message`, see placeOrder() in lib/orders.ts) or
 * a plain `{ message }`-shaped object — rather than the error's type or
 * `instanceof`, since neither reliably survives from "fetch actually
 * failed" to "the code deciding whether to queue this offline".
 */
export function isNetworkError(err: unknown): boolean {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return true;
  const message = err instanceof Error ? err.message : (err as { message?: unknown } | null | undefined)?.message;
  if (typeof message !== "string") return false;
  // Chrome: "Failed to fetch". Safari: "Load failed". Firefox:
  // "NetworkError when attempting to fetch resource". Node/undici
  // (what Postgrest's own error.message contains when supabase-js
  // itself couldn't reach the server): "TypeError: fetch failed".
  return /fetch failed|failed to fetch|network ?error|load failed/i.test(message);
}

/** Live `navigator.onLine` state — the browser's own signal is
 * optimistic (it only reflects "attached to a network," not "can
 * actually reach Supabase"), so this is a UI hint, not the thing that
 * decides whether to queue a request; isNetworkError() above, applied
 * to the request's own actual failure, is the real decision. */
export function useOnlineStatus(): boolean {
  const [online, setOnline] = useState(() => (typeof navigator === "undefined" ? true : navigator.onLine));

  useEffect(() => {
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  return online;
}

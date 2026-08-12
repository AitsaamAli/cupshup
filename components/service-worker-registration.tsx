"use client";

import { useEffect } from "react";

/**
 * Registers public/sw.js — Part 20. A component (not a top-level
 * effect in layout.tsx) purely so it can stay a plain client component
 * dropped once into the root layout, same shape as ToastProvider/
 * ShortcutsProvider next to it. Renders nothing.
 */
export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch((err) => {
      // Never let a failed SW registration break the app itself — the
      // POS still works online, it just won't have app-shell caching
      // for the next offline moment.
      console.error("Service worker registration failed:", err);
    });
  }, []);

  return null;
}

"use client";

import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { CheckIcon, WarningIcon } from "./icons";

type ToastKind = "info" | "success" | "error";
interface ToastItem {
  id: number;
  message: string;
  kind: ToastKind;
}

interface ToastContextValue {
  /** Shows a toast for 2 seconds. Keep `message` short and imperative —
   * see the copy rules in docs/design-system.md. "Sync failed. Retrying."
   * not "Saved on screen — sync failed, will retry next load." */
  showToast: (message: string, kind?: ToastKind) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const DURATION_MS = 2000;

const KIND_CLASSES: Record<ToastKind, string> = {
  info: "bg-ink-900 text-white",
  success: "bg-brand-600 text-white",
  error: "bg-danger text-white",
};

/**
 * Toast provider — Part 15. Wrap the app (or a screen) once with
 * `<ToastProvider>`, then call `useToast().showToast(...)` from
 * anywhere inside it. Every toast auto-dismisses after 2 seconds —
 * nothing in a POS should require a staff member to remember to
 * dismiss a notification mid-rush.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const showToast = useCallback((message: string, kind: ToastKind = "info") => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { id, message, kind }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, DURATION_MS);
  }, []);

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <div
        className="fixed bottom-4 left-1/2 z-[100] flex -translate-x-1/2 flex-col gap-2"
        role="status"
        aria-live="polite"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium shadow-none ${KIND_CLASSES[t.kind]}`}
          >
            {t.kind === "success" && <CheckIcon size={14} />}
            {t.kind === "error" && <WarningIcon size={14} />}
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast() must be used inside <ToastProvider>");
  return ctx;
}

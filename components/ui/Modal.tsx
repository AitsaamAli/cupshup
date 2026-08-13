"use client";

import { useEffect, type ReactNode } from "react";
import { CloseIcon } from "./icons";

/**
 * The one modal component every screen should use going forward —
 * Part 15. Closes on Escape (keyboard-first), traps nothing else —
 * deliberately simple. Radius capped at the design token, no shadow
 * (hierarchy comes from the border + backdrop, not a soft drop shadow).
 */
export function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="presentation">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        className="w-full max-w-sm rounded-lg border border-line bg-surface p-5 text-ink-900 shadow-[0_4px_12px_rgba(0,0,0,0.08)]"
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 id="modal-title" className="text-portal-base font-semibold text-ink-900">
            {title}
          </h3>
          <button
            onClick={onClose}
            aria-label="Close"
            className="flex h-11 w-11 items-center justify-center text-ink-500 hover:text-ink-900"
          >
            <CloseIcon />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

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
        className="w-full max-w-sm rounded-md border border-neutral-800 bg-neutral-900 p-5 text-white"
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 id="modal-title" className="font-medium">
            {title}
          </h3>
          <button
            onClick={onClose}
            aria-label="Close"
            className="flex h-11 w-11 items-center justify-center text-neutral-500 hover:text-white"
          >
            <CloseIcon />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

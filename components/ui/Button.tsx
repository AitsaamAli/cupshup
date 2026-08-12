"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "primary" | "secondary" | "danger" | "ghost";

const VARIANT_CLASSES: Record<Variant, string> = {
  // Brand green — reserved for the one primary action on a screen.
  primary: "bg-brand-600 text-white hover:bg-brand-700 disabled:bg-brand-600/40",
  // Neutral — every non-primary action. This is most buttons in the app.
  secondary: "bg-neutral-800 text-neutral-100 hover:bg-neutral-700 disabled:bg-neutral-800/40",
  // Reserved for destructive actions (void, delete) — the same red as
  // StatusBadge's "void" state, never used for anything else.
  danger: "bg-danger text-white hover:brightness-110 disabled:bg-danger/40",
  // No fill — for low-emphasis actions inside a row (Cancel, Edit link).
  ghost: "bg-transparent text-neutral-300 hover:bg-neutral-800",
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  children: ReactNode;
}

/**
 * The one button component every screen should use going forward —
 * Part 15. Minimum 44×44px touch target, visible focus ring (global,
 * see globals.css `:focus-visible`), radius capped at the design
 * system's token (never a soft 12–16px card look).
 */
export function Button({ variant = "secondary", className = "", disabled, children, ...props }: ButtonProps) {
  return (
    <button
      disabled={disabled}
      className={`inline-flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-md px-4 text-sm font-medium transition-colors disabled:cursor-not-allowed ${VARIANT_CLASSES[variant]} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}

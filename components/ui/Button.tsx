"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "primary" | "secondary" | "danger" | "ghost" | "quiet";
type Density = "portal" | "terminal";

const VARIANT_CLASSES: Record<Variant, string> = {
  // Brand green — reserved for the one primary action on a screen.
  primary: "bg-brand-600 text-white hover:bg-brand-700 disabled:bg-brand-600/40",
  // Border + surface — most buttons in the app.
  secondary: "border border-line bg-surface text-ink-900 hover:bg-canvas disabled:opacity-40",
  // Reserved for destructive actions (void, delete) — same red as
  // StatusBadge's "void" state, never used for anything else.
  danger: "bg-danger text-white hover:brightness-110 disabled:bg-danger/40",
  // No fill, no border — for a low-emphasis action inside a row.
  ghost: "bg-transparent text-ink-700 hover:bg-canvas",
  // Even quieter than ghost — a link-weight action (Cancel, Edit).
  quiet: "bg-transparent text-ink-500 hover:text-ink-900 px-1",
};

// Portal: 44px minimum touch target. Terminal: 56px — bigger, tapped in a
// hurry, sometimes with a wet or gloved hand.
const DENSITY_CLASSES: Record<Density, string> = {
  portal: "min-h-11 min-w-11 px-4 text-portal-sm gap-1.5 rounded-md",
  terminal: "min-h-14 min-w-14 px-5 text-terminal-base gap-2 rounded-md",
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  density?: Density;
  children: ReactNode;
}

/**
 * The one button component every screen uses. Touch target and type size
 * scale with `density` (portal vs terminal — MASTER-DESIGN-PROMPT §"design
 * tokens"); colour/border always come from tokens, never an inline hex.
 */
export function Button({
  variant = "secondary",
  density = "portal",
  className = "",
  disabled,
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      disabled={disabled}
      className={`inline-flex items-center justify-center font-medium transition-colors duration-[120ms] ease-out disabled:cursor-not-allowed ${DENSITY_CLASSES[density]} ${VARIANT_CLASSES[variant]} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}

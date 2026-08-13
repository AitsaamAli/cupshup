"use client";

import type { InputHTMLAttributes, LabelHTMLAttributes, ReactNode, SelectHTMLAttributes } from "react";

/**
 * Labelled text input built on the shared `.input` class (globals.css) —
 * the one place every input's border/radius/focus-ring is defined, so a
 * token change updates all of them at once. `inputMode` should be set by
 * the caller for money/quantity fields (MASTER-DESIGN-PROMPT's mobile
 * rules) — e.g. `inputMode="numeric"`.
 */
export function Field({ label, htmlFor, children, hint, error }: { label: string; htmlFor: string; children: ReactNode; hint?: string; error?: string }) {
  return (
    <label htmlFor={htmlFor} className="flex flex-col gap-1">
      <span className="text-portal-xs font-medium text-ink-700">{label}</span>
      {children}
      {error ? (
        <span className="text-portal-xs text-danger">{error}</span>
      ) : hint ? (
        <span className="text-portal-xs text-ink-500">{hint}</span>
      ) : null}
    </label>
  );
}

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input className="input" {...props} />;
}

export function Select({ children, ...props }: SelectHTMLAttributes<HTMLSelectElement> & { children: ReactNode }) {
  return (
    <select className="input" {...props}>
      {children}
    </select>
  );
}

export function FieldLabel(props: LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className="text-portal-xs font-medium text-ink-700" {...props} />;
}

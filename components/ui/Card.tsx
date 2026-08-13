import type { HTMLAttributes, ReactNode } from "react";

/**
 * A card with a thin border and NO drop shadow — the design direction's
 * one hard rule (elevation comes from border + background only; the sole
 * exception, modal/dropdown, lives in Modal.tsx, not here). Used for KPI
 * tiles, tool-card grids, and any grouped block on a Portal-density screen.
 */
export function Card({ className = "", children, ...props }: HTMLAttributes<HTMLDivElement> & { children: ReactNode }) {
  return (
    <div className={`rounded-lg border border-line bg-surface ${className}`} {...props}>
      {children}
    </div>
  );
}

/** Icon + title + subtitle tool card — Zameen's "Explore more" shape. */
export function ToolCard({
  icon,
  title,
  subtitle,
  href,
}: {
  icon: ReactNode;
  title: string;
  subtitle?: string;
  href: string;
}) {
  return (
    <a
      href={href}
      className="flex items-start gap-3 rounded-lg border border-line bg-surface p-4 transition-colors duration-[120ms] ease-out hover:bg-canvas"
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-brand-50 text-brand-700">{icon}</span>
      <span className="flex flex-col">
        <span className="text-portal-sm font-semibold text-ink-900">{title}</span>
        {subtitle && <span className="text-portal-xs text-ink-500">{subtitle}</span>}
      </span>
    </a>
  );
}

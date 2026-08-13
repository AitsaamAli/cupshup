/**
 * Loading placeholder — used instead of a spinner everywhere per the
 * "three states" rule (loading/success/error, all visible). A subtle
 * pulse only; `prefers-reduced-motion` already collapses all animation
 * globally (globals.css), so no separate check needed here.
 */
export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-md bg-line ${className}`} aria-hidden="true" />;
}

export function SkeletonRow({ cols = 4 }: { cols?: number }) {
  return (
    <div className="flex items-center gap-4 px-3 py-2.5">
      {Array.from({ length: cols }, (_, i) => (
        <Skeleton key={i} className="h-4 flex-1" />
      ))}
    </div>
  );
}

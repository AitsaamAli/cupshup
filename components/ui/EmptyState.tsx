import type { ReactNode } from "react";

/**
 * An empty-state message — Part 15. Copy is an invitation to do the
 * next thing, not a statement of absence: "No items yet — add your
 * first one" reads better mid-shift than a bare "Nothing here."
 */
export function EmptyState({
  message,
  action,
}: {
  message: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-md border border-dashed border-line py-10 text-center">
      <p className="text-portal-sm text-ink-500">{message}</p>
      {action}
    </div>
  );
}

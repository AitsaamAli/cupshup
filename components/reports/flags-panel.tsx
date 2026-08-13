import { WarningIcon } from "@/components/ui/icons";
import type { Flag } from "@/lib/reports";

const SEVERITY_CLASSES: Record<Flag["severity"], string> = {
  warning: "border-warning/40 bg-warning/10 text-warning",
  danger: "border-danger/40 bg-danger/10 text-danger",
};

/**
 * The flags list — Part 18 §4. Replaces the old system's single fake
 * "net loss" alert (rent landing on one day looked like a monthly
 * disaster every time) with the real, threshold-based set: nothing here
 * fires unless the underlying pure function in lib/reports.ts actually
 * crossed its documented threshold.
 */
export function FlagsPanel({ flags }: { flags: Flag[] }) {
  if (flags.length === 0) {
    return <p className="text-portal-sm text-ink-500">No flags — nothing crossed a threshold in this range.</p>;
  }
  return (
    <ul className="flex flex-col gap-2">
      {flags.map((f, i) => (
        <li
          key={`${f.type}-${i}`}
          className={`flex items-start gap-2 rounded-md border px-3 py-2 text-portal-sm ${SEVERITY_CLASSES[f.severity]}`}
        >
          <WarningIcon size={16} className="mt-0.5 shrink-0" />
          <span>{f.message}</span>
        </li>
      ))}
    </ul>
  );
}

"use client";

import { Button } from "@/components/ui/Button";
import { todayIso, daysAgoIso, startOfMonthIso } from "@/lib/date-range";

/**
 * From/to date range with three presets — Part 18. Every report page
 * queries a bounded range (lib/reports.ts's fetch functions all take
 * from/to), so this is the one control that drives all of them at once.
 */
export function DateRangePicker({
  from,
  to,
  onChange,
}: {
  from: string;
  to: string;
  onChange: (from: string, to: string) => void;
}) {
  const today = todayIso();

  return (
    <div className="flex flex-wrap items-end gap-3">
      <label className="flex flex-col gap-1 text-sm text-neutral-400">
        From
        <input
          type="date"
          className="input"
          value={from}
          max={to}
          onChange={(e) => onChange(e.target.value, to)}
        />
      </label>
      <label className="flex flex-col gap-1 text-sm text-neutral-400">
        To
        <input
          type="date"
          className="input"
          value={to}
          min={from}
          max={today}
          onChange={(e) => onChange(from, e.target.value)}
        />
      </label>
      <div className="flex gap-2">
        <Button type="button" variant="ghost" onClick={() => onChange(today, today)}>
          Today
        </Button>
        <Button type="button" variant="ghost" onClick={() => onChange(daysAgoIso(6), today)}>
          Last 7 days
        </Button>
        <Button type="button" variant="ghost" onClick={() => onChange(startOfMonthIso(), today)}>
          This month
        </Button>
      </div>
    </div>
  );
}

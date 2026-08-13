"use client";

import {
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { QUADRANT_LABEL, median, type MenuQuadrantItem } from "@/lib/reports";

// Mapped onto the fixed status tokens rather than one-off hex — stars
// (best of both) reads as success, dogs (worst of both) as danger, the
// two mixed quadrants as warning/info. Same meaning those colours carry
// everywhere else in the app.
const QUADRANT_COLOR: Record<MenuQuadrantItem["quadrant"], string> = {
  stars: "var(--status-success)",
  plow_horses: "var(--status-warning)",
  puzzles: "var(--status-info)",
  dogs: "var(--status-danger)",
};

/**
 * The Menu Engineering Matrix scatter — Part 18 §3a, the brief's own
 * "sabse kaam ki report". X is popularity (units sold), Y is margin %;
 * the reference lines sit at the SET's own median of each — see
 * lib/reports.ts's classifyMenuItems() for why "popular"/"high margin"
 * is always relative to this outlet's own other items, never a fixed
 * external number.
 */
export function MenuMatrixChart({ items }: { items: MenuQuadrantItem[] }) {
  if (items.length === 0) return <p className="text-portal-sm text-ink-500">No settled sales in this range.</p>;

  const qtyMedian = median(items.map((i) => i.qty));
  const marginMedian = median(items.map((i) => i.marginPercent));

  return (
    <ResponsiveContainer width="100%" height={340}>
      <ScatterChart margin={{ left: 8, right: 16, bottom: 8 }}>
        <CartesianGrid stroke="var(--line)" />
        <XAxis type="number" dataKey="qty" name="Units sold" stroke="var(--ink-500)" fontSize={12} />
        <YAxis
          type="number"
          dataKey="marginPercent"
          name="Margin %"
          unit="%"
          stroke="var(--ink-500)"
          fontSize={12}
        />
        <ReferenceLine x={qtyMedian} stroke="var(--ink-300)" strokeDasharray="4 4" />
        <ReferenceLine y={marginMedian} stroke="var(--ink-300)" strokeDasharray="4 4" />
        <Tooltip
          cursor={{ strokeDasharray: "3 3" }}
          contentStyle={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 6 }}
          content={({ payload }) => {
            const item = payload?.[0]?.payload as MenuQuadrantItem | undefined;
            if (!item) return null;
            return (
              <div className="rounded-md border border-line bg-surface px-3 py-2 text-portal-xs">
                <div className="font-medium text-ink-900">{item.name}</div>
                <div className="text-ink-500">
                  {item.qty} sold · {item.marginPercent.toFixed(1)}% margin
                </div>
                <div style={{ color: QUADRANT_COLOR[item.quadrant] }}>{QUADRANT_LABEL[item.quadrant]}</div>
              </div>
            );
          }}
        />
        {(Object.keys(QUADRANT_COLOR) as MenuQuadrantItem["quadrant"][]).map((q) => (
          <Scatter key={q} name={QUADRANT_LABEL[q]} data={items.filter((i) => i.quadrant === q)} fill={QUADRANT_COLOR[q]} />
        ))}
      </ScatterChart>
    </ResponsiveContainer>
  );
}

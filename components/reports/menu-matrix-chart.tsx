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

const QUADRANT_COLOR: Record<MenuQuadrantItem["quadrant"], string> = {
  stars: "#22a06a",
  plow_horses: "#f59e0b",
  puzzles: "#3D8FBF",
  dogs: "#ef4444",
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
  if (items.length === 0) return <p className="text-sm text-neutral-500">No settled sales in this range.</p>;

  const qtyMedian = median(items.map((i) => i.qty));
  const marginMedian = median(items.map((i) => i.marginPercent));

  return (
    <ResponsiveContainer width="100%" height={340}>
      <ScatterChart margin={{ left: 8, right: 16, bottom: 8 }}>
        <CartesianGrid stroke="#262626" />
        <XAxis type="number" dataKey="qty" name="Units sold" stroke="#737373" fontSize={12} />
        <YAxis
          type="number"
          dataKey="marginPercent"
          name="Margin %"
          unit="%"
          stroke="#737373"
          fontSize={12}
        />
        <ReferenceLine x={qtyMedian} stroke="#404040" strokeDasharray="4 4" />
        <ReferenceLine y={marginMedian} stroke="#404040" strokeDasharray="4 4" />
        <Tooltip
          cursor={{ strokeDasharray: "3 3" }}
          contentStyle={{ background: "#171717", border: "1px solid #404040", borderRadius: 6 }}
          content={({ payload }) => {
            const item = payload?.[0]?.payload as MenuQuadrantItem | undefined;
            if (!item) return null;
            return (
              <div className="rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-xs">
                <div className="font-medium">{item.name}</div>
                <div className="text-neutral-400">
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

"use client";

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatPaisa } from "@/lib/money";

export interface RevenueBarDatum {
  label: string;
  revenuePaisa: number;
}

/**
 * A generic "revenue by X" bar chart — Part 18. Shared by the Dashboard's
 * "top items" and "category revenue" charts, which are the same shape
 * (a label plus a paisa total) with a different source view behind them.
 */
export function RevenueBarChart({ data }: { data: RevenueBarDatum[] }) {
  if (data.length === 0) return <p className="text-portal-sm text-ink-500">No data in this range.</p>;

  return (
    <ResponsiveContainer width="100%" height={280}>
      <BarChart data={data} layout="vertical" margin={{ left: 24 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" horizontal={false} />
        <XAxis type="number" tickFormatter={(v: number) => (v / 100).toFixed(0)} stroke="var(--ink-500)" fontSize={12} />
        <YAxis type="category" dataKey="label" width={140} stroke="var(--ink-500)" fontSize={12} />
        <Tooltip
          formatter={(value) => formatPaisa(Number(value))}
          contentStyle={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 6, color: "var(--ink-900)" }}
        />
        <Bar dataKey="revenuePaisa" fill="var(--brand-600)" radius={[0, 4, 4, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

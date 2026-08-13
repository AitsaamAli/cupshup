"use client";

import { Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { formatPaisa } from "@/lib/money";
import type { PaymentMixRow } from "@/lib/reports";

const METHOD_LABEL: Record<string, string> = {
  cash: "Cash",
  card: "Card",
  jazzcash: "JazzCash",
  easypaisa: "Easypaisa",
  qr: "QR",
  foodpanda: "Foodpanda",
};

// Fixed brand-family colours, distinct per slice — never repurposed
// elsewhere (the design system's colour-meaning rule is about status
// colours; chart slices are the one place a wider palette is fine, since
// a pie chart's legend already labels each slice by name). First slot is
// the actual brand green so the "primary" payment method always reads
// as the same colour as every primary action in the app.
const COLORS = ["#1a8f5c", "#2a6fa8", "#c87a0a", "#c2453a", "#8B5FBF", "#5AB8C4"];

export function PaymentMixChart({ rows }: { rows: PaymentMixRow[] }) {
  const byMethod = new Map<string, number>();
  rows.forEach((r) => byMethod.set(r.method, (byMethod.get(r.method) ?? 0) + r.amount_paisa));
  const data = [...byMethod.entries()].map(([method, amount_paisa]) => ({
    name: METHOD_LABEL[method] ?? method,
    amount_paisa,
  }));

  if (data.length === 0) return <p className="text-portal-sm text-ink-500">No payments in this range.</p>;

  return (
    <ResponsiveContainer width="100%" height={260}>
      <PieChart>
        <Pie data={data} dataKey="amount_paisa" nameKey="name" outerRadius={90} label={(d) => d.name}>
          {data.map((_, i) => (
            <Cell key={i} fill={COLORS[i % COLORS.length]} />
          ))}
        </Pie>
        <Tooltip
          formatter={(value) => formatPaisa(Number(value))}
          contentStyle={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 6, color: "var(--ink-900)" }}
        />
        <Legend />
      </PieChart>
    </ResponsiveContainer>
  );
}

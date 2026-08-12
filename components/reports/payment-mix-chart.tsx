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
// elsewhere (Part 15's colour-meaning rule is about status colours;
// chart slices are the one place a wider palette is fine, since a pie
// chart's legend already labels each slice by name).
const COLORS = ["#22a06a", "#3D8FBF", "#C9902E", "#D64545", "#8B5FBF", "#5AB8C4"];

export function PaymentMixChart({ rows }: { rows: PaymentMixRow[] }) {
  const byMethod = new Map<string, number>();
  rows.forEach((r) => byMethod.set(r.method, (byMethod.get(r.method) ?? 0) + r.amount_paisa));
  const data = [...byMethod.entries()].map(([method, amount_paisa]) => ({
    name: METHOD_LABEL[method] ?? method,
    amount_paisa,
  }));

  if (data.length === 0) return <p className="text-sm text-neutral-500">No payments in this range.</p>;

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
          contentStyle={{ background: "#171717", border: "1px solid #404040", borderRadius: 6 }}
        />
        <Legend />
      </PieChart>
    </ResponsiveContainer>
  );
}

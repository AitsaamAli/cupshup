"use client";

import { useEffect, useState } from "react";
import { useStaffSession } from "@/lib/auth";
import { useBusinessDay } from "@/lib/business-day";
import { useIngredients } from "@/lib/inventory";
import {
  fetchIngredientPriceHistory,
  findPriceIncreaseAlerts,
  type PriceHistoryPoint,
  type PriceAlert,
} from "@/lib/purchases";
import { formatPaisa, type Paisa } from "@/lib/money";
import { AppShell } from "@/components/ui/AppShell";
import { Card } from "@/components/ui/Card";

const OUTLET_ID = process.env.NEXT_PUBLIC_SUPABASE_OUTLET_ID!;

const PORTAL_NAV = [
  { label: "Dashboard", href: "/reports/dashboard" },
  { label: "Master P&L", href: "/reports/pl" },
  { label: "Menu", href: "/manage/menu" },
  { label: "Inventory", href: "/manage/inventory" },
  { label: "Purchases", href: "/manage/purchases" },
  { label: "Expenses", href: "/manage/expenses" },
  { label: "Business day", href: "/manage/day" },
  { label: "House accounts", href: "/manage/house-accounts" },
];

/**
 * Ingredient price history + rate-increase alerts — Part 12. "Cheese ka
 * rate pichle mahine se 18% barh gaya — menu price dekh lein." Alerts
 * fire when the latest purchase cost is 10%+ above the one before it.
 */
export default function PriceHistoryPage() {
  const { staff, loading: staffLoading, lock } = useStaffSession("manage");
  const { day } = useBusinessDay(OUTLET_ID);
  const ingredients = useIngredients(OUTLET_ID);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [history, setHistory] = useState<PriceHistoryPoint[]>([]);
  const [alerts, setAlerts] = useState<PriceAlert[] | null>(null);

  useEffect(() => {
    findPriceIncreaseAlerts(OUTLET_ID).then(setAlerts);
  }, []);

  useEffect(() => {
    if (!selectedId) return;
    fetchIngredientPriceHistory(selectedId).then(setHistory);
  }, [selectedId]);

  if (staffLoading) return <div className="min-h-screen bg-canvas" />;

  if (staff && staff.role !== "owner" && staff.role !== "manager") {
    return <p className="p-8 text-portal-sm text-ink-500">Only Owner/Manager can view price history.</p>;
  }

  const maxCost = Math.max(1, ...history.map((h) => h.unit_cost_paisa));

  return (
    <AppShell
      density="portal"
      nav={PORTAL_NAV}
      crumbs={[{ label: "Purchases" }, { label: "Ingredient prices" }]}
      staff={staff}
      dayStatus={day?.status === "open" ? "open" : "closed"}
      onLock={lock}
    >
      <div className="p-4">
        <h1 className="mb-4 text-portal-xl font-semibold text-ink-900">Ingredient Price History</h1>

        {alerts === null ? (
          <p className="mb-4 text-portal-sm text-ink-500">Checking for price increases…</p>
        ) : alerts.length > 0 ? (
          <Card className="mb-4 border-warning/50 bg-warning/10 p-4">
            <h2 className="mb-2 text-portal-sm font-semibold text-warning">Rate increase alerts</h2>
            <ul className="space-y-1 text-portal-sm text-warning">
              {alerts.map((a) => (
                <li key={a.ingredientId}>
                  {a.ingredientName}: {formatPaisa(a.previousCostPaisa as Paisa)} →{" "}
                  {formatPaisa(a.latestCostPaisa as Paisa)} ({a.percentIncrease.toFixed(0)}% up) — menu
                  price review karein
                </li>
              ))}
            </ul>
          </Card>
        ) : (
          <p className="mb-4 text-portal-sm text-ink-500">No ingredient has risen 10%+ since its last purchase.</p>
        )}

        <div className="flex gap-6">
          <nav className="w-56 shrink-0 space-y-1">
            {ingredients.map((ing) => (
              <button
                key={ing.id}
                onClick={() => setSelectedId(ing.id)}
                className={`block w-full rounded-md px-3 py-2 text-left text-portal-sm transition-colors duration-[120ms] ease-out ${
                  ing.id === selectedId ? "bg-brand-600 text-white" : "bg-surface text-ink-700 hover:bg-canvas"
                }`}
              >
                {ing.name}
              </button>
            ))}
          </nav>

          <Card className="flex-1 p-4">
            {!selectedId ? (
              <p className="text-portal-sm text-ink-500">Pick an ingredient to see its purchase price history.</p>
            ) : history.length === 0 ? (
              <p className="text-portal-sm text-ink-500">No purchases recorded yet for this ingredient.</p>
            ) : (
              <div className="space-y-2">
                {history.map((point, i) => (
                  <div key={i} className="flex items-center gap-3">
                    <span className="w-24 shrink-0 text-portal-xs text-ink-500">
                      {new Date(point.created_at).toLocaleDateString()}
                    </span>
                    <div className="h-4 flex-1 rounded-sm bg-canvas">
                      <div
                        className="h-4 rounded-sm bg-brand-600"
                        style={{ width: `${(point.unit_cost_paisa / maxCost) * 100}%` }}
                      />
                    </div>
                    <span className="w-20 shrink-0 text-right text-portal-xs tabular-nums text-ink-500">
                      {formatPaisa(point.unit_cost_paisa as Paisa)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>
    </AppShell>
  );
}

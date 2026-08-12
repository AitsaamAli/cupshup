"use client";

import { useEffect, useState } from "react";
import { useStaffSession } from "@/lib/auth";
import { useIngredients } from "@/lib/inventory";
import {
  fetchIngredientPriceHistory,
  findPriceIncreaseAlerts,
  type PriceHistoryPoint,
  type PriceAlert,
} from "@/lib/purchases";
import { formatPaisa, type Paisa } from "@/lib/money";

const OUTLET_ID = process.env.NEXT_PUBLIC_SUPABASE_OUTLET_ID!;

/**
 * Ingredient price history + rate-increase alerts — Part 12. "Cheese ka
 * rate pichle mahine se 18% barh gaya — menu price dekh lein." Alerts
 * fire when the latest purchase cost is 10%+ above the one before it.
 */
export default function PriceHistoryPage() {
  const { staff } = useStaffSession("manage");
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

  if (staff && staff.role !== "owner" && staff.role !== "manager") {
    return <p className="p-8 text-neutral-400">Only Owner/Manager can view price history.</p>;
  }

  const maxCost = Math.max(1, ...history.map((h) => h.unit_cost_paisa));

  return (
    <main className="min-h-screen bg-neutral-950 p-6 text-white">
      <h1 className="mb-6 text-xl font-semibold">Ingredient Price History</h1>

      {alerts === null ? (
        <p className="text-neutral-400">Checking for price increases…</p>
      ) : alerts.length > 0 ? (
        <section className="mb-6 rounded-md border border-amber-500/50 bg-amber-500/10 p-4">
          <h2 className="mb-2 text-sm font-semibold text-amber-300">Rate increase alerts</h2>
          <ul className="space-y-1 text-sm text-amber-200">
            {alerts.map((a) => (
              <li key={a.ingredientId}>
                {a.ingredientName}: {formatPaisa(a.previousCostPaisa as Paisa)} →{" "}
                {formatPaisa(a.latestCostPaisa as Paisa)} ({a.percentIncrease.toFixed(0)}% up) — menu
                price review karein
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <p className="mb-6 text-sm text-neutral-500">No ingredient has risen 10%+ since its last purchase.</p>
      )}

      <div className="flex gap-6">
        <nav className="w-56 shrink-0 space-y-1">
          {ingredients.map((ing) => (
            <button
              key={ing.id}
              onClick={() => setSelectedId(ing.id)}
              className={`block w-full rounded-md px-3 py-2 text-left text-sm ${
                ing.id === selectedId ? "bg-white text-neutral-950" : "bg-neutral-900 text-neutral-200"
              }`}
            >
              {ing.name}
            </button>
          ))}
        </nav>

        <section className="flex-1">
          {!selectedId ? (
            <p className="text-neutral-500">Pick an ingredient to see its purchase price history.</p>
          ) : history.length === 0 ? (
            <p className="text-neutral-500">No purchases recorded yet for this ingredient.</p>
          ) : (
            <div className="space-y-2">
              {history.map((point, i) => (
                <div key={i} className="flex items-center gap-3">
                  <span className="w-24 shrink-0 text-xs text-neutral-500">
                    {new Date(point.created_at).toLocaleDateString()}
                  </span>
                  <div className="h-4 flex-1 rounded bg-neutral-900">
                    <div
                      className="h-4 rounded bg-emerald-500"
                      style={{ width: `${(point.unit_cost_paisa / maxCost) * 100}%` }}
                    />
                  </div>
                  <span className="w-20 shrink-0 text-right text-xs text-neutral-400">
                    {formatPaisa(point.unit_cost_paisa as Paisa)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

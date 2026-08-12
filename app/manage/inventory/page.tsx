"use client";

import { useState } from "react";
import { useStaffSession } from "@/lib/auth";
import {
  useIngredientStock,
  logWastage,
  recordPurchase,
  WASTAGE_REASONS,
  type IngredientStockRow,
} from "@/lib/inventory";
import { formatPaisa, rupeesToPaisa, type Paisa } from "@/lib/money";
import { Modal } from "@/components/ui/Modal";

const OUTLET_ID = process.env.NEXT_PUBLIC_SUPABASE_OUTLET_ID!;
const CAN_PURCHASE = new Set(["owner", "manager"]);
const CAN_LOG_WASTAGE = new Set(["owner", "manager", "supervisor", "chef", "kitchen", "barista"]);

/**
 * Inventory overview — Part 11. Current stock is always the
 * ingredient_stock view's SUM of the stock_movements ledger, never a
 * stored column, and updates live via Realtime the instant a sale,
 * wastage entry, or count correction changes anything.
 */
export default function InventoryPage() {
  const { staff } = useStaffSession("manage");
  const { rows, loading, reload } = useIngredientStock(OUTLET_ID);
  const [wastageFor, setWastageFor] = useState<IngredientStockRow | null>(null);
  const [purchaseFor, setPurchaseFor] = useState<IngredientStockRow | null>(null);

  const canPurchase = !!staff && CAN_PURCHASE.has(staff.role);
  const canLogWastage = !!staff && CAN_LOG_WASTAGE.has(staff.role);
  const lowStockCount = rows.filter((r) => r.is_low).length;

  if (loading) return <p className="p-8 text-neutral-400">Loading inventory…</p>;

  return (
    <main className="min-h-screen bg-neutral-950 p-6 text-white">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Inventory</h1>
          <p className="text-sm text-neutral-400">{staff?.name} — {staff?.role}</p>
        </div>
        <nav className="flex gap-4 text-sm text-neutral-300 underline">
          <a href="/manage/inventory/recipes">Recipes</a>
          <a href="/manage/inventory/count">Physical count</a>
          <a href="/manage/inventory/variance">Variance report</a>
        </nav>
      </header>

      {lowStockCount > 0 && (
        <p className="mb-4 rounded-md border border-amber-500/50 bg-amber-500/10 px-4 py-2 text-sm text-amber-300">
          {lowStockCount} ingredient{lowStockCount > 1 ? "s" : ""} at or below minimum stock
        </p>
      )}

      <table className="w-full text-left text-sm">
        <thead className="text-neutral-500">
          <tr>
            <th className="pb-2 pr-4">Ingredient</th>
            <th className="pb-2 pr-4">Stock</th>
            <th className="pb-2 pr-4">Min</th>
            <th className="pb-2 pr-4">Avg cost</th>
            <th className="pb-2 pr-4"></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="border-t border-neutral-800">
              <td className="py-2 pr-4">{row.name}</td>
              <td className={`py-2 pr-4 tabular-nums ${row.is_low ? "text-amber-400" : ""}`}>
                {row.current_stock} {row.unit}
              </td>
              <td className="py-2 pr-4 text-neutral-500">
                {row.min_stock} {row.unit}
              </td>
              <td className="py-2 pr-4 text-neutral-400">
                {formatPaisa(row.moving_avg_cost_paisa as Paisa)}/{row.unit}
              </td>
              <td className="py-2 pr-4 text-right">
                {canLogWastage && (
                  <button onClick={() => setWastageFor(row)} className="mr-3 text-neutral-400 underline">
                    Log wastage
                  </button>
                )}
                {canPurchase && (
                  <button onClick={() => setPurchaseFor(row)} className="text-neutral-400 underline">
                    Record purchase
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {wastageFor && (
        <WastageDialog
          ingredient={wastageFor}
          onClose={() => setWastageFor(null)}
          onSaved={() => {
            setWastageFor(null);
            reload();
          }}
        />
      )}
      {purchaseFor && (
        <PurchaseDialog
          ingredient={purchaseFor}
          onClose={() => setPurchaseFor(null)}
          onSaved={() => {
            setPurchaseFor(null);
            reload();
          }}
        />
      )}
    </main>
  );
}

function WastageDialog({
  ingredient,
  onClose,
  onSaved,
}: {
  ingredient: IngredientStockRow;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [reasonCode, setReasonCode] = useState(WASTAGE_REASONS[0].code);
  const [qty, setQty] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    const n = Number(qty);
    if (!Number.isFinite(n) || n <= 0) {
      setError("Enter a valid quantity.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const reason = WASTAGE_REASONS.find((r) => r.code === reasonCode)!;
      await logWastage(ingredient.outlet_id, ingredient.id, n, reason.code, reason.movementType);
      onSaved();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={`Log wastage — ${ingredient.name}`} onClose={onClose}>
      <div className="space-y-3">
        <Field label="Reason">
          <select value={reasonCode} onChange={(e) => setReasonCode(e.target.value)} className="input">
            {WASTAGE_REASONS.map((r) => (
              <option key={r.code} value={r.code}>
                {r.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label={`Quantity (${ingredient.unit})`}>
          <input
            type="number"
            step="0.001"
            value={qty}
            onChange={(e) => setQty(e.target.value)}
            className="input"
            autoFocus
          />
        </Field>
        {error && <p className="text-sm text-red-400">{error}</p>}
        <DialogActions onCancel={onClose} onConfirm={submit} saving={saving} label="Log wastage" />
      </div>
    </Modal>
  );
}

function PurchaseDialog({
  ingredient,
  onClose,
  onSaved,
}: {
  ingredient: IngredientStockRow;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [qty, setQty] = useState("");
  const [unitCostRupees, setUnitCostRupees] = useState(
    String(ingredient.moving_avg_cost_paisa / 100)
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    const q = Number(qty);
    const cost = Number(unitCostRupees);
    if (!Number.isFinite(q) || q <= 0) {
      setError("Enter a valid quantity.");
      return;
    }
    if (!Number.isFinite(cost) || cost < 0) {
      setError("Enter a valid unit cost.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await recordPurchase(ingredient.id, q, rupeesToPaisa(cost));
      onSaved();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={`Record purchase — ${ingredient.name}`} onClose={onClose}>
      <div className="space-y-3">
        <Field label={`Quantity received (${ingredient.unit})`}>
          <input
            type="number"
            step="0.001"
            value={qty}
            onChange={(e) => setQty(e.target.value)}
            className="input"
            autoFocus
          />
        </Field>
        <Field label={`Unit cost (Rs / ${ingredient.unit})`}>
          <input
            type="number"
            step="0.01"
            value={unitCostRupees}
            onChange={(e) => setUnitCostRupees(e.target.value)}
            className="input"
          />
        </Field>
        <p className="text-xs text-neutral-500">
          Updates the ingredient&apos;s average cost as a weighted average of what was already on
          hand and what just arrived.
        </p>
        {error && <p className="text-sm text-red-400">{error}</p>}
        <DialogActions onCancel={onClose} onConfirm={submit} saving={saving} label="Record purchase" />
      </div>
    </Modal>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs text-neutral-400">{label}</span>
      {children}
    </label>
  );
}

function DialogActions({
  onCancel,
  onConfirm,
  saving,
  label,
}: {
  onCancel: () => void;
  onConfirm: () => void;
  saving: boolean;
  label: string;
}) {
  return (
    <div className="flex justify-end gap-2 pt-2">
      <button onClick={onCancel} className="rounded-md px-4 py-2 text-sm text-neutral-400">
        Cancel
      </button>
      <button
        onClick={onConfirm}
        disabled={saving}
        className="rounded-md bg-white px-4 py-2 text-sm font-medium text-neutral-950 disabled:opacity-50"
      >
        {saving ? "Saving…" : label}
      </button>
    </div>
  );
}

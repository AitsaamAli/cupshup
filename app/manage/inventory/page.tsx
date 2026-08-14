"use client";

import { useState } from "react";
import Link from "next/link";
import { useStaffSession } from "@/lib/auth";
import { useBusinessDay } from "@/lib/business-day";
import {
  useIngredientStock,
  logWastage,
  recordPurchase,
  WASTAGE_REASONS,
  type IngredientStockRow,
} from "@/lib/inventory";
import { formatPaisa, rupeesToPaisa, type Paisa } from "@/lib/money";
import { AppShell } from "@/components/ui/AppShell";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { DataTable, type DataTableColumn } from "@/components/ui/DataTable";

const OUTLET_ID = process.env.NEXT_PUBLIC_SUPABASE_OUTLET_ID!;
const CAN_PURCHASE = new Set(["owner", "manager"]);
const CAN_LOG_WASTAGE = new Set(["owner", "manager", "supervisor", "chef", "kitchen", "barista"]);

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
 * Inventory overview — Part 11. Current stock is always the
 * ingredient_stock view's SUM of the stock_movements ledger, never a
 * stored column, and updates live via Realtime the instant a sale,
 * wastage entry, or count correction changes anything.
 */
export default function InventoryPage() {
  const { staff, loading: staffLoading, lock } = useStaffSession("manage");
  const { day } = useBusinessDay(OUTLET_ID);
  const { rows, loading, reload } = useIngredientStock(OUTLET_ID);
  const [wastageFor, setWastageFor] = useState<IngredientStockRow | null>(null);
  const [purchaseFor, setPurchaseFor] = useState<IngredientStockRow | null>(null);

  const canPurchase = !!staff && CAN_PURCHASE.has(staff.role);
  const canLogWastage = !!staff && CAN_LOG_WASTAGE.has(staff.role);
  const lowStockCount = rows.filter((r) => r.is_low).length;

  const columns: DataTableColumn<IngredientStockRow>[] = [
    { key: "name", header: "Ingredient", sortValue: (r) => r.name, render: (r) => r.name },
    {
      key: "stock",
      header: "Stock",
      align: "right",
      numeric: true,
      sortValue: (r) => r.current_stock,
      render: (r) => (
        <span className={r.is_low ? "text-warning" : "text-ink-900"}>
          {r.current_stock} {r.unit}
        </span>
      ),
    },
    {
      key: "min",
      header: "Min",
      align: "right",
      numeric: true,
      render: (r) => (
        <span className="text-ink-500">
          {r.min_stock} {r.unit}
        </span>
      ),
    },
    {
      key: "cost",
      header: "Avg cost",
      align: "right",
      numeric: true,
      render: (r) => (
        <span className="text-ink-500">
          {formatPaisa(r.moving_avg_cost_paisa as Paisa)}/{r.unit}
        </span>
      ),
    },
    {
      key: "actions",
      header: "",
      align: "right",
      render: (r) => (
        <div className="flex justify-end gap-3">
          {canLogWastage && (
            <Button variant="quiet" onClick={() => setWastageFor(r)}>
              Log wastage
            </Button>
          )}
          {canPurchase && (
            <Button variant="quiet" onClick={() => setPurchaseFor(r)}>
              Record purchase
            </Button>
          )}
        </div>
      ),
    },
  ];

  if (staffLoading) return <div className="min-h-screen bg-canvas" />;

  return (
    <AppShell
      density="portal"
      nav={PORTAL_NAV}
      crumbs={[{ label: "Inventory" }]}
      staff={staff}
      dayStatus={day?.status === "open" ? "open" : "closed"}
      onLock={lock}
    >
      <div className="p-4">
        <div className="mb-4 flex items-center justify-between">
          <h1 className="text-portal-xl font-semibold text-ink-900">Inventory</h1>
          <nav className="flex gap-4 text-portal-sm text-brand-700">
            <Link href="/manage/inventory/recipes" className="hover:underline">
              Recipes
            </Link>
            <Link href="/manage/inventory/count" className="hover:underline">
              Physical count
            </Link>
            <Link href="/manage/inventory/variance" className="hover:underline">
              Variance report
            </Link>
          </nav>
        </div>

        {lowStockCount > 0 && (
          <p className="mb-4 rounded-md border border-warning/50 bg-warning/10 px-4 py-2 text-portal-sm text-warning">
            {lowStockCount} ingredient{lowStockCount > 1 ? "s" : ""} at or below minimum stock
          </p>
        )}

        <Card className="p-4">
          {loading ? (
            <p className="text-portal-sm text-ink-500">Loading inventory…</p>
          ) : (
            <DataTable columns={columns} rows={rows} keyExtractor={(r) => r.id} emptyMessage="No ingredients yet." />
          )}
        </Card>
      </div>

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
    </AppShell>
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
        <Field label="Reason" htmlFor="wastage-reason">
          <Select id="wastage-reason" value={reasonCode} onChange={(e) => setReasonCode(e.target.value)}>
            {WASTAGE_REASONS.map((r) => (
              <option key={r.code} value={r.code}>
                {r.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={`Quantity (${ingredient.unit})`} htmlFor="wastage-qty">
          <Input id="wastage-qty" type="number" step="0.001" value={qty} onChange={(e) => setQty(e.target.value)} autoFocus />
        </Field>
        {error && <p className="text-portal-sm text-danger">{error}</p>}
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
        <Field label={`Quantity received (${ingredient.unit})`} htmlFor="purchase-qty">
          <Input id="purchase-qty" type="number" step="0.001" value={qty} onChange={(e) => setQty(e.target.value)} autoFocus />
        </Field>
        <Field label={`Unit cost (Rs / ${ingredient.unit})`} htmlFor="purchase-cost">
          <Input
            id="purchase-cost"
            type="number"
            step="0.01"
            value={unitCostRupees}
            onChange={(e) => setUnitCostRupees(e.target.value)}
          />
        </Field>
        <p className="text-portal-xs text-ink-500">
          Updates the ingredient&apos;s average cost as a weighted average of what was already on
          hand and what just arrived.
        </p>
        {error && <p className="text-portal-sm text-danger">{error}</p>}
        <DialogActions onCancel={onClose} onConfirm={submit} saving={saving} label="Record purchase" />
      </div>
    </Modal>
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
      <Button variant="quiet" onClick={onCancel}>
        Cancel
      </Button>
      <Button variant="primary" onClick={onConfirm} disabled={saving}>
        {saving ? "Saving…" : label}
      </Button>
    </div>
  );
}

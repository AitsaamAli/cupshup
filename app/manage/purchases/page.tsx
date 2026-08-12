"use client";

import { useState } from "react";
import { useStaffSession } from "@/lib/auth";
import { useIngredients } from "@/lib/inventory";
import {
  useSuppliers,
  usePurchases,
  recordPurchaseGrn,
  recordPurchaseReturn,
  type GrnLineInput,
  type Purchase,
} from "@/lib/purchases";
import { formatPaisa, rupeesToPaisa, type Paisa } from "@/lib/money";
import { createClient } from "@/lib/supabase/client";

const OUTLET_ID = process.env.NEXT_PUBLIC_SUPABASE_OUTLET_ID!;
const CAN_RECEIVE = new Set(["owner", "manager"]);

type DraftLine = { ingredientId: string; qtyText: string; unitCostRupeesText: string };

/**
 * Goods Receipt Note (GRN) — Part 12. Every line here goes through
 * record_purchase_grn() in one transaction: the purchase header, every
 * line, every line's stock_movement, and every line's weighted-average
 * cost update all succeed together or none do.
 */
export default function PurchasesPage() {
  const { staff } = useStaffSession("manage");
  const { suppliers } = useSuppliers(OUTLET_ID);
  const ingredients = useIngredients(OUTLET_ID);
  const { purchases, loading, reload } = usePurchases(OUTLET_ID);

  const canReceive = !!staff && CAN_RECEIVE.has(staff.role);

  const [supplierId, setSupplierId] = useState("");
  const [invoiceRef, setInvoiceRef] = useState("");
  const [paymentStatus, setPaymentStatus] = useState<"paid" | "credit" | "partial">("credit");
  const [amountPaidRupees, setAmountPaidRupees] = useState("0");
  const [invoiceFile, setInvoiceFile] = useState<File | null>(null);
  const [lines, setLines] = useState<DraftLine[]>([{ ingredientId: "", qtyText: "", unitCostRupeesText: "" }]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [returnFor, setReturnFor] = useState<Purchase | null>(null);

  const grandTotalPaisa = lines.reduce((sum, l) => {
    const qty = Number(l.qtyText) || 0;
    const cost = rupeesToPaisa(Number(l.unitCostRupeesText) || 0);
    return sum + Math.round(qty * cost);
  }, 0);

  function updateLine(i: number, patch: Partial<DraftLine>) {
    setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }

  async function uploadInvoicePhoto(): Promise<string | undefined> {
    if (!invoiceFile) return undefined;
    const supabase = createClient();
    const path = `${supplierId}/${Date.now()}-${invoiceFile.name}`;
    const { error: uploadError } = await supabase.storage
      .from("purchase-invoices")
      .upload(path, invoiceFile);
    if (uploadError) throw new Error(`Invoice upload failed: ${uploadError.message}`);
    const { data } = supabase.storage.from("purchase-invoices").getPublicUrl(path);
    return data.publicUrl;
  }

  async function submitGrn() {
    setError(null);
    if (!supplierId) {
      setError("Pick a supplier.");
      return;
    }
    const grnLines: GrnLineInput[] = [];
    for (const l of lines) {
      if (!l.ingredientId) continue;
      const qty = Number(l.qtyText);
      const cost = Number(l.unitCostRupeesText);
      if (!Number.isFinite(qty) || qty <= 0 || !Number.isFinite(cost) || cost < 0) {
        setError("Every line needs a valid quantity and unit cost.");
        return;
      }
      grnLines.push({ ingredient_id: l.ingredientId, qty, unit_cost_paisa: rupeesToPaisa(cost) });
    }
    if (grnLines.length === 0) {
      setError("Add at least one line.");
      return;
    }

    setSaving(true);
    try {
      const invoicePhotoUrl = await uploadInvoicePhoto();
      await recordPurchaseGrn(supplierId, grnLines, {
        invoiceRef: invoiceRef || undefined,
        paymentStatus,
        amountPaidPaisa: rupeesToPaisa(Number(amountPaidRupees) || 0),
        invoicePhotoUrl,
      });
      setSupplierId("");
      setInvoiceRef("");
      setPaymentStatus("credit");
      setAmountPaidRupees("0");
      setInvoiceFile(null);
      setLines([{ ingredientId: "", qtyText: "", unitCostRupeesText: "" }]);
      reload();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="min-h-screen bg-neutral-950 p-6 text-white">
      <header className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Purchases (GRN)</h1>
        <nav className="flex gap-4 text-sm text-neutral-300 underline">
          <a href="/manage/suppliers">Suppliers</a>
          <a href="/manage/purchases/prices">Price history &amp; alerts</a>
        </nav>
      </header>

      {canReceive && (
        <section className="mb-8 rounded-md border border-neutral-800 p-4">
          <h2 className="mb-3 font-medium">Receive delivery</h2>
          <div className="mb-3 grid grid-cols-3 gap-3">
            <label className="block">
              <span className="mb-1 block text-xs text-neutral-400">Supplier</span>
              <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)} className="input">
                <option value="">Select…</option>
                {suppliers
                  .filter((s) => s.active)
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-xs text-neutral-400">Invoice reference</span>
              <input value={invoiceRef} onChange={(e) => setInvoiceRef(e.target.value)} className="input" />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs text-neutral-400">Invoice photo</span>
              <input
                type="file"
                accept="image/*"
                onChange={(e) => setInvoiceFile(e.target.files?.[0] ?? null)}
                className="text-sm text-neutral-400"
              />
            </label>
          </div>

          <div className="mb-3 space-y-2">
            {lines.map((line, i) => (
              <div key={i} className="grid grid-cols-4 items-end gap-2">
                <label className="block">
                  <span className="mb-1 block text-xs text-neutral-400">Ingredient</span>
                  <select
                    value={line.ingredientId}
                    onChange={(e) => updateLine(i, { ingredientId: e.target.value })}
                    className="input"
                  >
                    <option value="">Select…</option>
                    {ingredients.map((ing) => (
                      <option key={ing.id} value={ing.id}>
                        {ing.name} ({ing.unit})
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs text-neutral-400">Qty</span>
                  <input
                    type="number"
                    step="0.001"
                    value={line.qtyText}
                    onChange={(e) => updateLine(i, { qtyText: e.target.value })}
                    className="input"
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs text-neutral-400">Unit cost (Rs)</span>
                  <input
                    type="number"
                    step="0.01"
                    value={line.unitCostRupeesText}
                    onChange={(e) => updateLine(i, { unitCostRupeesText: e.target.value })}
                    className="input"
                  />
                </label>
                {lines.length > 1 && (
                  <button
                    onClick={() => setLines((prev) => prev.filter((_, idx) => idx !== i))}
                    className="text-sm text-red-400 underline"
                  >
                    Remove
                  </button>
                )}
              </div>
            ))}
            <button
              onClick={() => setLines((prev) => [...prev, { ingredientId: "", qtyText: "", unitCostRupeesText: "" }])}
              className="text-sm text-neutral-400 underline"
            >
              + Add line
            </button>
          </div>

          <div className="mb-3 grid grid-cols-3 gap-3">
            <label className="block">
              <span className="mb-1 block text-xs text-neutral-400">Payment status</span>
              <select
                value={paymentStatus}
                onChange={(e) => setPaymentStatus(e.target.value as typeof paymentStatus)}
                className="input"
              >
                <option value="credit">Credit</option>
                <option value="partial">Partial</option>
                <option value="paid">Paid</option>
              </select>
            </label>
            {paymentStatus !== "credit" && (
              <label className="block">
                <span className="mb-1 block text-xs text-neutral-400">Amount paid (Rs)</span>
                <input
                  type="number"
                  step="0.01"
                  value={amountPaidRupees}
                  onChange={(e) => setAmountPaidRupees(e.target.value)}
                  className="input"
                />
              </label>
            )}
            <div className="flex items-end text-sm text-neutral-300">
              Grand total: <span className="ml-2 font-medium">{formatPaisa(grandTotalPaisa as Paisa)}</span>
            </div>
          </div>

          {error && <p className="mb-3 text-sm text-red-400">{error}</p>}

          <button
            onClick={submitGrn}
            disabled={saving}
            className="rounded-md bg-white px-4 py-2 text-sm font-medium text-neutral-950 disabled:opacity-50"
          >
            {saving ? "Saving…" : "Record delivery"}
          </button>
        </section>
      )}

      <h2 className="mb-3 font-medium">Recent purchases</h2>
      {loading ? (
        <p className="text-neutral-400">Loading…</p>
      ) : (
        <table className="w-full text-left text-sm">
          <thead className="text-neutral-500">
            <tr>
              <th className="pb-2 pr-4">Date</th>
              <th className="pb-2 pr-4">Invoice</th>
              <th className="pb-2 pr-4">Total</th>
              <th className="pb-2 pr-4">Status</th>
              <th className="pb-2 pr-4"></th>
            </tr>
          </thead>
          <tbody>
            {purchases.map((p) => (
              <tr key={p.id} className="border-t border-neutral-800">
                <td className="py-2 pr-4 text-neutral-400">{new Date(p.created_at).toLocaleDateString()}</td>
                <td className="py-2 pr-4">
                  {p.invoice_ref ?? "—"}
                  {p.invoice_photo_url && (
                    <a href={p.invoice_photo_url} target="_blank" rel="noreferrer" className="ml-2 underline">
                      photo
                    </a>
                  )}
                </td>
                <td className="py-2 pr-4">{formatPaisa(p.total_paisa as Paisa)}</td>
                <td className="py-2 pr-4 capitalize text-neutral-400">{p.payment_status}</td>
                <td className="py-2 pr-4">
                  {canReceive && (
                    <button onClick={() => setReturnFor(p)} className="text-neutral-400 underline">
                      Return
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {returnFor && (
        <ReturnDialog
          purchase={returnFor}
          ingredients={ingredients}
          onClose={() => setReturnFor(null)}
          onSaved={() => {
            setReturnFor(null);
            reload();
          }}
        />
      )}
    </main>
  );
}

function ReturnDialog({
  purchase,
  ingredients,
  onClose,
  onSaved,
}: {
  purchase: Purchase;
  ingredients: { id: string; name: string; unit: string }[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [ingredientId, setIngredientId] = useState("");
  const [qty, setQty] = useState("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    const n = Number(qty);
    if (!ingredientId || !Number.isFinite(n) || n <= 0) {
      setError("Pick an ingredient and a quantity > 0.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await recordPurchaseReturn(purchase.id, ingredientId, n, reason || undefined);
      onSaved();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-sm rounded-md border border-neutral-800 bg-neutral-900 p-5 text-white">
        <h3 className="mb-4 font-medium">Return goods — invoice {purchase.invoice_ref ?? purchase.id.slice(0, 8)}</h3>
        <div className="space-y-3">
          <label className="block">
            <span className="mb-1 block text-xs text-neutral-400">Ingredient</span>
            <select value={ingredientId} onChange={(e) => setIngredientId(e.target.value)} className="input">
              <option value="">Select…</option>
              {ingredients.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name} ({i.unit})
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs text-neutral-400">Quantity returned</span>
            <input type="number" step="0.001" value={qty} onChange={(e) => setQty(e.target.value)} className="input" />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs text-neutral-400">Reason</span>
            <input value={reason} onChange={(e) => setReason(e.target.value)} className="input" />
          </label>
          {error && <p className="text-sm text-red-400">{error}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <button onClick={onClose} className="rounded-md px-4 py-2 text-sm text-neutral-400">
              Cancel
            </button>
            <button
              onClick={submit}
              disabled={saving}
              className="rounded-md bg-white px-4 py-2 text-sm font-medium text-neutral-950 disabled:opacity-50"
            >
              {saving ? "Saving…" : "Confirm return"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

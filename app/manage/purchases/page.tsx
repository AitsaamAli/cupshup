"use client";

import { useState } from "react";
import Link from "next/link";
import { useStaffSession } from "@/lib/auth";
import { useBusinessDay } from "@/lib/business-day";
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
import { AppShell } from "@/components/ui/AppShell";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { DataTable, type DataTableColumn } from "@/components/ui/DataTable";

const OUTLET_ID = process.env.NEXT_PUBLIC_SUPABASE_OUTLET_ID!;
const CAN_RECEIVE = new Set(["owner", "manager"]);

const PORTAL_NAV = [
  { label: "Dashboard", href: "/reports/dashboard" },
  { label: "Master P&L", href: "/reports/pl" },
  { label: "Menu", href: "/manage/menu" },
  { label: "Inventory", href: "/manage/inventory" },
  { label: "Purchases", href: "/manage/purchases" },
  { label: "Expenses", href: "/manage/expenses" },
  { label: "Business day", href: "/manage/day" },
];

type DraftLine = { ingredientId: string; qtyText: string; unitCostRupeesText: string };

/**
 * Goods Receipt Note (GRN) — Part 12. Every line here goes through
 * record_purchase_grn() in one transaction: the purchase header, every
 * line, every line's stock_movement, and every line's weighted-average
 * cost update all succeed together or none do.
 */
export default function PurchasesPage() {
  const { staff, loading: staffLoading, lock } = useStaffSession("manage");
  const { day } = useBusinessDay(OUTLET_ID);
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
    // Outlet id must be the FIRST path segment — the storage RLS policy
    // (0038_second_wave_storage_outlet_scoping.sql) checks
    // (storage.foldername(name))[1] against the caller's own outlet, so a
    // path that doesn't start with it would upload successfully but then
    // be unreadable by anyone, including this same outlet.
    const path = `${OUTLET_ID}/${supplierId}/${Date.now()}-${invoiceFile.name}`;
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

  const columns: DataTableColumn<Purchase>[] = [
    {
      key: "date",
      header: "Date",
      sortValue: (p) => p.created_at,
      render: (p) => <span className="text-ink-500">{new Date(p.created_at).toLocaleDateString()}</span>,
    },
    {
      key: "invoice",
      header: "Invoice",
      render: (p) => (
        <>
          {p.invoice_ref ?? "—"}
          {p.invoice_photo_url && (
            <a href={p.invoice_photo_url} target="_blank" rel="noreferrer" className="ml-2 text-brand-700 hover:underline">
              photo
            </a>
          )}
        </>
      ),
    },
    { key: "total", header: "Total", align: "right", numeric: true, render: (p) => formatPaisa(p.total_paisa as Paisa) },
    { key: "status", header: "Status", render: (p) => <span className="text-ink-500 capitalize">{p.payment_status}</span> },
    {
      key: "actions",
      header: "",
      align: "right",
      render: (p) => canReceive && <Button variant="quiet" onClick={() => setReturnFor(p)}>Return</Button>,
    },
  ];

  if (staffLoading) return <div className="min-h-screen bg-canvas" />;

  return (
    <AppShell
      density="portal"
      nav={PORTAL_NAV}
      crumbs={[{ label: "Purchases" }]}
      staff={staff}
      dayStatus={day?.status === "open" ? "open" : "closed"}
      onLock={lock}
    >
      <div className="p-4">
        <div className="mb-4 flex items-center justify-between">
          <h1 className="text-portal-xl font-semibold text-ink-900">Purchases (GRN)</h1>
          <nav className="flex gap-4 text-portal-sm text-brand-700">
            <Link href="/manage/suppliers" className="hover:underline">
              Suppliers
            </Link>
            <Link href="/manage/purchases/prices" className="hover:underline">
              Price history &amp; alerts
            </Link>
          </nav>
        </div>

        {canReceive && (
          <Card className="mb-8 p-4">
            <h2 className="mb-3 text-portal-sm font-semibold text-ink-900">Receive delivery</h2>
            <div className="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Field label="Supplier" htmlFor="grn-supplier">
                <Select id="grn-supplier" value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
                  <option value="">Select…</option>
                  {suppliers
                    .filter((s) => s.active)
                    .map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                </Select>
              </Field>
              <Field label="Invoice reference" htmlFor="grn-invoice-ref">
                <Input id="grn-invoice-ref" value={invoiceRef} onChange={(e) => setInvoiceRef(e.target.value)} />
              </Field>
              <Field label="Invoice photo" htmlFor="grn-invoice-file">
                <input
                  id="grn-invoice-file"
                  type="file"
                  accept="image/*"
                  onChange={(e) => setInvoiceFile(e.target.files?.[0] ?? null)}
                  className="text-portal-sm text-ink-500"
                />
              </Field>
            </div>

            <div className="mb-3 space-y-2">
              {lines.map((line, i) => (
                <div key={i} className="grid grid-cols-2 items-end gap-2 sm:grid-cols-4">
                  <Field label="Ingredient" htmlFor={`grn-line-ing-${i}`}>
                    <Select
                      id={`grn-line-ing-${i}`}
                      value={line.ingredientId}
                      onChange={(e) => updateLine(i, { ingredientId: e.target.value })}
                    >
                      <option value="">Select…</option>
                      {ingredients.map((ing) => (
                        <option key={ing.id} value={ing.id}>
                          {ing.name} ({ing.unit})
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="Qty" htmlFor={`grn-line-qty-${i}`}>
                    <Input
                      id={`grn-line-qty-${i}`}
                      type="number"
                      step="0.001"
                      value={line.qtyText}
                      onChange={(e) => updateLine(i, { qtyText: e.target.value })}
                    />
                  </Field>
                  <Field label="Unit cost (Rs)" htmlFor={`grn-line-cost-${i}`}>
                    <Input
                      id={`grn-line-cost-${i}`}
                      type="number"
                      step="0.01"
                      value={line.unitCostRupeesText}
                      onChange={(e) => updateLine(i, { unitCostRupeesText: e.target.value })}
                    />
                  </Field>
                  {lines.length > 1 && (
                    <Button
                      variant="quiet"
                      className="text-danger hover:text-danger"
                      onClick={() => setLines((prev) => prev.filter((_, idx) => idx !== i))}
                    >
                      Remove
                    </Button>
                  )}
                </div>
              ))}
              <Button
                variant="quiet"
                onClick={() => setLines((prev) => [...prev, { ingredientId: "", qtyText: "", unitCostRupeesText: "" }])}
              >
                + Add line
              </Button>
            </div>

            <div className="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Field label="Payment status" htmlFor="grn-payment-status">
                <Select
                  id="grn-payment-status"
                  value={paymentStatus}
                  onChange={(e) => setPaymentStatus(e.target.value as typeof paymentStatus)}
                >
                  <option value="credit">Credit</option>
                  <option value="partial">Partial</option>
                  <option value="paid">Paid</option>
                </Select>
              </Field>
              {paymentStatus !== "credit" && (
                <Field label="Amount paid (Rs)" htmlFor="grn-amount-paid">
                  <Input
                    id="grn-amount-paid"
                    type="number"
                    step="0.01"
                    value={amountPaidRupees}
                    onChange={(e) => setAmountPaidRupees(e.target.value)}
                  />
                </Field>
              )}
              <div className="flex items-end text-portal-sm text-ink-700">
                Grand total: <span className="ml-2 font-medium text-ink-900">{formatPaisa(grandTotalPaisa as Paisa)}</span>
              </div>
            </div>

            {error && <p className="mb-3 text-portal-sm text-danger">{error}</p>}

            <Button variant="primary" onClick={submitGrn} disabled={saving}>
              {saving ? "Saving…" : "Record delivery"}
            </Button>
          </Card>
        )}

        <h2 className="mb-3 text-portal-sm font-semibold text-ink-900">Recent purchases</h2>
        <Card className="p-4">
          {loading ? (
            <p className="text-portal-sm text-ink-500">Loading…</p>
          ) : (
            <DataTable columns={columns} rows={purchases} keyExtractor={(p) => p.id} emptyMessage="No purchases yet." />
          )}
        </Card>
      </div>

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
    </AppShell>
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
    <Modal title={`Return goods — invoice ${purchase.invoice_ref ?? purchase.id.slice(0, 8)}`} onClose={onClose}>
      <div className="space-y-3">
        <Field label="Ingredient" htmlFor="return-ingredient">
          <Select id="return-ingredient" value={ingredientId} onChange={(e) => setIngredientId(e.target.value)}>
            <option value="">Select…</option>
            {ingredients.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name} ({i.unit})
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Quantity returned" htmlFor="return-qty">
          <Input id="return-qty" type="number" step="0.001" value={qty} onChange={(e) => setQty(e.target.value)} />
        </Field>
        <Field label="Reason" htmlFor="return-reason">
          <Input id="return-reason" value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        {error && <p className="text-portal-sm text-danger">{error}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="quiet" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={submit} disabled={saving}>
            {saving ? "Saving…" : "Confirm return"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

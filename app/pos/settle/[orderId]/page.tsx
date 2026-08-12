"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useStaffSession } from "@/lib/auth";
import { createClient } from "@/lib/supabase/client";
import { formatPaisa, rupeesToPaisa, type Paisa } from "@/lib/money";
import { voidOrder } from "@/lib/orders";
import {
  settleOrder,
  loadPaymentMethodTaxRates,
  previewSplitTax,
  type PaymentMethod,
  type TaxRateInfo,
} from "@/lib/settlement";
import { ManagerAuthDialog } from "@/components/pos/manager-auth-dialog";

const APPROVER_ROLES = new Set(["owner", "manager", "supervisor"]);
const METHOD_LABEL: Record<PaymentMethod, string> = {
  cash: "Cash",
  card: "Card",
  jazzcash: "JazzCash",
  easypaisa: "EasyPaisa",
  qr: "QR",
  foodpanda: "Foodpanda",
};
const VOID_REASONS = [
  { code: "wrong_item", label: "Wrong item punched" },
  { code: "customer_cancel", label: "Customer cancelled" },
  { code: "kitchen_86", label: "Kitchen ran out" },
  { code: "quality", label: "Quality issue" },
  { code: "training", label: "Training" },
];

interface OrderRow {
  id: string;
  order_no: number;
  status: string;
  subtotal_paisa: number;
  order_items: { id: string; name_snapshot: string; qty: number; line_total_paisa: number }[];
}

interface SplitRow {
  method: PaymentMethod;
  baseRupees: string;
  tenderedRupees: string;
}

/**
 * Settlement screen — Part 10. Payment is entirely separate from order
 * creation (Part 09): a dine-in order sits as `sent_to_kitchen`/`ready`/
 * `served` for as long as the table is eating, and only becomes
 * `settled` here, once the customer actually pays — split across
 * multiple methods if they want, each taxed at its own rate.
 */
export default function SettlePage() {
  const { orderId } = useParams<{ orderId: string }>();
  const router = useRouter();
  const { staff } = useStaffSession("pos");

  const [order, setOrder] = useState<OrderRow | null>(null);
  const [taxRates, setTaxRates] = useState<Record<PaymentMethod, TaxRateInfo> | null>(null);
  const [discountRupees, setDiscountRupees] = useState("0");
  const [serviceChargeRupees, setServiceChargeRupees] = useState("0");
  const [deliveryFeeRupees, setDeliveryFeeRupees] = useState("0");
  const [splits, setSplits] = useState<SplitRow[]>([
    { method: "cash", baseRupees: "", tenderedRupees: "" },
  ]);
  const [needsApproval, setNeedsApproval] = useState(false);
  const [approvedBy, setApprovedBy] = useState<string | null>(null);
  const [showVoid, setShowVoid] = useState(false);
  const [voidReason, setVoidReason] = useState(VOID_REASONS[0].code);
  const [voidNote, setVoidNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();
    supabase
      .from("orders")
      .select("id, order_no, status, subtotal_paisa, order_items(id, name_snapshot, qty, line_total_paisa)")
      .eq("id", orderId)
      .single()
      .then(({ data }) => setOrder(data as unknown as OrderRow));
    loadPaymentMethodTaxRates().then(setTaxRates);
  }, [orderId]);

  const discountPaisa = rupeesToPaisa(Number(discountRupees) || 0);
  const serviceChargePaisa = rupeesToPaisa(Number(serviceChargeRupees) || 0);
  const deliveryFeePaisa = rupeesToPaisa(Number(deliveryFeeRupees) || 0);

  const netBasePaisa = useMemo(() => {
    if (!order) return 0;
    return order.subtotal_paisa - discountPaisa + serviceChargePaisa + deliveryFeePaisa;
  }, [order, discountPaisa, serviceChargePaisa, deliveryFeePaisa]);

  const splitPreviews = useMemo(
    () =>
      splits.map((s) => {
        const base = rupeesToPaisa(Number(s.baseRupees) || 0);
        const rate = taxRates?.[s.method]?.rate_bp ?? 0;
        const tax = previewSplitTax(base, rate);
        const tendered = rupeesToPaisa(Number(s.tenderedRupees) || 0);
        return { base, rate, tax, amount: base + tax, change: Math.max(tendered - (base + tax), 0) };
      }),
    [splits, taxRates]
  );

  const splitBaseSum = splitPreviews.reduce((sum, s) => sum + s.base, 0);
  const splitTaxSum = splitPreviews.reduce((sum, s) => sum + s.tax, 0);
  const remainingPaisa = netBasePaisa - splitBaseSum;
  const canApprove = !!staff && APPROVER_ROLES.has(staff.role);
  const discountNeedsApproval = discountPaisa > 0 && !canApprove && !approvedBy;

  function updateSplit(i: number, patch: Partial<SplitRow>) {
    setSplits((prev) => prev.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  }

  async function submit() {
    if (!order) return;
    if (discountPaisa > 0 && !canApprove && !approvedBy) {
      setNeedsApproval(true);
      return;
    }
    if (splitBaseSum !== netBasePaisa) {
      setError(
        `Splits (${formatPaisa(splitBaseSum as Paisa)}) don't match the bill (${formatPaisa(
          netBasePaisa as Paisa
        )}).`
      );
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      await settleOrder(
        order.id,
        splits.map((s) => ({
          method: s.method,
          base_paisa: rupeesToPaisa(Number(s.baseRupees) || 0),
          tendered_paisa: s.tenderedRupees ? rupeesToPaisa(Number(s.tenderedRupees)) : undefined,
        })),
        { discountPaisa, serviceChargePaisa, deliveryFeePaisa }
      );
      router.push("/pos");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  async function submitVoid() {
    if (!order) return;
    if (!canApprove && !approvedBy) {
      setNeedsApproval(true);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await voidOrder(order.id, voidReason, { reasonNote: voidNote || undefined });
      router.push("/pos");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  if (!order) return <p className="p-8 text-neutral-400">Loading order…</p>;

  return (
    <main className="min-h-screen bg-neutral-950 p-6 text-white">
      <h1 className="mb-1 text-xl font-semibold">Settle Order #{order.order_no}</h1>
      <p className="mb-6 text-sm text-neutral-400">Status: {order.status}</p>

      <section className="mb-6 space-y-1">
        {order.order_items.map((item) => (
          <div key={item.id} className="flex justify-between text-sm">
            <span>
              {item.qty} × {item.name_snapshot}
            </span>
            <span>{formatPaisa(item.line_total_paisa as Paisa)}</span>
          </div>
        ))}
        <div className="flex justify-between border-t border-neutral-800 pt-2 text-sm font-medium">
          <span>Subtotal</span>
          <span>{formatPaisa(order.subtotal_paisa as Paisa)}</span>
        </div>
      </section>

      <section className="mb-6 grid grid-cols-3 gap-3">
        <NumberField
          label={`Discount (Rs)${discountNeedsApproval ? " — needs manager" : ""}`}
          value={discountRupees}
          onChange={setDiscountRupees}
        />
        <NumberField label="Service charge (Rs)" value={serviceChargeRupees} onChange={setServiceChargeRupees} />
        <NumberField label="Delivery fee (Rs)" value={deliveryFeeRupees} onChange={setDeliveryFeeRupees} />
      </section>

      <section className="mb-6">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="font-medium">Payment split</h2>
          <button
            onClick={() => setSplits((s) => [...s, { method: "cash", baseRupees: "", tenderedRupees: "" }])}
            className="text-sm text-neutral-400 underline"
          >
            + Add split
          </button>
        </div>

        {splits.map((s, i) => (
          <div key={i} className="mb-2 grid grid-cols-4 items-end gap-2 rounded-md border border-neutral-800 p-3">
            <label className="block">
              <span className="mb-1 block text-xs text-neutral-400">Method</span>
              <select
                value={s.method}
                onChange={(e) => updateSplit(i, { method: e.target.value as PaymentMethod })}
                className="input"
              >
                {Object.entries(METHOD_LABEL).map(([m, label]) => (
                  <option key={m} value={m}>
                    {label} ({((taxRates?.[m as PaymentMethod]?.rate_bp ?? 0) / 100).toFixed(0)}%)
                  </option>
                ))}
              </select>
            </label>
            <NumberField
              label="Amount (Rs, pre-tax)"
              value={s.baseRupees}
              onChange={(v) => updateSplit(i, { baseRupees: v })}
            />
            {s.method === "cash" && (
              <NumberField
                label="Tendered (Rs)"
                value={s.tenderedRupees}
                onChange={(v) => updateSplit(i, { tenderedRupees: v })}
              />
            )}
            <div className="text-sm text-neutral-400">
              <p>Tax: {formatPaisa(splitPreviews[i].tax as Paisa)}</p>
              {s.method === "cash" && <p>Change: {formatPaisa(splitPreviews[i].change as Paisa)}</p>}
              {splits.length > 1 && (
                <button
                  onClick={() => setSplits((prev) => prev.filter((_, idx) => idx !== i))}
                  className="text-red-400 underline"
                >
                  Remove
                </button>
              )}
            </div>
          </div>
        ))}

        <div className="mt-3 space-y-1 text-sm">
          <div className="flex justify-between">
            <span>Bill total (after discount/charges)</span>
            <span>{formatPaisa(netBasePaisa as Paisa)}</span>
          </div>
          <div className="flex justify-between">
            <span>Tax (per split, summed)</span>
            <span>{formatPaisa(splitTaxSum as Paisa)}</span>
          </div>
          <div className="flex justify-between font-medium">
            <span>Grand total</span>
            <span>{formatPaisa((netBasePaisa + splitTaxSum) as Paisa)}</span>
          </div>
          {remainingPaisa !== 0 && (
            <p className="text-amber-400">
              {remainingPaisa > 0 ? "Remaining" : "Over by"}:{" "}
              {formatPaisa(Math.abs(remainingPaisa) as Paisa)}
            </p>
          )}
        </div>
      </section>

      {error && <p className="mb-4 text-sm text-red-400">{error}</p>}

      <div className="flex gap-3">
        <button
          onClick={submit}
          disabled={submitting || remainingPaisa !== 0}
          className="flex-1 rounded-md bg-white py-3 font-medium text-neutral-950 disabled:opacity-40"
        >
          {submitting ? "Settling…" : "Settle"}
        </button>
        <button
          onClick={() => setShowVoid(true)}
          className="rounded-md border border-red-500/50 px-4 py-3 text-sm text-red-400"
        >
          Void order
        </button>
      </div>

      {showVoid && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-sm rounded-md border border-neutral-800 bg-neutral-900 p-5">
            <h3 className="mb-3 font-medium">Void order #{order.order_no}</h3>
            <label className="mb-3 block">
              <span className="mb-1 block text-xs text-neutral-400">Reason</span>
              <select value={voidReason} onChange={(e) => setVoidReason(e.target.value)} className="input">
                {VOID_REASONS.map((r) => (
                  <option key={r.code} value={r.code}>
                    {r.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="mb-4 block">
              <span className="mb-1 block text-xs text-neutral-400">Note (optional)</span>
              <input value={voidNote} onChange={(e) => setVoidNote(e.target.value)} className="input" />
            </label>
            <div className="flex justify-end gap-2">
              <button onClick={() => setShowVoid(false)} className="px-4 py-2 text-sm text-neutral-400">
                Cancel
              </button>
              <button
                onClick={submitVoid}
                disabled={submitting}
                className="rounded-md bg-red-500 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
              >
                {submitting ? "Voiding…" : "Confirm void"}
              </button>
            </div>
          </div>
        </div>
      )}

      {needsApproval && (
        <ManagerAuthDialog
          title="Manager approval required"
          onCancel={() => setNeedsApproval(false)}
          onApproved={(approver) => {
            setApprovedBy(approver.name);
            setNeedsApproval(false);
          }}
        />
      )}
    </main>
  );
}

function NumberField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs text-neutral-400">{label}</span>
      <input
        type="number"
        step="0.01"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="input"
      />
    </label>
  );
}

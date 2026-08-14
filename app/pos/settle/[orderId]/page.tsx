"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useStaffSession } from "@/lib/auth";
import { createClient } from "@/lib/supabase/client";
import { formatPaisa, rupeesToPaisa, paisaToRupees, type Paisa } from "@/lib/money";
import { voidOrder } from "@/lib/orders";
import {
  settleOrder,
  loadPaymentMethodTaxRates,
  previewSplitTax,
  type PaymentMethod,
  type TaxRateInfo,
} from "@/lib/settlement";
import { useHouseAccountBalances } from "@/lib/house-accounts";
import { ManagerAuthDialog } from "@/components/pos/manager-auth-dialog";
import { PrintButton } from "@/components/print/print-button";
import { fetchReceiptData, recordInvoicePrint } from "@/lib/receipt-data";
import { buildReceiptDoc, type PrintDoc } from "@/lib/print-templates";
import { submitToPra } from "@/lib/pra";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { Money } from "@/components/ui/Money";

const OUTLET_ID = process.env.NEXT_PUBLIC_SUPABASE_OUTLET_ID!;
const APPROVER_ROLES = new Set(["owner", "manager", "supervisor"]);
const METHOD_LABEL: Record<PaymentMethod, string> = {
  cash: "Cash",
  card: "Card",
  jazzcash: "JazzCash",
  easypaisa: "EasyPaisa",
  qr: "QR",
  foodpanda: "Foodpanda",
  house_account: "Bill to account",
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
  /** Only used when method === "house_account". */
  accountId: string;
}

/**
 * Settlement screen. Payment is entirely separate from order creation: a
 * dine-in order sits as `sent_to_kitchen`/`ready`/`served` for as long as
 * the table is eating, and only becomes `settled` here, once the
 * customer actually pays — split across multiple methods if they want,
 * each taxed at its own rate.
 *
 * "Exact amount" (below) is the fix for a real, measured tap-count
 * failure: the design benchmark targets <=3 taps for a cash-exact
 * settle (Toast/Square both make this one tap), and the previous version
 * of this screen had no way to do it faster than typing the bill total
 * twice by hand. One tap now fills both the base and tendered fields
 * with the exact bill total for the single default split.
 */
export default function SettlePage() {
  const { orderId } = useParams<{ orderId: string }>();
  const router = useRouter();
  const { staff } = useStaffSession("pos");
  const { rows: houseAccounts } = useHouseAccountBalances(OUTLET_ID);

  const [order, setOrder] = useState<OrderRow | null>(null);
  const [taxRates, setTaxRates] = useState<Record<PaymentMethod, TaxRateInfo> | null>(null);
  const [discountRupees, setDiscountRupees] = useState("0");
  const [serviceChargeRupees, setServiceChargeRupees] = useState("0");
  const [deliveryFeeRupees, setDeliveryFeeRupees] = useState("0");
  const [splits, setSplits] = useState<SplitRow[]>([{ method: "cash", baseRupees: "", tenderedRupees: "", accountId: "" }]);
  const [needsApproval, setNeedsApproval] = useState(false);
  const [approvedBy, setApprovedBy] = useState<string | null>(null);
  const [showVoid, setShowVoid] = useState(false);
  const [voidReason, setVoidReason] = useState(VOID_REASONS[0].code);
  const [voidNote, setVoidNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [readyToPrint, setReadyToPrint] = useState(false);
  const [praStatus, setPraStatus] = useState<"idle" | "pending" | "synced" | "queued">("idle");

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

  /** The one-tap "customer pays exactly what's owed, in cash" shortcut —
   * only offered when there's a single split, since splitting across
   * methods has no single "exact" amount per line by definition.
   * Tendered is the GRAND total (base + tax), not just the pre-tax base
   * — tendering only the base would silently under-tender by the tax
   * amount and show a false "no change owed". */
  function fillExactAmount() {
    const method = splits[0].method;
    const baseRupees = paisaToRupees(netBasePaisa as Paisa).toString();
    if (method !== "cash") {
      updateSplit(0, { baseRupees });
      return;
    }
    const rate = taxRates?.[method]?.rate_bp ?? 0;
    const tax = previewSplitTax(netBasePaisa as Paisa, rate);
    updateSplit(0, { baseRupees, tenderedRupees: paisaToRupees((netBasePaisa + tax) as Paisa).toString() });
  }

  async function submit() {
    if (!order) return;
    if (discountPaisa > 0 && !canApprove && !approvedBy) {
      setNeedsApproval(true);
      return;
    }
    if (splitBaseSum !== netBasePaisa) {
      setError(
        `Splits (${formatPaisa(splitBaseSum as Paisa)}) don't match the bill (${formatPaisa(netBasePaisa as Paisa)}).`
      );
      return;
    }
    const missingAccount = splits.find((s) => s.method === "house_account" && !s.accountId);
    if (missingAccount) {
      setError("Pick which account to bill.");
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
          account_id: s.method === "house_account" ? s.accountId : undefined,
        })),
        { discountPaisa, serviceChargePaisa, deliveryFeePaisa }
      );
      await prepareReceipt();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  /**
   * "order settle -> PRA ko bhejo -> fiscal number + QR wapas -> print".
   * PRA submission is best-effort and never blocks the receipt: if it
   * fails or times out, submitToPra() has already queued it for retry,
   * and the receipt prints with the LOCAL invoice_no and no QR either
   * way. Doesn't build the receipt itself — that happens fresh on every
   * actual Print click (buildReceiptForPrint below), so the REPRINT
   * counter only advances on a real click, never just because this ran.
   */
  async function prepareReceipt() {
    setReadyToPrint(true);
    setPraStatus("pending");
    try {
      await submitToPra(order!.id);
      setPraStatus("synced");
    } catch {
      setPraStatus("queued");
    }
  }

  async function buildReceiptForPrint(): Promise<PrintDoc> {
    const [data, printNumber] = await Promise.all([fetchReceiptData(order!.id), recordInvoicePrint(order!.id)]);
    return buildReceiptDoc({
      outlet: data.outlet,
      order: data.order,
      payments: data.payments,
      cashierName: data.cashierName,
      cashierCode: data.cashierCode,
      terminalName: data.terminalName,
      printNumber,
    });
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

  if (!order) return <p className="p-8 text-portal-sm text-ink-500">Loading order…</p>;

  if (readyToPrint) {
    return (
      <main className="min-h-screen bg-canvas p-6">
        <h1 className="mb-1 text-terminal-lg font-semibold text-ink-900">Order #{order.order_no} settled</h1>
        <p className="mb-6 text-portal-sm text-ink-500">
          {praStatus === "pending" && "Sending to PRA…"}
          {praStatus === "synced" && "PRA fiscal number received."}
          {praStatus === "queued" && "PRA sync failed — queued for retry. Receipt still prints with the local invoice number."}
        </p>
        <PrintButton kind="receipt" getDoc={buildReceiptForPrint} label="Print receipt" />
        <Button density="terminal" variant="primary" onClick={() => router.push("/pos")} className="mt-4">
          Back to POS
        </Button>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-canvas p-6">
      <h1 className="mb-1 text-terminal-lg font-semibold text-ink-900">Settle Order #{order.order_no}</h1>
      <p className="mb-6 text-portal-sm text-ink-500">Status: {order.status}</p>

      <section className="mb-6 space-y-1">
        {order.order_items.map((item) => (
          <div key={item.id} className="flex justify-between text-portal-sm text-ink-700">
            <span>
              {item.qty} × {item.name_snapshot}
            </span>
            <Money paisa={item.line_total_paisa as Paisa} />
          </div>
        ))}
        <div className="flex justify-between border-t border-line pt-2 text-portal-sm font-medium text-ink-900">
          <span>Subtotal</span>
          <Money paisa={order.subtotal_paisa as Paisa} />
        </div>
      </section>

      <section className="mb-6 grid grid-cols-3 gap-3">
        <Field label={`Discount (Rs)${discountNeedsApproval ? " — needs manager" : ""}`} htmlFor="settle-discount">
          <NumberInput id="settle-discount" value={discountRupees} onChange={setDiscountRupees} />
        </Field>
        <Field label="Service charge (Rs)" htmlFor="settle-service">
          <NumberInput id="settle-service" value={serviceChargeRupees} onChange={setServiceChargeRupees} />
        </Field>
        <Field label="Delivery fee (Rs)" htmlFor="settle-delivery">
          <NumberInput id="settle-delivery" value={deliveryFeeRupees} onChange={setDeliveryFeeRupees} />
        </Field>
      </section>

      <section className="mb-6">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h2 className="text-portal-base font-semibold text-ink-900">Payment split</h2>
          <div className="flex items-center gap-3">
            {splits.length === 1 && (
              <Button density="terminal" variant="primary" onClick={fillExactAmount} disabled={!order}>
                Exact amount
              </Button>
            )}
            <button
              onClick={() => setSplits((s) => [...s, { method: "cash", baseRupees: "", tenderedRupees: "", accountId: "" }])}
              className="text-portal-sm text-ink-500 hover:underline"
            >
              + Add split
            </button>
          </div>
        </div>

        {splits.map((s, i) => (
          <div key={i} className="mb-2 grid grid-cols-4 items-end gap-2 rounded-lg border border-line bg-surface p-3">
            <Field label="Method" htmlFor={`settle-method-${i}`}>
              <Select id={`settle-method-${i}`} value={s.method} onChange={(e) => updateSplit(i, { method: e.target.value as PaymentMethod })}>
                {Object.entries(METHOD_LABEL).map(([m, label]) => (
                  <option key={m} value={m}>
                    {label} ({((taxRates?.[m as PaymentMethod]?.rate_bp ?? 0) / 100).toFixed(0)}%)
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Amount (Rs, pre-tax)" htmlFor={`settle-base-${i}`}>
              <NumberInput id={`settle-base-${i}`} value={s.baseRupees} onChange={(v) => updateSplit(i, { baseRupees: v })} />
            </Field>
            {s.method === "cash" && (
              <Field label="Tendered (Rs)" htmlFor={`settle-tendered-${i}`}>
                <NumberInput id={`settle-tendered-${i}`} value={s.tenderedRupees} onChange={(v) => updateSplit(i, { tenderedRupees: v })} />
              </Field>
            )}
            {s.method === "house_account" && (
              <Field label="Account" htmlFor={`settle-account-${i}`}>
                <Select
                  id={`settle-account-${i}`}
                  value={s.accountId}
                  onChange={(e) => updateSplit(i, { accountId: e.target.value })}
                >
                  <option value="">Select…</option>
                  {houseAccounts.map((a) => (
                    <option key={a.account_id} value={a.account_id}>
                      {a.name} — {formatPaisa((a.credit_limit_paisa - a.outstanding_paisa) as Paisa)} available
                    </option>
                  ))}
                </Select>
              </Field>
            )}
            <div className="text-portal-sm text-ink-500">
              <p>Tax: {formatPaisa(splitPreviews[i].tax as Paisa)}</p>
              {s.method === "cash" && <p>Change: {formatPaisa(splitPreviews[i].change as Paisa)}</p>}
              {splits.length > 1 && (
                <button onClick={() => setSplits((prev) => prev.filter((_, idx) => idx !== i))} className="text-danger hover:underline">
                  Remove
                </button>
              )}
            </div>
          </div>
        ))}

        <div className="mt-3 space-y-1 text-portal-sm text-ink-700">
          <div className="flex justify-between">
            <span>Bill total (after discount/charges)</span>
            <Money paisa={netBasePaisa as Paisa} />
          </div>
          <div className="flex justify-between">
            <span>Tax (per split, summed)</span>
            <Money paisa={splitTaxSum as Paisa} />
          </div>
          <div className="flex justify-between font-semibold text-ink-900">
            <span>Grand total</span>
            <Money paisa={(netBasePaisa + splitTaxSum) as Paisa} />
          </div>
          {remainingPaisa !== 0 && (
            <p className="text-warning">
              {remainingPaisa > 0 ? "Remaining" : "Over by"}: {formatPaisa(Math.abs(remainingPaisa) as Paisa)}
            </p>
          )}
        </div>
      </section>

      {error && <p className="mb-4 text-portal-sm text-danger">{error}</p>}

      <div className="flex gap-3">
        <Button
          density="terminal"
          variant="primary"
          onClick={submit}
          disabled={submitting || remainingPaisa !== 0}
          className="flex-1"
        >
          {submitting ? "Settling…" : "Settle"}
        </Button>
        <Button density="terminal" variant="danger" onClick={() => setShowVoid(true)}>
          Void order
        </Button>
      </div>

      {showVoid && (
        <Modal title={`Void order #${order.order_no}`} onClose={() => setShowVoid(false)}>
          <Field label="Reason" htmlFor="settle-void-reason">
            <Select id="settle-void-reason" value={voidReason} onChange={(e) => setVoidReason(e.target.value)}>
              {VOID_REASONS.map((r) => (
                <option key={r.code} value={r.code}>
                  {r.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Note (optional)" htmlFor="settle-void-note">
            <Input id="settle-void-note" value={voidNote} onChange={(e) => setVoidNote(e.target.value)} />
          </Field>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="ghost" density="terminal" onClick={() => setShowVoid(false)}>
              Cancel
            </Button>
            <Button variant="danger" density="terminal" onClick={submitVoid} disabled={submitting}>
              {submitting ? "Voiding…" : "Confirm void"}
            </Button>
          </div>
        </Modal>
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

function NumberInput({ id, value, onChange }: { id: string; value: string; onChange: (v: string) => void }) {
  return (
    <Input id={id} type="number" step="0.01" inputMode="decimal" value={value} onChange={(e) => onChange(e.target.value)} />
  );
}

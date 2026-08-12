"use client";

import { useState } from "react";
import { useStaffSession } from "@/lib/auth";
import {
  useExpenseCategories,
  useExpenses,
  recordExpense,
  approveExpense,
  updateExpense,
  deleteExpense,
  requiredApprovalRole,
  type Expense,
} from "@/lib/expenses";
import type { PaymentMethod } from "@/lib/settlement";
import { formatPaisa, rupeesToPaisa, type Paisa } from "@/lib/money";
import { createClient } from "@/lib/supabase/client";

const OUTLET_ID = process.env.NEXT_PUBLIC_SUPABASE_OUTLET_ID!;
const CAN_ENTER = new Set(["owner", "manager", "supervisor"]);
const CAN_APPROVE = new Set(["owner", "manager"]);
const CAN_EDIT = new Set(["owner", "manager"]);
const METHOD_LABEL: Record<PaymentMethod, string> = {
  cash: "Cash",
  card: "Card",
  jazzcash: "JazzCash",
  easypaisa: "EasyPaisa",
  qr: "QR",
  foodpanda: "Foodpanda",
};

/**
 * Expense entry — Part 14. Approval thresholds are enforced server-side
 * in record_expense()/approve_expense(); requiredApprovalRole() here is
 * only a UI hint shown before submitting, same "preview, never the real
 * enforcement" relationship every other threshold preview in this app
 * has to its RPC (previewSplitTax, previewWeightedAvgCost, ...).
 */
export default function ExpensesPage() {
  const { staff } = useStaffSession("manage");
  const categories = useExpenseCategories(OUTLET_ID);
  const { expenses, loading, reload } = useExpenses(OUTLET_ID);
  const [editing, setEditing] = useState<Expense | null>(null);
  const [error, setError] = useState<string | null>(null);

  const canEnter = !!staff && CAN_ENTER.has(staff.role);
  const canApprove = !!staff && CAN_APPROVE.has(staff.role);
  const canEdit = !!staff && CAN_EDIT.has(staff.role);
  const isOwner = staff?.role === "owner";
  const categoryName = (id: string) => categories.find((c) => c.id === id)?.name ?? id;

  async function doApprove(id: string) {
    try {
      await approveExpense(id);
      reload();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function doDelete(id: string) {
    try {
      await deleteExpense(id);
      reload();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <main className="min-h-screen bg-neutral-950 p-6 text-white">
      <header className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Expenses</h1>
        <a href="/manage/expenses/reports" className="text-sm text-neutral-300 underline">
          Reports
        </a>
      </header>

      {error && <p className="mb-4 text-sm text-red-400">{error}</p>}

      {canEnter && (
        <EntryForm
          categories={categories}
          onSaved={() => {
            reload();
          }}
          onError={setError}
        />
      )}

      <h2 className="mb-3 mt-8 font-medium">Recent expenses</h2>
      {loading ? (
        <p className="text-neutral-400">Loading…</p>
      ) : (
        <table className="w-full text-left text-sm">
          <thead className="text-neutral-500">
            <tr>
              <th className="pb-2 pr-4">Date</th>
              <th className="pb-2 pr-4">Category</th>
              <th className="pb-2 pr-4">Amount</th>
              <th className="pb-2 pr-4">Method</th>
              <th className="pb-2 pr-4">Vendor</th>
              <th className="pb-2 pr-4">Status</th>
              <th className="pb-2 pr-4"></th>
            </tr>
          </thead>
          <tbody>
            {expenses.map((e) => (
              <tr key={e.id} className="border-t border-neutral-800">
                <td className="py-2 pr-4 text-neutral-400">{new Date(e.created_at).toLocaleDateString()}</td>
                <td className="py-2 pr-4">{categoryName(e.category_id)}</td>
                <td className="py-2 pr-4">{formatPaisa(e.amount_paisa as Paisa)}</td>
                <td className="py-2 pr-4 text-neutral-400">{METHOD_LABEL[e.payment_method]}</td>
                <td className="py-2 pr-4 text-neutral-400">{e.vendor ?? "—"}</td>
                <td className="py-2 pr-4">
                  {e.approved_by ? (
                    <span className="text-emerald-400">approved</span>
                  ) : (
                    <span className="text-amber-400">
                      pending ({requiredApprovalRole(e.amount_paisa)})
                    </span>
                  )}
                </td>
                <td className="py-2 pr-4 text-right">
                  {!e.approved_by && canApprove && (
                    <button onClick={() => doApprove(e.id)} className="mr-3 text-emerald-400 underline">
                      Approve
                    </button>
                  )}
                  {canEdit && (
                    <button onClick={() => setEditing(e)} className="mr-3 text-neutral-400 underline">
                      Edit
                    </button>
                  )}
                  {isOwner && (
                    <button onClick={() => doDelete(e.id)} className="text-red-400 underline">
                      Delete
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {editing && (
        <EditDialog
          expense={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            reload();
          }}
        />
      )}
    </main>
  );
}

function EntryForm({
  categories,
  onSaved,
  onError,
}: {
  categories: { id: string; name: string; accrual_type: string }[];
  onSaved: () => void;
  onError: (msg: string) => void;
}) {
  const [categoryId, setCategoryId] = useState("");
  const [amountRupees, setAmountRupees] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("cash");
  const [vendor, setVendor] = useState("");
  const [note, setNote] = useState("");
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);

  const selectedCategory = categories.find((c) => c.id === categoryId);
  const isAmortized = selectedCategory && selectedCategory.accrual_type !== "immediate";
  const amountPaisa = rupeesToPaisa(Number(amountRupees) || 0);
  const approvalHint = amountPaisa > 0 ? requiredApprovalRole(amountPaisa) : null;

  async function uploadReceipt(): Promise<string | undefined> {
    if (!receiptFile) return undefined;
    const supabase = createClient();
    const path = `${categoryId}/${Date.now()}-${receiptFile.name}`;
    const { error } = await supabase.storage.from("expense-receipts").upload(path, receiptFile);
    if (error) throw new Error(`Receipt upload failed: ${error.message}`);
    const { data } = supabase.storage.from("expense-receipts").getPublicUrl(path);
    return data.publicUrl;
  }

  async function submit() {
    if (!categoryId || amountPaisa <= 0) {
      onError("Pick a category and enter a valid amount.");
      return;
    }
    if (isAmortized && (!periodStart || !periodEnd)) {
      onError("Monthly/annual expenses need a period start and end.");
      return;
    }
    setSaving(true);
    try {
      const receiptUrl = await uploadReceipt();
      await recordExpense({
        categoryId,
        amountPaisa,
        paymentMethod,
        vendor: vendor || undefined,
        note: note || undefined,
        receiptUrl,
        periodStart: isAmortized ? periodStart : undefined,
        periodEnd: isAmortized ? periodEnd : undefined,
      });
      setCategoryId("");
      setAmountRupees("");
      setVendor("");
      setNote("");
      setPeriodStart("");
      setPeriodEnd("");
      setReceiptFile(null);
      onSaved();
    } catch (err) {
      onError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="rounded-md border border-neutral-800 p-4">
      <h2 className="mb-3 font-medium">Record an expense</h2>
      <div className="mb-3 grid grid-cols-3 gap-3">
        <label className="block">
          <span className="mb-1 block text-xs text-neutral-400">Category</span>
          <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className="input">
            <option value="">Select…</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({c.accrual_type})
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-xs text-neutral-400">
            Amount (Rs){approvalHint && approvalHint !== "supervisor" && ` — needs ${approvalHint} approval`}
          </span>
          <input
            type="number"
            step="0.01"
            value={amountRupees}
            onChange={(e) => setAmountRupees(e.target.value)}
            className="input"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs text-neutral-400">Payment method</span>
          <select
            value={paymentMethod}
            onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod)}
            className="input"
          >
            {Object.entries(METHOD_LABEL).map(([m, label]) => (
              <option key={m} value={m}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {isAmortized && (
        <div className="mb-3 grid grid-cols-2 gap-3">
          <label className="block">
            <span className="mb-1 block text-xs text-neutral-400">Period start</span>
            <input type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} className="input" />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs text-neutral-400">Period end (exclusive)</span>
            <input type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} className="input" />
          </label>
        </div>
      )}

      <div className="mb-3 grid grid-cols-3 gap-3">
        <label className="block">
          <span className="mb-1 block text-xs text-neutral-400">Vendor</span>
          <input value={vendor} onChange={(e) => setVendor(e.target.value)} className="input" />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs text-neutral-400">Note</span>
          <input value={note} onChange={(e) => setNote(e.target.value)} className="input" />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs text-neutral-400">Receipt photo</span>
          <input
            type="file"
            accept="image/*"
            onChange={(e) => setReceiptFile(e.target.files?.[0] ?? null)}
            className="text-sm text-neutral-400"
          />
        </label>
      </div>

      <button
        onClick={submit}
        disabled={saving}
        className="rounded-md bg-white px-4 py-2 text-sm font-medium text-neutral-950 disabled:opacity-50"
      >
        {saving ? "Saving…" : "Record expense"}
      </button>
    </section>
  );
}

function EditDialog({
  expense,
  onClose,
  onSaved,
}: {
  expense: Expense;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [amountRupees, setAmountRupees] = useState(String(expense.amount_paisa / 100));
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>(expense.payment_method);
  const [vendor, setVendor] = useState(expense.vendor ?? "");
  const [note, setNote] = useState(expense.note ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await updateExpense(expense.id, {
        amountPaisa: rupeesToPaisa(Number(amountRupees) || 0),
        paymentMethod,
        vendor: vendor || undefined,
        note: note || undefined,
        receiptUrl: expense.receipt_url ?? undefined,
        periodStart: expense.period_start ?? undefined,
        periodEnd: expense.period_end ?? undefined,
      });
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
        <h3 className="mb-4 font-medium">Edit expense</h3>
        <div className="space-y-3">
          <label className="block">
            <span className="mb-1 block text-xs text-neutral-400">Amount (Rs)</span>
            <input
              type="number"
              step="0.01"
              value={amountRupees}
              onChange={(e) => setAmountRupees(e.target.value)}
              className="input"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs text-neutral-400">Payment method</span>
            <select
              value={paymentMethod}
              onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod)}
              className="input"
            >
              {Object.entries(METHOD_LABEL).map(([m, label]) => (
                <option key={m} value={m}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs text-neutral-400">Vendor</span>
            <input value={vendor} onChange={(e) => setVendor(e.target.value)} className="input" />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs text-neutral-400">Note</span>
            <input value={note} onChange={(e) => setNote(e.target.value)} className="input" />
          </label>
          <p className="text-xs text-neutral-500">Only possible while the business day is still open.</p>
          {error && <p className="text-sm text-red-400">{error}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <button onClick={onClose} className="rounded-md px-4 py-2 text-sm text-neutral-400">
              Cancel
            </button>
            <button
              onClick={save}
              disabled={saving}
              className="rounded-md bg-white px-4 py-2 text-sm font-medium text-neutral-950 disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

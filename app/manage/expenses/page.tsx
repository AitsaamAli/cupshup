"use client";

import { useState } from "react";
import Link from "next/link";
import { useStaffSession } from "@/lib/auth";
import { useBusinessDay } from "@/lib/business-day";
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
import { AppShell } from "@/components/ui/AppShell";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { DataTable, type DataTableColumn } from "@/components/ui/DataTable";
import { StatusBadge } from "@/components/ui/StatusBadge";

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

const PORTAL_NAV = [
  { label: "Dashboard", href: "/reports/dashboard" },
  { label: "Master P&L", href: "/reports/pl" },
  { label: "Menu", href: "/manage/menu" },
  { label: "Inventory", href: "/manage/inventory" },
  { label: "Purchases", href: "/manage/purchases" },
  { label: "Expenses", href: "/manage/expenses" },
  { label: "Business day", href: "/manage/day" },
];

/**
 * Expense entry — Part 14. Approval thresholds are enforced server-side
 * in record_expense()/approve_expense(); requiredApprovalRole() here is
 * only a UI hint shown before submitting, same "preview, never the real
 * enforcement" relationship every other threshold preview in this app
 * has to its RPC (previewSplitTax, previewWeightedAvgCost, ...).
 */
export default function ExpensesPage() {
  const { staff, loading: staffLoading, lock } = useStaffSession("manage");
  const { day } = useBusinessDay(OUTLET_ID);
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

  const columns: DataTableColumn<Expense>[] = [
    {
      key: "date",
      header: "Date",
      sortValue: (e) => e.created_at,
      render: (e) => <span className="text-ink-500">{new Date(e.created_at).toLocaleDateString()}</span>,
    },
    { key: "category", header: "Category", render: (e) => categoryName(e.category_id) },
    { key: "amount", header: "Amount", align: "right", numeric: true, render: (e) => formatPaisa(e.amount_paisa as Paisa) },
    { key: "method", header: "Method", render: (e) => <span className="text-ink-500">{METHOD_LABEL[e.payment_method]}</span> },
    { key: "vendor", header: "Vendor", render: (e) => <span className="text-ink-500">{e.vendor ?? "—"}</span> },
    {
      key: "status",
      header: "Status",
      render: (e) =>
        e.approved_by ? (
          <StatusBadge status="ready" label="Approved" />
        ) : (
          <StatusBadge status="waiting" label={`Pending (${requiredApprovalRole(e.amount_paisa)})`} />
        ),
    },
    {
      key: "actions",
      header: "",
      align: "right",
      render: (e) => (
        <div className="flex justify-end gap-3">
          {!e.approved_by && canApprove && (
            <Button variant="quiet" className="text-success hover:text-success" onClick={() => doApprove(e.id)}>
              Approve
            </Button>
          )}
          {canEdit && (
            <Button variant="quiet" onClick={() => setEditing(e)}>
              Edit
            </Button>
          )}
          {isOwner && (
            <Button variant="quiet" className="text-danger hover:text-danger" onClick={() => doDelete(e.id)}>
              Delete
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
      crumbs={[{ label: "Expenses" }]}
      staff={staff}
      dayStatus={day?.status === "open" ? "open" : "closed"}
      onLock={lock}
    >
      <div className="p-4">
        <div className="mb-4 flex items-center justify-between">
          <h1 className="text-portal-xl font-semibold text-ink-900">Expenses</h1>
          <Link href="/manage/expenses/reports" className="text-portal-sm text-brand-700 hover:underline">
            Reports
          </Link>
        </div>

        {error && <p className="mb-4 text-portal-sm text-danger">{error}</p>}

        {canEnter && (
          <EntryForm
            categories={categories}
            onSaved={() => {
              reload();
            }}
            onError={setError}
          />
        )}

        <h2 className="mb-3 mt-8 text-portal-sm font-semibold text-ink-900">Recent expenses</h2>
        <Card className="p-4">
          {loading ? (
            <p className="text-portal-sm text-ink-500">Loading…</p>
          ) : (
            <DataTable columns={columns} rows={expenses} keyExtractor={(e) => e.id} emptyMessage="No expenses recorded yet." />
          )}
        </Card>
      </div>

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
    </AppShell>
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
    // Outlet id must be the FIRST path segment — the storage RLS policy
    // (0038_second_wave_storage_outlet_scoping.sql) checks
    // (storage.foldername(name))[1] against the caller's own outlet, so a
    // path that doesn't start with it would upload successfully but then
    // be unreadable by anyone, including this same outlet.
    const path = `${OUTLET_ID}/${categoryId}/${Date.now()}-${receiptFile.name}`;
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
    <Card className="p-4">
      <h2 className="mb-3 text-portal-sm font-semibold text-ink-900">Record an expense</h2>
      <div className="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label="Category" htmlFor="expense-category">
          <Select id="expense-category" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            <option value="">Select…</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({c.accrual_type})
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label={`Amount (Rs)${approvalHint && approvalHint !== "supervisor" ? ` — needs ${approvalHint} approval` : ""}`}
          htmlFor="expense-amount"
        >
          <Input id="expense-amount" type="number" step="0.01" value={amountRupees} onChange={(e) => setAmountRupees(e.target.value)} />
        </Field>
        <Field label="Payment method" htmlFor="expense-method">
          <Select id="expense-method" value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod)}>
            {Object.entries(METHOD_LABEL).map(([m, label]) => (
              <option key={m} value={m}>
                {label}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      {isAmortized && (
        <div className="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Period start" htmlFor="expense-period-start">
            <Input id="expense-period-start" type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} />
          </Field>
          <Field label="Period end (exclusive)" htmlFor="expense-period-end">
            <Input id="expense-period-end" type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} />
          </Field>
        </div>
      )}

      <div className="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label="Vendor" htmlFor="expense-vendor">
          <Input id="expense-vendor" value={vendor} onChange={(e) => setVendor(e.target.value)} />
        </Field>
        <Field label="Note" htmlFor="expense-note">
          <Input id="expense-note" value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <Field label="Receipt photo" htmlFor="expense-receipt">
          <input
            id="expense-receipt"
            type="file"
            accept="image/*"
            onChange={(e) => setReceiptFile(e.target.files?.[0] ?? null)}
            className="text-portal-sm text-ink-500"
          />
        </Field>
      </div>

      <Button variant="primary" onClick={submit} disabled={saving}>
        {saving ? "Saving…" : "Record expense"}
      </Button>
    </Card>
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
    <Modal title="Edit expense" onClose={onClose}>
      <div className="space-y-3">
        <Field label="Amount (Rs)" htmlFor="edit-expense-amount">
          <Input id="edit-expense-amount" type="number" step="0.01" value={amountRupees} onChange={(e) => setAmountRupees(e.target.value)} />
        </Field>
        <Field label="Payment method" htmlFor="edit-expense-method">
          <Select id="edit-expense-method" value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod)}>
            {Object.entries(METHOD_LABEL).map(([m, label]) => (
              <option key={m} value={m}>
                {label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Vendor" htmlFor="edit-expense-vendor">
          <Input id="edit-expense-vendor" value={vendor} onChange={(e) => setVendor(e.target.value)} />
        </Field>
        <Field label="Note" htmlFor="edit-expense-note">
          <Input id="edit-expense-note" value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <p className="text-portal-xs text-ink-500">Only possible while the business day is still open.</p>
        {error && <p className="text-portal-sm text-danger">{error}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="quiet" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

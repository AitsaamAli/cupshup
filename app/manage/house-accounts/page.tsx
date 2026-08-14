"use client";

import { useState } from "react";
import { useStaffSession } from "@/lib/auth";
import { useBusinessDay } from "@/lib/business-day";
import {
  useHouseAccountBalances,
  useHouseAccountStatement,
  upsertHouseAccount,
  setHouseAccountActive,
  recordHouseAccountPayment,
  type HouseAccountBalanceRow,
} from "@/lib/house-accounts";
import type { PaymentMethod } from "@/lib/settlement";
import { formatPaisa, rupeesToPaisa, type Paisa } from "@/lib/money";
import { AppShell } from "@/components/ui/AppShell";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { DataTable, type DataTableColumn } from "@/components/ui/DataTable";
import { StatusBadge } from "@/components/ui/StatusBadge";

const OUTLET_ID = process.env.NEXT_PUBLIC_SUPABASE_OUTLET_ID!;
const CAN_MANAGE = new Set(["owner", "manager"]);
const CAN_RECORD_PAYMENT = new Set(["owner", "manager", "supervisor", "cashier"]);
const METHOD_LABEL: Record<PaymentMethod, string> = {
  cash: "Cash",
  card: "Card",
  jazzcash: "JazzCash",
  easypaisa: "EasyPaisa",
  qr: "QR",
  foodpanda: "Foodpanda",
  house_account: "House account",
};

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
 * Khata/Credit — Patch 1 (restaurant-system-master-prompt.md §4.5, 3).
 * Every write here goes through the RPCs in
 * 0047_house_accounts_functions.sql; balances always come from the
 * house_account_balances view (0047), never re-summed here — same
 * single-source-of-truth rule the master prompt's §4.1 requires. The
 * credit limit itself is enforced server-side, inside settle_order() —
 * this screen's own numbers are for humans to read, not what actually
 * blocks an over-limit charge.
 */
export default function HouseAccountsPage() {
  const { staff, loading: staffLoading, lock } = useStaffSession("manage");
  const { day } = useBusinessDay(OUTLET_ID);
  const { rows, loading, reload } = useHouseAccountBalances(OUTLET_ID);
  const [editing, setEditing] = useState<HouseAccountBalanceRow | "new" | null>(null);
  const [payingFor, setPayingFor] = useState<HouseAccountBalanceRow | null>(null);
  const [statementFor, setStatementFor] = useState<HouseAccountBalanceRow | null>(null);

  const canManage = !!staff && CAN_MANAGE.has(staff.role);
  const canRecordPayment = !!staff && CAN_RECORD_PAYMENT.has(staff.role);

  const columns: DataTableColumn<HouseAccountBalanceRow>[] = [
    {
      key: "name",
      header: "Account",
      sortValue: (r) => r.name,
      render: (r) => (
        <span className={`inline-flex items-center gap-2 ${r.active ? "" : "text-ink-300"}`}>
          {r.name}
          {!r.active && <StatusBadge status="void" label="Inactive" />}
        </span>
      ),
    },
    {
      key: "limit",
      header: "Credit limit",
      align: "right",
      numeric: true,
      render: (r) => formatPaisa(r.credit_limit_paisa as Paisa),
    },
    {
      key: "outstanding",
      header: "Outstanding",
      align: "right",
      numeric: true,
      sortValue: (r) => r.outstanding_paisa,
      render: (r) => (
        <span className={r.outstanding_paisa > 0 ? "text-warning" : "text-ink-500"}>
          {formatPaisa(r.outstanding_paisa as Paisa)}
        </span>
      ),
    },
    {
      key: "available",
      header: "Available",
      align: "right",
      numeric: true,
      render: (r) => {
        const available = r.credit_limit_paisa - r.outstanding_paisa;
        return <span className={available <= 0 ? "text-danger" : "text-ink-900"}>{formatPaisa(available as Paisa)}</span>;
      },
    },
    {
      key: "actions",
      header: "",
      align: "right",
      render: (r) => (
        <div className="flex justify-end gap-3">
          <Button variant="quiet" onClick={() => setStatementFor(r)}>
            Statement
          </Button>
          {canRecordPayment && (
            <Button variant="quiet" onClick={() => setPayingFor(r)}>
              Record payment
            </Button>
          )}
          {canManage && (
            <>
              <Button variant="quiet" onClick={() => setEditing(r)}>
                Edit
              </Button>
              <Button
                variant="quiet"
                onClick={async () => {
                  await setHouseAccountActive(r.account_id, !r.active);
                  reload();
                }}
              >
                {r.active ? "Deactivate" : "Reactivate"}
              </Button>
            </>
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
      crumbs={[{ label: "House accounts" }]}
      staff={staff}
      dayStatus={day?.status === "open" ? "open" : "closed"}
      onLock={lock}
    >
      <div className="p-4">
        <div className="mb-4 flex items-center justify-between">
          <h1 className="text-portal-xl font-semibold text-ink-900">House Accounts</h1>
          {canManage && (
            <Button variant="primary" onClick={() => setEditing("new")}>
              + Add account
            </Button>
          )}
        </div>

        <Card className="p-4">
          {loading ? (
            <p className="text-portal-sm text-ink-500">Loading…</p>
          ) : (
            <DataTable columns={columns} rows={rows} keyExtractor={(r) => r.account_id} emptyMessage="No house accounts yet." />
          )}
        </Card>
      </div>

      {editing && (
        <AccountDialog
          account={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            reload();
          }}
        />
      )}

      {payingFor && (
        <PaymentDialog
          account={payingFor}
          onClose={() => setPayingFor(null)}
          onSaved={() => {
            setPayingFor(null);
            reload();
          }}
        />
      )}

      {statementFor && <StatementDialog account={statementFor} onClose={() => setStatementFor(null)} />}
    </AppShell>
  );
}

function AccountDialog({
  account,
  onClose,
  onSaved,
}: {
  account: HouseAccountBalanceRow | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(account?.name ?? "");
  const [creditLimitRupees, setCreditLimitRupees] = useState(account ? String(account.credit_limit_paisa / 100) : "");
  const [billingDay, setBillingDay] = useState(account?.billing_day ?? 1);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (!name.trim()) {
      setError("Name is required.");
      return;
    }
    const limit = rupeesToPaisa(Number(creditLimitRupees) || 0);
    if (limit < 0) {
      setError("Credit limit cannot be negative.");
      return;
    }
    if (billingDay < 1 || billingDay > 28) {
      setError("Billing day must be between 1 and 28.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await upsertHouseAccount(account?.account_id ?? null, name.trim(), limit, billingDay);
      onSaved();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={account ? "Edit account" : "Add house account"} onClose={onClose}>
      <div className="space-y-3">
        <Field label="Name" htmlFor="ha-name">
          <Input id="ha-name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </Field>
        <Field label="Credit limit (Rs)" htmlFor="ha-limit">
          <Input id="ha-limit" type="number" step="0.01" value={creditLimitRupees} onChange={(e) => setCreditLimitRupees(e.target.value)} />
        </Field>
        <Field label="Billing day (1-28)" htmlFor="ha-billing-day">
          <Input
            id="ha-billing-day"
            type="number"
            min={1}
            max={28}
            value={billingDay}
            onChange={(e) => setBillingDay(Number(e.target.value))}
          />
        </Field>
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

function PaymentDialog({
  account,
  onClose,
  onSaved,
}: {
  account: HouseAccountBalanceRow;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [amountRupees, setAmountRupees] = useState(String(account.outstanding_paisa / 100));
  const [method, setMethod] = useState<PaymentMethod>("cash");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    const amount = rupeesToPaisa(Number(amountRupees) || 0);
    if (amount <= 0) {
      setError("Enter a valid amount.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await recordHouseAccountPayment(account.account_id, amount, method, note || undefined);
      onSaved();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={`Record payment — ${account.name}`} onClose={onClose}>
      <div className="space-y-3">
        <p className="text-portal-sm text-ink-500">
          Current outstanding: {formatPaisa(account.outstanding_paisa as Paisa)}
        </p>
        <Field label="Amount received (Rs)" htmlFor="ha-payment-amount">
          <Input id="ha-payment-amount" type="number" step="0.01" value={amountRupees} onChange={(e) => setAmountRupees(e.target.value)} autoFocus />
        </Field>
        <Field label="Method" htmlFor="ha-payment-method">
          <Select id="ha-payment-method" value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>
            {Object.entries(METHOD_LABEL)
              .filter(([m]) => m !== "house_account")
              .map(([m, label]) => (
                <option key={m} value={m}>
                  {label}
                </option>
              ))}
          </Select>
        </Field>
        <Field label="Note (optional)" htmlFor="ha-payment-note">
          <Input id="ha-payment-note" value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        {error && <p className="text-portal-sm text-danger">{error}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="quiet" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Record payment"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function StatementDialog({ account, onClose }: { account: HouseAccountBalanceRow; onClose: () => void }) {
  const { charges, payments, loading } = useHouseAccountStatement(account.account_id);

  const rows = [
    ...charges.map((c) => ({ date: c.created_at, label: "Order charge", amount: c.amount_paisa })),
    ...payments.map((p) => ({ date: p.created_at, label: `Payment (${METHOD_LABEL[p.method]})${p.note ? ` — ${p.note}` : ""}`, amount: -p.amount_paisa })),
  ].sort((a, b) => b.date.localeCompare(a.date));

  return (
    <Modal title={`Statement — ${account.name}`} onClose={onClose}>
      <div className="space-y-3">
        <p className="text-portal-sm text-ink-500">
          Outstanding: <span className="font-medium text-ink-900">{formatPaisa(account.outstanding_paisa as Paisa)}</span>
        </p>
        {loading ? (
          <p className="text-portal-sm text-ink-500">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="text-portal-sm text-ink-500">No activity yet.</p>
        ) : (
          <table className="w-full text-left text-portal-sm">
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className="border-t border-line">
                  <td className="py-1.5 pr-4 text-ink-500">{new Date(r.date).toLocaleDateString()}</td>
                  <td className="py-1.5 pr-4 text-ink-900">{r.label}</td>
                  <td className={`py-1.5 text-right tabular-nums ${r.amount > 0 ? "text-ink-900" : "text-success"}`}>
                    {r.amount > 0 ? "+" : ""}
                    {formatPaisa(r.amount as Paisa)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div className="flex justify-end pt-2">
          <Button variant="quiet" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </Modal>
  );
}

"use client";

import { useState } from "react";
import { useStaffSession } from "@/lib/auth";
import { useBusinessDay } from "@/lib/business-day";
import {
  useSuppliers,
  useSupplierPayables,
  upsertSupplier,
  setSupplierActive,
  type Supplier,
} from "@/lib/purchases";
import { formatPaisa, type Paisa } from "@/lib/money";
import { AppShell } from "@/components/ui/AppShell";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { DataTable, type DataTableColumn } from "@/components/ui/DataTable";
import { StatusBadge } from "@/components/ui/StatusBadge";

const OUTLET_ID = process.env.NEXT_PUBLIC_SUPABASE_OUTLET_ID!;
const CAN_EDIT = new Set(["owner", "manager"]);

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
 * Supplier CRUD + payables — Part 12. "Delete" is really
 * set_supplier_active(false) — a supplier already tied to purchase
 * history is never actually removed, same as every other entity in this
 * app (menu items, staff, ...).
 */
export default function SuppliersPage() {
  const { staff, loading: staffLoading, lock } = useStaffSession("manage");
  const { day } = useBusinessDay(OUTLET_ID);
  const { suppliers, loading, reload } = useSuppliers(OUTLET_ID);
  const { rows: payables } = useSupplierPayables(OUTLET_ID);
  const [editing, setEditing] = useState<Supplier | "new" | null>(null);

  const canEdit = !!staff && CAN_EDIT.has(staff.role);
  const payableFor = (id: string) => payables.find((p) => p.supplier_id === id);

  const columns: DataTableColumn<Supplier>[] = [
    {
      key: "name",
      header: "Name",
      sortValue: (s) => s.name,
      render: (s) => (
        <span className={`inline-flex items-center gap-2 ${s.active ? "" : "text-ink-300"}`}>
          {s.name}
          {!s.active && <StatusBadge status="void" label="Retired" />}
        </span>
      ),
    },
    { key: "phone", header: "Phone", render: (s) => <span className="text-ink-500">{s.phone ?? "—"}</span> },
    { key: "terms", header: "Terms", render: (s) => <span className="text-ink-500">{s.terms ?? "—"}</span> },
    {
      key: "payable",
      header: "Payable",
      align: "right",
      numeric: true,
      sortValue: (s) => payableFor(s.id)?.payable_paisa ?? 0,
      render: (s) => {
        const p = payableFor(s.id);
        return (
          <span className={p && p.payable_paisa > 0 ? "text-warning" : "text-ink-500"}>
            {formatPaisa((p?.payable_paisa ?? 0) as Paisa)}
            {p && p.open_invoices > 0 && ` (${p.open_invoices} open)`}
          </span>
        );
      },
    },
    {
      key: "actions",
      header: "",
      align: "right",
      render: (s) =>
        canEdit && (
          <div className="flex justify-end gap-3">
            <Button variant="quiet" onClick={() => setEditing(s)}>
              Edit
            </Button>
            <Button
              variant="quiet"
              onClick={async () => {
                await setSupplierActive(s.id, !s.active);
                reload();
              }}
            >
              {s.active ? "Retire" : "Reactivate"}
            </Button>
          </div>
        ),
    },
  ];

  if (staffLoading) return <div className="min-h-screen bg-canvas" />;

  return (
    <AppShell
      density="portal"
      nav={PORTAL_NAV}
      crumbs={[{ label: "Purchases" }, { label: "Suppliers" }]}
      staff={staff}
      dayStatus={day?.status === "open" ? "open" : "closed"}
      onLock={lock}
    >
      <div className="p-4">
        <div className="mb-4 flex items-center justify-between">
          <h1 className="text-portal-xl font-semibold text-ink-900">Suppliers</h1>
          {canEdit && (
            <Button variant="primary" onClick={() => setEditing("new")}>
              + Add supplier
            </Button>
          )}
        </div>

        <Card className="p-4">
          {loading ? (
            <p className="text-portal-sm text-ink-500">Loading…</p>
          ) : (
            <DataTable
              columns={columns}
              rows={suppliers}
              keyExtractor={(s) => s.id}
              emptyMessage="No suppliers yet."
            />
          )}
        </Card>
      </div>

      {editing && (
        <SupplierDialog
          supplier={editing === "new" ? null : editing}
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

function SupplierDialog({
  supplier,
  onClose,
  onSaved,
}: {
  supplier: Supplier | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(supplier?.name ?? "");
  const [phone, setPhone] = useState(supplier?.phone ?? "");
  const [terms, setTerms] = useState(supplier?.terms ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (!name.trim()) {
      setError("Name is required.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await upsertSupplier(supplier?.id ?? null, name.trim(), {
        phone: phone.trim() || undefined,
        terms: terms.trim() || undefined,
      });
      onSaved();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={supplier ? "Edit supplier" : "Add supplier"} onClose={onClose}>
      <div className="space-y-3">
        <Field label="Name" htmlFor="supplier-name">
          <Input id="supplier-name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </Field>
        <Field label="Phone" htmlFor="supplier-phone">
          <Input id="supplier-phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </Field>
        <Field label={'Terms (e.g. "Net 15 days")'} htmlFor="supplier-terms">
          <Input id="supplier-terms" value={terms} onChange={(e) => setTerms(e.target.value)} />
        </Field>
        {error && <p className="text-portal-xs text-danger">{error}</p>}
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

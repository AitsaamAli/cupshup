"use client";

import { useState } from "react";
import { useStaffSession } from "@/lib/auth";
import {
  useSuppliers,
  useSupplierPayables,
  upsertSupplier,
  setSupplierActive,
  type Supplier,
} from "@/lib/purchases";
import { formatPaisa, type Paisa } from "@/lib/money";

const OUTLET_ID = process.env.NEXT_PUBLIC_SUPABASE_OUTLET_ID!;
const CAN_EDIT = new Set(["owner", "manager"]);

/**
 * Supplier CRUD + payables — Part 12. "Delete" is really
 * set_supplier_active(false) — a supplier already tied to purchase
 * history is never actually removed, same as every other entity in this
 * app (menu items, staff, ...).
 */
export default function SuppliersPage() {
  const { staff } = useStaffSession("manage");
  const { suppliers, loading, reload } = useSuppliers(OUTLET_ID);
  const { rows: payables } = useSupplierPayables(OUTLET_ID);
  const [editing, setEditing] = useState<Supplier | "new" | null>(null);

  const canEdit = !!staff && CAN_EDIT.has(staff.role);
  const payableFor = (id: string) => payables.find((p) => p.supplier_id === id);

  if (loading) return <p className="p-8 text-neutral-400">Loading suppliers…</p>;

  return (
    <main className="min-h-screen bg-neutral-950 p-6 text-white">
      <header className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Suppliers</h1>
        {canEdit && (
          <button
            onClick={() => setEditing("new")}
            className="rounded-lg bg-white px-3 py-1.5 text-sm font-medium text-neutral-950"
          >
            + Add supplier
          </button>
        )}
      </header>

      <table className="w-full text-left text-sm">
        <thead className="text-neutral-500">
          <tr>
            <th className="pb-2 pr-4">Name</th>
            <th className="pb-2 pr-4">Phone</th>
            <th className="pb-2 pr-4">Terms</th>
            <th className="pb-2 pr-4">Payable</th>
            <th className="pb-2 pr-4"></th>
          </tr>
        </thead>
        <tbody>
          {suppliers.map((s) => {
            const p = payableFor(s.id);
            return (
              <tr key={s.id} className={`border-t border-neutral-800 ${!s.active ? "opacity-50" : ""}`}>
                <td className="py-2 pr-4">{s.name}</td>
                <td className="py-2 pr-4 text-neutral-400">{s.phone ?? "—"}</td>
                <td className="py-2 pr-4 text-neutral-400">{s.terms ?? "—"}</td>
                <td className={`py-2 pr-4 ${p && p.payable_paisa > 0 ? "text-amber-400" : "text-neutral-500"}`}>
                  {formatPaisa((p?.payable_paisa ?? 0) as Paisa)}
                  {p && p.open_invoices > 0 && ` (${p.open_invoices} open)`}
                </td>
                <td className="py-2 pr-4 text-right">
                  {canEdit && (
                    <>
                      <button onClick={() => setEditing(s)} className="mr-3 text-neutral-400 underline">
                        Edit
                      </button>
                      <button
                        onClick={async () => {
                          await setSupplierActive(s.id, !s.active);
                          reload();
                        }}
                        className="text-neutral-400 underline"
                      >
                        {s.active ? "Retire" : "Reactivate"}
                      </button>
                    </>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

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
    </main>
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-sm rounded-2xl border border-neutral-800 bg-neutral-900 p-5">
        <h3 className="mb-4 font-medium">{supplier ? "Edit supplier" : "Add supplier"}</h3>
        <div className="space-y-3">
          <label className="block">
            <span className="mb-1 block text-xs text-neutral-400">Name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} className="input" autoFocus />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs text-neutral-400">Phone</span>
            <input value={phone} onChange={(e) => setPhone(e.target.value)} className="input" />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs text-neutral-400">Terms (e.g. &quot;Net 15 days&quot;)</span>
            <input value={terms} onChange={(e) => setTerms(e.target.value)} className="input" />
          </label>
          {error && <p className="text-sm text-red-400">{error}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <button onClick={onClose} className="rounded-lg px-4 py-2 text-sm text-neutral-400">
              Cancel
            </button>
            <button
              onClick={save}
              disabled={saving}
              className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-neutral-950 disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

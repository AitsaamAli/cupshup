"use client";

import { useMemo, useState } from "react";
import { useStaffSession } from "@/lib/auth";
import { useMenu, type MenuItem } from "@/lib/menu";
import { formatPaisa, rupeesToPaisa, type Paisa } from "@/lib/money";
import { createClient } from "@/lib/supabase/client";
import { uploadMenuItemImage } from "@/lib/storage";
import { Modal } from "@/components/ui/Modal";

const OUTLET_ID = process.env.NEXT_PUBLIC_SUPABASE_OUTLET_ID!;
const CAN_EDIT_MENU = new Set(["owner", "manager"]);
const CAN_TOGGLE_86 = new Set(["owner", "manager", "supervisor", "chef", "kitchen"]);

/**
 * Menu management — Part 08. Everything here calls the RPCs in
 * 0005_menu_functions.sql; nothing writes to menu_items/menu_item_prices
 * directly. Role gating in this UI is convenience only (Part 04's RLS +
 * each function's own has_role() check is the real security boundary —
 * a Chef who somehow reaches the "change price" button still gets
 * rejected server-side).
 */
export default function MenuManagementPage() {
  const { staff, loading: staffLoading } = useStaffSession("manage");
  const { categories, items, currentPrices, loading: menuLoading, reload } = useMenu(OUTLET_ID);

  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);
  const [editingItem, setEditingItem] = useState<MenuItem | "new" | null>(null);
  const [priceItem, setPriceItem] = useState<MenuItem | null>(null);

  const canEditMenu = !!staff && CAN_EDIT_MENU.has(staff.role);
  const canToggle86 = !!staff && CAN_TOGGLE_86.has(staff.role);

  const activeCategoryId = selectedCategoryId ?? categories[0]?.id ?? null;

  const unconfirmedItems = useMemo(
    () => items.filter((i) => i.price_unconfirmed && i.active),
    [items]
  );

  const itemsInCategory = useMemo(
    () => items.filter((i) => i.category_id === activeCategoryId && i.active),
    [items, activeCategoryId]
  );

  if (staffLoading || menuLoading) {
    return <p className="p-8 text-neutral-400">Loading menu…</p>;
  }

  return (
    <main className="min-h-screen bg-neutral-950 p-6 text-white">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Menu Management</h1>
          <p className="text-sm text-neutral-400">
            {staff?.name} — {staff?.role}
          </p>
        </div>
        {staff?.role === "owner" && (
          <a href="/manage/menu/price-history" className="text-sm text-neutral-300 underline">
            Price history
          </a>
        )}
      </header>

      {unconfirmedItems.length > 0 && (
        <section className="mb-6 rounded-md border border-amber-500/50 bg-amber-500/10 p-4">
          <h2 className="mb-2 text-sm font-semibold text-amber-300">
            Needs price confirmation ({unconfirmedItems.length})
          </h2>
          <ul className="flex flex-wrap gap-2">
            {unconfirmedItems.map((item) => (
              <li key={item.id}>
                <button
                  onClick={() => canEditMenu && setPriceItem(item)}
                  className="rounded-md bg-amber-500/20 px-3 py-1 text-sm text-amber-200"
                >
                  {item.name} — {formatPaisa((currentPrices[item.id]?.price_paisa ?? 0) as Paisa)}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="flex gap-6">
        <CategoryList
          categories={categories}
          activeCategoryId={activeCategoryId}
          canReorder={canEditMenu}
          onSelect={setSelectedCategoryId}
          onReordered={reload}
        />

        <section className="flex-1">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-medium">
              {categories.find((c) => c.id === activeCategoryId)?.name ?? "Select a category"}
            </h2>
            {canEditMenu && activeCategoryId && (
              <button
                onClick={() => setEditingItem("new")}
                className="rounded-md bg-white px-3 py-1.5 text-sm font-medium text-neutral-950"
              >
                + Add item
              </button>
            )}
          </div>

          <ul className="space-y-2">
            {itemsInCategory.map((item) => (
              <ItemRow
                key={item.id}
                item={item}
                priceLabel={formatPaisa((currentPrices[item.id]?.price_paisa ?? 0) as Paisa)}
                canEditMenu={canEditMenu}
                canToggle86={canToggle86}
                onEdit={() => setEditingItem(item)}
                onChangePrice={() => setPriceItem(item)}
                onReload={reload}
              />
            ))}
            {itemsInCategory.length === 0 && (
              <p className="text-sm text-neutral-500">No items in this category yet.</p>
            )}
          </ul>
        </section>
      </div>

      {editingItem && activeCategoryId && (
        <ItemFormDialog
          item={editingItem === "new" ? null : editingItem}
          categoryId={activeCategoryId}
          onClose={() => setEditingItem(null)}
          onSaved={() => {
            setEditingItem(null);
            reload();
          }}
        />
      )}

      {priceItem && (
        <PriceDialog
          item={priceItem}
          currentPricePaisa={currentPrices[priceItem.id]?.price_paisa ?? 0}
          onClose={() => setPriceItem(null)}
          onSaved={() => {
            setPriceItem(null);
            reload();
          }}
        />
      )}
    </main>
  );
}

function CategoryList({
  categories,
  activeCategoryId,
  canReorder,
  onSelect,
  onReordered,
}: {
  categories: { id: string; name: string; sort_order: number }[];
  activeCategoryId: string | null;
  canReorder: boolean;
  onSelect: (id: string) => void;
  onReordered: () => void;
}) {
  async function move(index: number, direction: -1 | 1) {
    const next = [...categories];
    const target = index + direction;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];

    const supabase = createClient();
    await supabase.rpc("reorder_categories", { p_category_ids: next.map((c) => c.id) });
    onReordered();
  }

  return (
    <nav className="w-56 shrink-0 space-y-1">
      {categories.map((cat, i) => (
        <div key={cat.id} className="flex items-center gap-1">
          <button
            onClick={() => onSelect(cat.id)}
            className={`flex-1 rounded-md px-3 py-2 text-left text-sm ${
              cat.id === activeCategoryId
                ? "bg-white text-neutral-950"
                : "bg-neutral-900 text-neutral-200 hover:bg-neutral-800"
            }`}
          >
            {cat.name}
          </button>
          {canReorder && (
            <div className="flex flex-col">
              <button
                onClick={() => move(i, -1)}
                disabled={i === 0}
                className="text-xs text-neutral-500 disabled:opacity-20"
                aria-label={`Move ${cat.name} up`}
              >
                ▲
              </button>
              <button
                onClick={() => move(i, 1)}
                disabled={i === categories.length - 1}
                className="text-xs text-neutral-500 disabled:opacity-20"
                aria-label={`Move ${cat.name} down`}
              >
                ▼
              </button>
            </div>
          )}
        </div>
      ))}
    </nav>
  );
}

function ItemRow({
  item,
  priceLabel,
  canEditMenu,
  canToggle86,
  onEdit,
  onChangePrice,
  onReload,
}: {
  item: MenuItem;
  priceLabel: string;
  canEditMenu: boolean;
  canToggle86: boolean;
  onEdit: () => void;
  onChangePrice: () => void;
  onReload: () => void;
}) {
  async function toggle86() {
    const supabase = createClient();
    await supabase.rpc("toggle_86", { p_item_id: item.id, p_is_86: !item.is_86 });
    onReload();
  }

  return (
    <li className="flex items-center gap-3 rounded-md border border-neutral-800 bg-neutral-900 p-3">
      {item.image_url ? (
        // eslint-disable-next-line @next/next/no-img-element -- menu photos are user-uploaded, arbitrary Storage URLs
        <img src={item.image_url} alt="" className="h-12 w-12 rounded-md object-cover" />
      ) : (
        <div className="h-12 w-12 rounded-md bg-neutral-800" />
      )}

      <div className="flex-1">
        <p className="font-medium">
          {item.name}
          {item.price_unconfirmed && (
            <span className="ml-2 rounded bg-amber-500/20 px-1.5 py-0.5 text-xs text-amber-300">
              unconfirmed
            </span>
          )}
          {item.is_86 && (
            <span className="ml-2 rounded bg-red-500/20 px-1.5 py-0.5 text-xs text-red-300">
              86&apos;d
            </span>
          )}
        </p>
        <button
          onClick={canEditMenu ? onChangePrice : undefined}
          disabled={!canEditMenu}
          className="text-sm text-neutral-400 disabled:cursor-default"
        >
          {priceLabel}
        </button>
      </div>

      <label className="flex items-center gap-2 text-sm text-neutral-400">
        86
        <input
          type="checkbox"
          checked={item.is_86}
          disabled={!canToggle86}
          onChange={toggle86}
          className="h-4 w-4"
        />
      </label>

      {canEditMenu && (
        <button onClick={onEdit} className="text-sm text-neutral-400 underline">
          Edit
        </button>
      )}
    </li>
  );
}

function ItemFormDialog({
  item,
  categoryId,
  onClose,
  onSaved,
}: {
  item: MenuItem | null;
  categoryId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(item?.name ?? "");
  const [sku, setSku] = useState(item?.sku ?? "");
  const [sortOrder, setSortOrder] = useState(item?.sort_order ?? 0);
  const [imageUrl, setImageUrl] = useState(item?.image_url ?? "");
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleImagePick(file: File) {
    setUploading(true);
    setError(null);
    try {
      const url = await uploadMenuItemImage(item?.id ?? crypto.randomUUID(), file);
      setImageUrl(url);
    } catch {
      setError("Image upload failed.");
    } finally {
      setUploading(false);
    }
  }

  async function save() {
    if (!name.trim()) {
      setError("Name is required.");
      return;
    }
    setSaving(true);
    setError(null);
    const supabase = createClient();
    const { error: saveError } = await supabase.rpc("upsert_menu_item", {
      p_id: item?.id ?? null,
      p_category_id: categoryId,
      p_name: name.trim(),
      p_sku: sku.trim() || null,
      p_sort_order: sortOrder,
      p_image_url: imageUrl || null,
    });
    setSaving(false);
    if (saveError) {
      setError(saveError.message);
      return;
    }
    onSaved();
  }

  return (
    <Modal onClose={onClose} title={item ? "Edit item" : "Add item"}>
      <div className="space-y-3">
        <Field label="Name">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="input"
            autoFocus
          />
        </Field>
        <Field label="SKU (optional)">
          <input value={sku} onChange={(e) => setSku(e.target.value)} className="input" />
        </Field>
        <Field label="Sort order">
          <input
            type="number"
            value={sortOrder}
            onChange={(e) => setSortOrder(Number(e.target.value))}
            className="input"
          />
        </Field>
        <Field label="Photo">
          <div className="flex items-center gap-3">
            {imageUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={imageUrl} alt="" className="h-12 w-12 rounded-md object-cover" />
            )}
            <input
              type="file"
              accept="image/*"
              disabled={uploading}
              onChange={(e) => e.target.files?.[0] && handleImagePick(e.target.files[0])}
              className="text-sm text-neutral-400"
            />
          </div>
        </Field>

        {error && <p className="text-sm text-red-400">{error}</p>}

        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="rounded-md px-4 py-2 text-sm text-neutral-400">
            Cancel
          </button>
          <button
            onClick={save}
            disabled={saving || uploading}
            className="rounded-md bg-white px-4 py-2 text-sm font-medium text-neutral-950 disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function PriceDialog({
  item,
  currentPricePaisa,
  onClose,
  onSaved,
}: {
  item: MenuItem;
  currentPricePaisa: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [newPriceRupees, setNewPriceRupees] = useState(String(currentPricePaisa / 100));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    const rupees = Number(newPriceRupees);
    if (!Number.isFinite(rupees) || rupees < 0) {
      setError("Enter a valid price.");
      return;
    }
    setSaving(true);
    setError(null);
    const supabase = createClient();
    const { error: saveError } = await supabase.rpc("change_item_price", {
      p_item_id: item.id,
      p_new_price_paisa: rupeesToPaisa(rupees),
    });
    setSaving(false);
    if (saveError) {
      setError(saveError.message);
      return;
    }
    onSaved();
  }

  return (
    <Modal onClose={onClose} title={`Change price — ${item.name}`}>
      <div className="space-y-3">
        <p className="text-sm text-neutral-400">
          Current price: {formatPaisa(currentPricePaisa as Paisa)}
        </p>
        <Field label="New price (Rs)">
          <input
            type="number"
            step="0.01"
            value={newPriceRupees}
            onChange={(e) => setNewPriceRupees(e.target.value)}
            className="input"
            autoFocus
          />
        </Field>
        <p className="text-xs text-neutral-500">
          This never overwrites the old price — it closes it out and starts a new one, so past
          invoices keep showing what was actually charged.
        </p>

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
            {saving ? "Saving…" : "Confirm price"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs text-neutral-400">{label}</span>
      {children}
    </label>
  );
}

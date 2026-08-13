"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useStaffSession } from "@/lib/auth";
import { useBusinessDay } from "@/lib/business-day";
import { useMenu, type MenuItem } from "@/lib/menu";
import { formatPaisa, rupeesToPaisa, type Paisa } from "@/lib/money";
import { createClient } from "@/lib/supabase/client";
import { uploadMenuItemImage } from "@/lib/storage";
import { AppShell } from "@/components/ui/AppShell";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { StatusBadge } from "@/components/ui/StatusBadge";

const OUTLET_ID = process.env.NEXT_PUBLIC_SUPABASE_OUTLET_ID!;
const CAN_EDIT_MENU = new Set(["owner", "manager"]);
const CAN_TOGGLE_86 = new Set(["owner", "manager", "supervisor", "chef", "kitchen"]);

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
 * Menu management — Part 08. Everything here calls the RPCs in
 * 0005_menu_functions.sql; nothing writes to menu_items/menu_item_prices
 * directly. Role gating in this UI is convenience only (Part 04's RLS +
 * each function's own has_role() check is the real security boundary —
 * a Chef who somehow reaches the "change price" button still gets
 * rejected server-side).
 */
export default function MenuManagementPage() {
  const { staff, loading: staffLoading, lock } = useStaffSession("manage");
  const { day } = useBusinessDay(OUTLET_ID);
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

  if (staffLoading) return <div className="min-h-screen bg-canvas" />;

  return (
    <AppShell
      density="portal"
      nav={PORTAL_NAV}
      crumbs={[{ label: "Menu" }]}
      staff={staff}
      dayStatus={day?.status === "open" ? "open" : "closed"}
      onLock={lock}
    >
      <div className="p-4">
        <div className="mb-4 flex items-center justify-between">
          <h1 className="text-portal-xl font-semibold text-ink-900">Menu Management</h1>
          {staff?.role === "owner" && (
            <Link href="/manage/menu/price-history" className="text-portal-sm text-brand-700 hover:underline">
              Price history
            </Link>
          )}
        </div>

        {menuLoading ? (
          <p className="text-portal-sm text-ink-500">Loading menu…</p>
        ) : (
          <>
            {unconfirmedItems.length > 0 && (
              <Card className="mb-6 border-warning/50 bg-warning/10 p-4">
                <h2 className="mb-2 text-portal-sm font-semibold text-warning">
                  Needs price confirmation ({unconfirmedItems.length})
                </h2>
                <ul className="flex flex-wrap gap-2">
                  {unconfirmedItems.map((item) => (
                    <li key={item.id}>
                      <button
                        onClick={() => canEditMenu && setPriceItem(item)}
                        className="rounded-md bg-warning/20 px-3 py-1 text-portal-sm text-warning"
                      >
                        {item.name} — {formatPaisa((currentPrices[item.id]?.price_paisa ?? 0) as Paisa)}
                      </button>
                    </li>
                  ))}
                </ul>
              </Card>
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
                  <h2 className="text-portal-lg font-semibold text-ink-900">
                    {categories.find((c) => c.id === activeCategoryId)?.name ?? "Select a category"}
                  </h2>
                  {canEditMenu && activeCategoryId && (
                    <Button variant="primary" onClick={() => setEditingItem("new")}>
                      + Add item
                    </Button>
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
                    <p className="text-portal-sm text-ink-500">No items in this category yet.</p>
                  )}
                </ul>
              </section>
            </div>
          </>
        )}
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
    </AppShell>
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
            className={`flex-1 rounded-md px-3 py-2 text-left text-portal-sm transition-colors duration-[120ms] ease-out ${
              cat.id === activeCategoryId ? "bg-brand-600 text-white" : "bg-surface text-ink-700 hover:bg-canvas"
            }`}
          >
            {cat.name}
          </button>
          {canReorder && (
            <div className="flex flex-col">
              <button
                onClick={() => move(i, -1)}
                disabled={i === 0}
                className="text-portal-2xs text-ink-500 disabled:opacity-20"
                aria-label={`Move ${cat.name} up`}
              >
                ▲
              </button>
              <button
                onClick={() => move(i, 1)}
                disabled={i === categories.length - 1}
                className="text-portal-2xs text-ink-500 disabled:opacity-20"
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
    <li className="flex items-center gap-3 rounded-lg border border-line bg-surface p-3">
      {item.image_url ? (
        // eslint-disable-next-line @next/next/no-img-element -- menu photos are user-uploaded, arbitrary Storage URLs
        <img src={item.image_url} alt="" className="h-12 w-12 rounded-md object-cover" />
      ) : (
        <div className="h-12 w-12 rounded-md bg-canvas" />
      )}

      <div className="flex-1">
        <p className="flex items-center gap-2 text-portal-sm font-medium text-ink-900">
          {item.name}
          {item.price_unconfirmed && <StatusBadge status="waiting" label="Unconfirmed" />}
          {item.is_86 && <StatusBadge status="void" label="86'd" />}
        </p>
        <button
          onClick={canEditMenu ? onChangePrice : undefined}
          disabled={!canEditMenu}
          className="text-portal-sm text-ink-500 disabled:cursor-default"
        >
          {priceLabel}
        </button>
      </div>

      <label className="flex items-center gap-2 text-portal-sm text-ink-500">
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
        <Button variant="quiet" onClick={onEdit}>
          Edit
        </Button>
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
        <Field label="Name" htmlFor="item-name">
          <Input id="item-name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </Field>
        <Field label="SKU (optional)" htmlFor="item-sku">
          <Input id="item-sku" value={sku} onChange={(e) => setSku(e.target.value)} />
        </Field>
        <Field label="Sort order" htmlFor="item-sort-order">
          <Input id="item-sort-order" type="number" value={sortOrder} onChange={(e) => setSortOrder(Number(e.target.value))} />
        </Field>
        <Field label="Photo" htmlFor="item-photo">
          <div className="flex items-center gap-3">
            {imageUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={imageUrl} alt="" className="h-12 w-12 rounded-md object-cover" />
            )}
            <input
              id="item-photo"
              type="file"
              accept="image/*"
              disabled={uploading}
              onChange={(e) => e.target.files?.[0] && handleImagePick(e.target.files[0])}
              className="text-portal-sm text-ink-500"
            />
          </div>
        </Field>

        {error && <p className="text-portal-sm text-danger">{error}</p>}

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="quiet" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={save} disabled={saving || uploading}>
            {saving ? "Saving…" : "Save"}
          </Button>
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
        <p className="text-portal-sm text-ink-500">
          Current price: {formatPaisa(currentPricePaisa as Paisa)}
        </p>
        <Field label="New price (Rs)" htmlFor="new-price">
          <Input id="new-price" type="number" step="0.01" value={newPriceRupees} onChange={(e) => setNewPriceRupees(e.target.value)} autoFocus />
        </Field>
        <p className="text-portal-xs text-ink-500">
          This never overwrites the old price — it closes it out and starts a new one, so past
          invoices keep showing what was actually charged.
        </p>

        {error && <p className="text-portal-sm text-danger">{error}</p>}

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="quiet" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Confirm price"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

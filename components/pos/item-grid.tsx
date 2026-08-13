"use client";

import { useEffect, useMemo, useState } from "react";
import { SearchInput } from "@/components/ui/SearchInput";
import { Money } from "@/components/ui/Money";
import { KeyboardHint } from "@/components/ui/KeyboardHint";
import type { MenuCategory, MenuItem } from "@/lib/menu";
import type { Paisa } from "@/lib/money";

export interface SelectableItem {
  item: MenuItem;
  pricePaisa: number;
}

/**
 * Category rail + search + item grid. Search matches on name (from the
 * first letter, "kar" -> Karak Chai) AND `sku`, which is what makes a
 * barcode/QR scanner work here for free: a scanner just types the
 * scanned code fast and hits Enter, exactly like a fast typist — no
 * separate scanner integration code needed.
 *
 * Reports whichever items are currently visible up to the parent via
 * `onVisibleItemsChange`, so the page's global "press 1-9" shortcut
 * always knows what digit N actually points at right now, without every
 * keystroke here needing to round-trip through the parent's state. The
 * `1`–`9` badges rendered on each of the first nine cards are the
 * signature keyboard-first element made visible.
 */
export function ItemGrid({
  categories,
  items,
  currentPrices,
  onSelect,
  onVisibleItemsChange,
}: {
  categories: MenuCategory[];
  items: MenuItem[];
  currentPrices: Record<string, { price_paisa: number }>;
  onSelect: (item: MenuItem) => void;
  onVisibleItemsChange: (visible: SelectableItem[]) => void;
}) {
  const [categoryId, setCategoryId] = useState<string | null>(categories[0]?.id ?? null);
  const [query, setQuery] = useState("");

  const sellable = useMemo(() => items.filter((i) => i.active && !i.is_86), [items]);

  const visible = useMemo<SelectableItem[]>(() => {
    const pool = query.trim() ? sellable : sellable.filter((i) => i.category_id === categoryId);

    const q = query.trim().toLowerCase();
    const matched = q ? pool.filter((i) => i.name.toLowerCase().includes(q) || i.sku?.toLowerCase() === q) : pool;

    return matched
      .map((item) => ({ item, pricePaisa: currentPrices[item.id]?.price_paisa ?? 0 }))
      .sort((a, b) => a.item.name.localeCompare(b.item.name));
  }, [sellable, categoryId, query, currentPrices]);

  useEffect(() => {
    onVisibleItemsChange(visible);
  }, [visible, onVisibleItemsChange]);

  return (
    <div className="flex h-full bg-canvas">
      <nav className="w-40 shrink-0 space-y-1 overflow-y-auto border-r border-line bg-surface p-2">
        {categories.map((c) => (
          <button
            key={c.id}
            onClick={() => {
              setCategoryId(c.id);
              setQuery("");
            }}
            className={`block min-h-14 w-full rounded-md px-2 py-2 text-left text-terminal-sm transition-colors duration-[120ms] ease-out ${
              c.id === categoryId && !query ? "bg-brand-50 font-medium text-brand-700" : "text-ink-700 hover:bg-canvas"
            }`}
          >
            {c.name}
          </button>
        ))}
      </nav>

      <div className="flex-1 overflow-y-auto p-3">
        <div className="mb-3">
          <SearchInput value={query} onChange={setQuery} placeholder="Search items (name or SKU)" />
        </div>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          {visible.map(({ item, pricePaisa }, i) => (
            <button
              key={item.id}
              onClick={() => onSelect(item)}
              className="flex min-h-16 flex-col items-start justify-between rounded-md border border-line bg-surface p-3 text-left transition-colors duration-[120ms] ease-out hover:border-brand-300"
            >
              <span className="flex w-full items-start justify-between gap-2">
                <span className="text-terminal-sm font-medium text-ink-900">{item.name}</span>
                {i < 9 && <KeyboardHint keys={String(i + 1)} className="shrink-0" />}
              </span>
              <Money paisa={pricePaisa as Paisa} className="text-terminal-sm text-ink-500" />
            </button>
          ))}
        </div>

        {visible.length === 0 && <p className="mt-6 text-portal-sm text-ink-500">No items match.</p>}
      </div>
    </div>
  );
}

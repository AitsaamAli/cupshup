"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { castRows } from "@/lib/supabase/rows";
import { offlineDb } from "@/lib/offline-db";
import { isNetworkError } from "@/lib/offline-network";

export interface MenuCategory {
  id: string;
  outlet_id: string;
  name: string;
  sort_order: number;
  color: string | null;
  active: boolean;
}

export interface MenuItem {
  id: string;
  category_id: string;
  name: string;
  sku: string | null;
  sort_order: number;
  active: boolean;
  is_86: boolean;
  price_unconfirmed: boolean;
  image_url: string | null;
}

export interface MenuItemPrice {
  id: string;
  menu_item_id: string;
  price_paisa: number;
  effective_from: string;
  effective_to: string | null;
}

export interface ModifierGroup {
  id: string;
  outlet_id: string;
  name: string;
  min_select: number;
  max_select: number;
}

export interface Modifier {
  id: string;
  group_id: string;
  name: string;
  price_delta_paisa: number;
}

export interface MenuData {
  categories: MenuCategory[];
  items: MenuItem[];
  /** Current (effective_to IS NULL) price per menu_item_id. */
  currentPrices: Record<string, MenuItemPrice>;
  modifierGroups: ModifierGroup[];
  modifiers: Modifier[];
  /** menu_item_id -> the modifier_group ids attached to it. */
  itemModifierGroups: Record<string, string[]>;
}

const EMPTY: MenuData = {
  categories: [],
  items: [],
  currentPrices: {},
  modifierGroups: [],
  modifiers: [],
  itemModifierGroups: {},
};

/**
 * Loads the full menu once, then keeps it live via Supabase Realtime: a
 * price change or an 86-toggle made on the admin screen (Part 08) — or
 * from any other terminal — shows up here within moments, no manual
 * refresh needed. This is the hook POS (Part 16) and KDS (Part 17) are
 * meant to consume; it's built now because Part 08 is the part that owns
 * the menu data shape.
 *
 * Part 20: a fetch that fails outright (no internet at all) used to
 * mean every one of these queries quietly resolved with `data: null`,
 * castRows() turned that into `[]`, and the item grid rendered as if
 * this outlet genuinely had zero menu items — a real, silent bug, not
 * a hypothetical one. reload() now catches that specific failure,
 * serves the last successfully-cached menu from IndexedDB instead, and
 * exposes `offline: true` so the UI can say so rather than pretend
 * nothing's wrong.
 */
export function useMenu(outletId: string) {
  const [data, setData] = useState<MenuData>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [offline, setOffline] = useState(false);

  const reload = useCallback(async () => {
    const supabase = createClient();

    // Checked directly against the FIRST query's own `error` field —
    // deliberately not a try/catch. Verified empirically (not assumed):
    // supabase-js does not throw on a dead connection, it resolves
    // normally with `{ data: null, error: { message: "TypeError: fetch
    // failed" } }`, same as any other rejected query. A network failure
    // is checked once, on this first query, as a stand-in for "are we
    // online at all" — if it fails, the rest would too; if it succeeds,
    // the network is up and the remaining four are trusted to behave
    // normally.
    const categoriesRes = await supabase
      .from("menu_categories")
      .select("*")
      .eq("outlet_id", outletId)
      .order("sort_order");

    if (categoriesRes.error && isNetworkError(categoriesRes.error)) {
      const cached = await offlineDb.menuCache.get(outletId);
      if (cached) setData(cached);
      setOffline(true);
      setLoading(false);
      return;
    }

    const categories = castRows<MenuCategory>(categoriesRes.data);
    const categoryIds = categories.map((c) => c.id);

    const [itemsRes, pricesRes, groupsRes, modifiersRes, itemGroupsRes] = await Promise.all([
      categoryIds.length
        ? supabase.from("menu_items").select("*").in("category_id", categoryIds).order("sort_order")
        : Promise.resolve({ data: [] as MenuItem[] }),
      supabase.from("menu_item_prices").select("*").is("effective_to", null),
      supabase.from("modifier_groups").select("*").eq("outlet_id", outletId),
      supabase.from("modifiers").select("*"),
      supabase.from("menu_item_modifier_groups").select("*"),
    ]);

    const currentPrices: Record<string, MenuItemPrice> = {};
    castRows<MenuItemPrice>(pricesRes.data).forEach((p) => {
      currentPrices[p.menu_item_id] = p;
    });

    const itemModifierGroups: Record<string, string[]> = {};
    castRows<{ menu_item_id: string; group_id: string }>(itemGroupsRes.data).forEach((row) => {
      (itemModifierGroups[row.menu_item_id] ??= []).push(row.group_id);
    });

    const fresh: MenuData = {
      categories,
      items: castRows<MenuItem>(itemsRes.data),
      currentPrices,
      modifierGroups: castRows<ModifierGroup>(groupsRes.data),
      modifiers: castRows<Modifier>(modifiersRes.data),
      itemModifierGroups,
    };
    setData(fresh);
    setOffline(false);
    setLoading(false);
    await offlineDb.menuCache.put({ outletId, ...fresh, cachedAt: new Date().toISOString() });
  }, [outletId]);

  useEffect(() => {
    reload();

    const supabase = createClient();
    const channel = supabase
      .channel(`menu-${outletId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "menu_items" }, reload)
      .on("postgres_changes", { event: "*", schema: "public", table: "menu_item_prices" }, reload)
      .on("postgres_changes", { event: "*", schema: "public", table: "menu_categories" }, reload)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "menu_item_modifier_groups" },
        reload
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [outletId, reload]);

  return { ...data, loading, offline, reload };
}

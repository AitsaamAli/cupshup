"use client";

import Dexie, { type Table } from "dexie";
import type { MenuCategory, MenuItem, MenuItemPrice, ModifierGroup, Modifier } from "./menu";
import type { OrderType, CartItem } from "./orders";

/**
 * Part 20's offline store — IndexedDB via Dexie. Three tables, each
 * solving a different half of "POS ko chalte rehna hai" (the register
 * has to keep working) when Johar Town's internet drops:
 *
 *   menuCache / dayCache — a snapshot of whatever useMenu()/
 *   useBusinessDay() last successfully loaded, served back instead of
 *   silently going empty the moment a fetch fails offline (see
 *   lib/menu.ts and lib/business-day.ts for where this plugs in — that
 *   silent-empty behaviour was a real latent bug, not hypothetical:
 *   neither hook previously distinguished "no items configured" from
 *   "couldn't reach the server").
 *
 *   orderQueue — orders taken while offline, written here immediately
 *   (before the UI ever waits on a network round trip) and drained the
 *   moment connectivity returns (lib/offline-orders.ts) — Part 09's
 *   idempotency key is what makes that drain safe to retry.
 *
 * Not used for anything that isn't safe to be briefly stale: payments,
 * PRA numbers, and live stock counts are deliberately NOT cached here —
 * see docs/offline-mode.md for exactly what stays online-only and why.
 */

export interface CachedMenu {
  outletId: string;
  categories: MenuCategory[];
  items: MenuItem[];
  currentPrices: Record<string, MenuItemPrice>;
  orderTypePrices: Record<string, Partial<Record<OrderType, MenuItemPrice>>>;
  modifierGroups: ModifierGroup[];
  modifiers: Modifier[];
  itemModifierGroups: Record<string, string[]>;
  cachedAt: string;
}

export interface CachedDay {
  outletId: string;
  business_date: string;
  status: "open" | "closed" | "locked";
  cachedAt: string;
}

export type QueuedOrderStatus = "pending" | "rejected";

export interface QueuedOrder {
  id?: number;
  idempotencyKey: string;
  outletId: string;
  orderType: OrderType;
  items: CartItem[];
  tableId?: string;
  customerId?: string;
  note?: string;
  createdAt: string;
  attempts: number;
  lastError?: string;
  /** "pending" = still waiting to sync; "rejected" = the server actually
   * refused it (not a network problem) — see lib/offline-orders.ts for
   * why a rejected order is kept, visible, and NOT auto-retried, rather
   * than silently discarded or retried forever against the same
   * rejection. */
  status: QueuedOrderStatus;
}

class CupShupOfflineDB extends Dexie {
  menuCache!: Table<CachedMenu, string>;
  dayCache!: Table<CachedDay, string>;
  orderQueue!: Table<QueuedOrder, number>;

  constructor() {
    super("cupshup-offline");
    this.version(1).stores({
      menuCache: "outletId",
      dayCache: "outletId",
      orderQueue: "++id, outletId, idempotencyKey, status, createdAt",
    });
  }
}

// IndexedDB doesn't exist during a server-side render/build — Dexie's
// constructor itself is safe to call either way, but guard the shared
// instance creation so this module can still be imported (types, pure
// helpers) from anywhere without crashing a server context.
export const offlineDb: CupShupOfflineDB =
  typeof window !== "undefined" ? new CupShupOfflineDB() : (null as unknown as CupShupOfflineDB);

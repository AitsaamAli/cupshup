"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { castRows } from "@/lib/supabase/rows";
import type { OrderType } from "@/lib/orders";

// ---------------------------------------------------------------------
// Stations — Part 17. menu_categories.station (0024_kds_schema.sql)
// ---------------------------------------------------------------------

export type Station = "hot_kitchen" | "cold_bar" | "chai_coffee" | "bakery";

export const STATIONS: { value: Station; label: string }[] = [
  { value: "hot_kitchen", label: "Hot Kitchen" },
  { value: "cold_bar", label: "Cold / Bar" },
  { value: "chai_coffee", label: "Chai / Coffee" },
  { value: "bakery", label: "Bakery" },
];

// ---------------------------------------------------------------------
// Ticket age -> colour. Pure, so it's directly testable (tests/kds.test.ts)
// without a live board. 0-5 min neutral, 5-10 amber, 10+ red — exactly
// the brief's own thresholds.
// ---------------------------------------------------------------------

export type TicketAgeLevel = "neutral" | "warning" | "danger";

export function ticketAgeMinutes(createdAtIso: string, now: Date = new Date()): number {
  return (now.getTime() - new Date(createdAtIso).getTime()) / 60000;
}

export function ticketAgeLevel(ageMinutes: number): TicketAgeLevel {
  if (ageMinutes >= 10) return "danger";
  if (ageMinutes >= 5) return "warning";
  return "neutral";
}

// ---------------------------------------------------------------------
// Item/order types for the board
// ---------------------------------------------------------------------

export type OrderItemStatus = "pending" | "preparing" | "ready" | "served" | "voided";

export interface KdsOrderItem {
  id: string;
  order_id: string;
  menu_item_id: string | null;
  name_snapshot: string;
  qty: number;
  modifiers: { modifier_id: string; price_delta_paisa: number; name?: string }[];
  note: string | null;
  status: OrderItemStatus;
  created_at: string;
  ready_at: string | null;
  /** null when the item's menu row (and so its category) no longer
   * resolves — treated as visible on every station rather than hidden
   * from all of them, since the kitchen still has to make it. */
  station: Station | null;
}

export interface KdsTicket {
  id: string;
  order_no: number;
  order_type: OrderType;
  status: "sent_to_kitchen" | "ready";
  table_label: string | null;
  note: string | null;
  created_at: string;
  ready_at: string | null;
  items: KdsOrderItem[];
}

/** Items on a ticket that belong to `station` — or every item when
 * station is null (the "All stations" view). An item with no resolvable
 * station (see KdsOrderItem.station above) is always included. */
export function ticketItemsForStation(items: KdsOrderItem[], station: Station | null): KdsOrderItem[] {
  if (station === null) return items;
  return items.filter((i) => i.station === station || i.station === null);
}

/** Whether a ticket should appear at all on a given station's screen. */
export function ticketMatchesStation(items: KdsOrderItem[], station: Station | null): boolean {
  return ticketItemsForStation(items, station).length > 0;
}

// ---------------------------------------------------------------------
// Live board — Realtime, no polling. Rebuilds ticket/item/station data
// from four flat queries and joins them client-side (same pattern as
// lib/tables.ts and lib/menu.ts), rather than a nested PostgREST select,
// to stay consistent with how every other live hook in this app is built.
// ---------------------------------------------------------------------

export function useKdsTickets(outletId: string) {
  const [tickets, setTickets] = useState<KdsTicket[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    const supabase = createClient();

    const { data: orderRows } = await supabase
      .from("orders")
      .select("id, order_no, order_type, status, table_id, note, created_at, ready_at")
      .eq("outlet_id", outletId)
      .in("status", ["sent_to_kitchen", "ready"])
      .order("created_at", { ascending: true });
    const orders = castRows<{
      id: string;
      order_no: number;
      order_type: OrderType;
      status: "sent_to_kitchen" | "ready";
      table_id: string | null;
      note: string | null;
      created_at: string;
      ready_at: string | null;
    }>(orderRows);

    const orderIds = orders.map((o) => o.id);
    const tableIds = orders.map((o) => o.table_id).filter((id): id is string => !!id);

    const [itemsRes, tablesRes] = await Promise.all([
      orderIds.length
        ? supabase
            .from("order_items")
            .select("id, order_id, menu_item_id, name_snapshot, qty, modifiers, note, status, created_at, ready_at")
            .in("order_id", orderIds)
            .neq("status", "voided")
        : Promise.resolve({ data: [] }),
      tableIds.length
        ? supabase.from("dining_tables").select("id, label").in("id", tableIds)
        : Promise.resolve({ data: [] }),
    ]);

    const items = castRows<Omit<KdsOrderItem, "station">>(itemsRes.data);
    const menuItemIds = items.map((i) => i.menu_item_id).filter((id): id is string => !!id);

    // Two more queries to resolve each item's station via its category —
    // menu_items -> menu_categories.station, same manual-join style as
    // above rather than a nested select.
    let stationByMenuItem = new Map<string, Station>();
    if (menuItemIds.length) {
      const { data: menuItemRows } = await supabase
        .from("menu_items")
        .select("id, category_id")
        .in("id", menuItemIds);
      const categoryByItem = new Map<string, string>();
      castRows<{ id: string; category_id: string }>(menuItemRows).forEach((mi) => {
        categoryByItem.set(mi.id, mi.category_id);
      });
      const categoryIds = [...new Set(categoryByItem.values())];
      if (categoryIds.length) {
        const { data: categoryRows } = await supabase
          .from("menu_categories")
          .select("id, station")
          .in("id", categoryIds);
        const stationByCategory = new Map<string, Station>();
        castRows<{ id: string; station: Station }>(categoryRows).forEach((c) => {
          stationByCategory.set(c.id, c.station);
        });
        stationByMenuItem = new Map(
          [...categoryByItem.entries()]
            .map(([itemId, catId]) => [itemId, stationByCategory.get(catId)])
            .filter((pair): pair is [string, Station] => !!pair[1])
        );
      }
    }

    const tableLabelById = new Map<string, string>();
    castRows<{ id: string; label: string }>(tablesRes.data).forEach((t) => tableLabelById.set(t.id, t.label));

    const itemsByOrder = new Map<string, KdsOrderItem[]>();
    items.forEach((i) => {
      const withStation: KdsOrderItem = {
        ...i,
        station: i.menu_item_id ? (stationByMenuItem.get(i.menu_item_id) ?? null) : null,
      };
      const list = itemsByOrder.get(i.order_id) ?? [];
      list.push(withStation);
      itemsByOrder.set(i.order_id, list);
    });

    setTickets(
      orders.map((o) => ({
        id: o.id,
        order_no: o.order_no,
        order_type: o.order_type,
        status: o.status,
        table_label: o.table_id ? (tableLabelById.get(o.table_id) ?? null) : null,
        note: o.note,
        created_at: o.created_at,
        ready_at: o.ready_at,
        items: itemsByOrder.get(o.id) ?? [],
      }))
    );
    setLoading(false);
  }, [outletId]);

  useEffect(() => {
    reload();
    const supabase = createClient();
    const channel = supabase
      .channel(`kds-${outletId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "orders", filter: `outlet_id=eq.${outletId}` },
        reload
      )
      .on("postgres_changes", { event: "*", schema: "public", table: "order_items" }, reload)
      .subscribe();

    // Realtime's websocket reconnects on its own, but a tab that was
    // asleep or offline can miss changes that happened while it was
    // gone — "internet toot kar jure to khud dobara connect ho, aur jo
    // miss hua wo aa jaye" (brief, §8). A full reload on regaining
    // connectivity or becoming visible again is a simple, reliable way
    // to guarantee nothing stays stale, rather than trusting the
    // channel to have replayed everything it missed.
    const onOnline = () => reload();
    const onVisible = () => {
      if (document.visibilityState === "visible") reload();
    };
    window.addEventListener("online", onOnline);
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      supabase.removeChannel(channel);
      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [outletId, reload]);

  return { tickets, loading, reload };
}

// ---------------------------------------------------------------------
// Writes — all three go through Part 17's SECURITY DEFINER RPCs
// (0025_kds_functions.sql), since order_items/orders direct writes are
// revoked for every authenticated role (0005_rls.sql).
// ---------------------------------------------------------------------

export async function advanceOrderItemStatus(orderItemId: string, newStatus: "preparing" | "ready") {
  const supabase = createClient();
  const { error } = await supabase.rpc("advance_order_item_status", {
    p_order_item_id: orderItemId,
    p_new_status: newStatus,
  });
  if (error) throw new Error(error.message);
}

export async function markTicketItemsReady(orderId: string, station: Station | null) {
  const supabase = createClient();
  const { error } = await supabase.rpc("mark_ticket_items_ready", {
    p_order_id: orderId,
    p_station: station,
  });
  if (error) throw new Error(error.message);
}

export async function recallOrder(orderId: string) {
  const supabase = createClient();
  const { error } = await supabase.rpc("recall_order", { p_order_id: orderId });
  if (error) throw new Error(error.message);
}

/** Reuses Part 08's toggle_86() RPC — chef/kitchen/supervisor/manager/
 * owner only (enforced inside the function itself; a barista tapping
 * this gets the server's PERM error back, same "RLS/RPC is the real
 * gate, UI just asks" pattern as everywhere else in this app). */
export async function toggleItem86(menuItemId: string, is86: boolean) {
  const supabase = createClient();
  const { error } = await supabase.rpc("toggle_86", { p_item_id: menuItemId, p_is_86: is86 });
  if (error) throw new Error(error.message);
}

// ---------------------------------------------------------------------
// Ticket-time report — average time per ticket / station / hour.
// Pure aggregation functions (testable), fed by one fetch.
// ---------------------------------------------------------------------

export interface TicketTimeSample {
  createdAt: string;
  readyAt: string | null;
}

export interface ItemTimeSample extends TicketTimeSample {
  station: Station | null;
}

export function minutesBetween(startIso: string, endIso: string): number {
  return (new Date(endIso).getTime() - new Date(startIso).getTime()) / 60000;
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

export function averageTicketMinutes(samples: TicketTimeSample[]): number | null {
  return average(samples.filter((s) => s.readyAt).map((s) => minutesBetween(s.createdAt, s.readyAt!)));
}

export function averageMinutesByStation(samples: ItemTimeSample[]): Record<Station, number | null> {
  const byStation = new Map<Station, number[]>();
  samples.forEach((s) => {
    if (!s.readyAt || !s.station) return;
    const list = byStation.get(s.station) ?? [];
    list.push(minutesBetween(s.createdAt, s.readyAt));
    byStation.set(s.station, list);
  });
  const result = {} as Record<Station, number | null>;
  STATIONS.forEach(({ value }) => {
    result[value] = average(byStation.get(value) ?? []);
  });
  return result;
}

/** Keyed by hour-of-day (0-23, local time) — lets the report show
 * "8-9pm averages 11 minutes" so staffing can be matched to the rush. */
export function averageMinutesByHour(samples: TicketTimeSample[]): Record<number, number | null> {
  const byHour = new Map<number, number[]>();
  samples.forEach((s) => {
    if (!s.readyAt) return;
    const hour = new Date(s.createdAt).getHours();
    const list = byHour.get(hour) ?? [];
    list.push(minutesBetween(s.createdAt, s.readyAt));
    byHour.set(hour, list);
  });
  const result: Record<number, number | null> = {};
  for (let h = 0; h < 24; h++) result[h] = average(byHour.get(h) ?? []);
  return result;
}

/** Fetches today's (current open business day's) completed tickets and
 * items for the report modal. Returns empty arrays if no day is open —
 * the report has nothing to show before one is, same as the rest of
 * this app's day-scoped screens. */
export async function fetchTicketTimeSamples(
  outletId: string,
  businessDayId: string | null
): Promise<{ tickets: TicketTimeSample[]; items: ItemTimeSample[] }> {
  if (!businessDayId) return { tickets: [], items: [] };
  const supabase = createClient();

  const { data: orderRows } = await supabase
    .from("orders")
    .select("id, created_at, ready_at")
    .eq("outlet_id", outletId)
    .eq("business_day_id", businessDayId)
    .not("ready_at", "is", null);
  const orders = castRows<{ id: string; created_at: string; ready_at: string }>(orderRows);
  const orderIds = orders.map((o) => o.id);

  const { data: itemRows } = orderIds.length
    ? await supabase
        .from("order_items")
        .select("order_id, menu_item_id, created_at, ready_at")
        .in("order_id", orderIds)
        .not("ready_at", "is", null)
    : { data: [] };
  const items = castRows<{ order_id: string; menu_item_id: string | null; created_at: string; ready_at: string }>(
    itemRows
  );

  const menuItemIds = items.map((i) => i.menu_item_id).filter((id): id is string => !!id);
  let stationByMenuItem = new Map<string, Station>();
  if (menuItemIds.length) {
    const { data: menuItemRows } = await supabase.from("menu_items").select("id, category_id").in("id", menuItemIds);
    const categoryByItem = new Map<string, string>();
    castRows<{ id: string; category_id: string }>(menuItemRows).forEach((mi) => categoryByItem.set(mi.id, mi.category_id));
    const categoryIds = [...new Set(categoryByItem.values())];
    if (categoryIds.length) {
      const { data: categoryRows } = await supabase.from("menu_categories").select("id, station").in("id", categoryIds);
      const stationByCategory = new Map<string, Station>();
      castRows<{ id: string; station: Station }>(categoryRows).forEach((c) => stationByCategory.set(c.id, c.station));
      stationByMenuItem = new Map(
        [...categoryByItem.entries()]
          .map(([itemId, catId]) => [itemId, stationByCategory.get(catId)])
          .filter((pair): pair is [string, Station] => !!pair[1])
      );
    }
  }

  return {
    tickets: orders.map((o) => ({ createdAt: o.created_at, readyAt: o.ready_at })),
    items: items.map((i) => ({
      createdAt: i.created_at,
      readyAt: i.ready_at,
      station: i.menu_item_id ? (stationByMenuItem.get(i.menu_item_id) ?? null) : null,
    })),
  };
}

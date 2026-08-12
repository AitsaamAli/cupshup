"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { castRows } from "@/lib/supabase/rows";

export interface DiningTable {
  id: string;
  outlet_id: string;
  label: string;
  seats: number | null;
  zone: string | null;
}

export type TableStatus = "empty" | "running" | "bill_requested";

/** Pure, so it's directly testable (tests/tables.test.ts) rather than
 * only exercisable through the full Realtime-backed hook below. */
export function deriveTableStatus(orderStatus: string | null | undefined): TableStatus {
  if (!orderStatus) return "empty";
  if (orderStatus === "served") return "bill_requested";
  return "running";
}

export interface TableWithStatus extends DiningTable {
  status: TableStatus;
  /** The table's current open order, if any. */
  openOrder: { id: string; order_no: number; status: string } | null;
}

/**
 * Table grid with live status — Part 16. `dining_tables` has no status
 * column of its own; status is derived from whether the table has an
 * order that isn't settled/voided yet:
 *   no open order                       -> empty
 *   sent_to_kitchen / ready             -> running
 *   served (kitchen done, not yet paid) -> bill_requested
 * Kept live via Realtime so the grid updates the instant an order is
 * placed, advanced, or settled from any terminal.
 */
export function useTables(outletId: string) {
  const [tables, setTables] = useState<TableWithStatus[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    const supabase = createClient();
    const [{ data: tableRows }, { data: orderRows }] = await Promise.all([
      supabase.from("dining_tables").select("*").eq("outlet_id", outletId).order("label"),
      supabase
        .from("orders")
        .select("id, order_no, status, table_id")
        .eq("outlet_id", outletId)
        .not("table_id", "is", null)
        .in("status", ["sent_to_kitchen", "ready", "served"]),
    ]);

    const orderByTable = new Map<string, { id: string; order_no: number; status: string }>();
    castRows<{ id: string; order_no: number; status: string; table_id: string }>(orderRows).forEach(
      (o) => {
        orderByTable.set(o.table_id, o);
      }
    );

    const withStatus: TableWithStatus[] = castRows<DiningTable>(tableRows).map((t) => {
      const order = orderByTable.get(t.id) ?? null;
      return { ...t, status: deriveTableStatus(order?.status), openOrder: order };
    });

    setTables(withStatus);
    setLoading(false);
  }, [outletId]);

  useEffect(() => {
    reload();
    const supabase = createClient();
    const channel = supabase
      .channel(`tables-${outletId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "orders" }, reload)
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [outletId, reload]);

  return { tables, loading, reload };
}

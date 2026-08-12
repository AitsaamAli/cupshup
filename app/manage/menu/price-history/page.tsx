"use client";

import { useEffect, useState } from "react";
import { useStaffSession } from "@/lib/auth";
import { createClient } from "@/lib/supabase/client";
import { formatPaisa, type Paisa } from "@/lib/money";

interface PriceRow {
  id: string;
  menu_item_id: string;
  price_paisa: number;
  effective_from: string;
  effective_to: string | null;
  menu_items: { name: string } | null;
}

/**
 * Owner-only price history: every price a menu item has ever had, and
 * the date range each one was actually charged. Matches Part 08's
 * feature table ("Price history dekhna | Owner") and RLS's
 * `manage_prices`/`read_prices` policies (Part 04) — a non-owner landing
 * here directly would still only see what those policies allow, this
 * page just doesn't bother rendering for them.
 */
export default function PriceHistoryPage() {
  const { staff, loading: staffLoading } = useStaffSession("manage");
  const [rows, setRows] = useState<PriceRow[] | null>(null);

  useEffect(() => {
    if (!staff || staff.role !== "owner") return;
    const supabase = createClient();
    supabase
      .from("menu_item_prices")
      .select("id, menu_item_id, price_paisa, effective_from, effective_to, menu_items(name)")
      .order("effective_from", { ascending: false })
      .then(({ data }) => setRows((data as unknown as PriceRow[]) ?? []));
  }, [staff]);

  if (staffLoading) return <p className="p-8 text-neutral-400">Loading…</p>;

  if (!staff || staff.role !== "owner") {
    return <p className="p-8 text-neutral-400">Only the Owner can view price history.</p>;
  }

  return (
    <main className="min-h-screen bg-neutral-950 p-6 text-white">
      <h1 className="mb-6 text-xl font-semibold">Price History</h1>

      {!rows ? (
        <p className="text-neutral-400">Loading…</p>
      ) : (
        <table className="w-full text-left text-sm">
          <thead className="text-neutral-500">
            <tr>
              <th className="pb-2 pr-4">Item</th>
              <th className="pb-2 pr-4">Price</th>
              <th className="pb-2 pr-4">From</th>
              <th className="pb-2 pr-4">To</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-t border-neutral-800">
                <td className="py-2 pr-4">{row.menu_items?.name ?? row.menu_item_id}</td>
                <td className="py-2 pr-4">{formatPaisa(row.price_paisa as Paisa)}</td>
                <td className="py-2 pr-4">{row.effective_from}</td>
                <td className="py-2 pr-4 text-neutral-400">
                  {row.effective_to ?? "current"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}

"use client";

import { useState } from "react";
import { useOnlineStatus } from "@/lib/offline-network";
import { useSyncOfflineOrders, listRejectedOrders } from "@/lib/offline-orders";
import type { QueuedOrder } from "@/lib/offline-db";

/**
 * "Saaf indicator: Offline — 4 orders pending" (brief §1) — the one
 * piece of UI that makes the whole offline design trustworthy. A
 * cashier taking orders with no visible sign of it needs to KNOW the
 * register is running on cached data and queued orders, not find out
 * later when something didn't sync.
 */
export function OfflineIndicator({ outletId }: { outletId: string }) {
  const online = useOnlineStatus();
  const { pendingCount, rejectedCount, syncing, sync, dismissRejected } = useSyncOfflineOrders(outletId);

  if (online && pendingCount === 0 && rejectedCount === 0) return null;

  return (
    <div className="flex items-center gap-2">
      {!online && (
        <span className="rounded-md bg-warning/20 px-2 py-1 text-xs font-medium text-amber-300">
          Offline{pendingCount > 0 ? ` — ${pendingCount} order${pendingCount > 1 ? "s" : ""} pending` : ""}
        </span>
      )}
      {online && pendingCount > 0 && (
        <button
          type="button"
          onClick={sync}
          disabled={syncing}
          className="rounded-md bg-warning/20 px-2 py-1 text-xs font-medium text-amber-300 hover:bg-warning/30"
        >
          {syncing ? "Syncing…" : `${pendingCount} order${pendingCount > 1 ? "s" : ""} syncing`}
        </button>
      )}
      {rejectedCount > 0 && (
        <RejectedOrdersButton count={rejectedCount} outletId={outletId} onDismiss={dismissRejected} />
      )}
    </div>
  );
}

function RejectedOrdersButton({
  count,
  outletId,
  onDismiss,
}: {
  count: number;
  outletId: string;
  onDismiss: (id: number) => void;
}) {
  const [rows, setRows] = useState<QueuedOrder[] | null>(null);

  return (
    <details
      className="relative"
      onToggle={(e) => {
        if ((e.target as HTMLDetailsElement).open) listRejectedOrders(outletId).then(setRows);
      }}
    >
      <summary className="cursor-pointer list-none rounded-md bg-danger/20 px-2 py-1 text-xs font-medium text-red-300 hover:bg-danger/30">
        {count} order{count > 1 ? "s" : ""} couldn&apos;t sync
      </summary>
      <div className="absolute right-0 z-20 mt-1 w-72 rounded-md border border-neutral-800 bg-neutral-900 p-3 text-xs text-neutral-300 shadow-lg">
        <p className="mb-2 text-neutral-400">
          These were rejected by the server (not a connection problem) while offline — a real reason, not
          something retrying will fix. Handle with the customer, then dismiss.
        </p>
        {!rows ? (
          <p className="text-neutral-500">Loading…</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {rows.map((r) => (
              <li key={r.id} className="rounded-md bg-neutral-800 p-2">
                <p className="text-red-300">{r.lastError}</p>
                <p className="mt-1 text-neutral-500">
                  {r.items.length} item(s), {new Date(r.createdAt).toLocaleTimeString()}
                </p>
                <button
                  type="button"
                  onClick={() => {
                    onDismiss(r.id!);
                    setRows((prev) => prev?.filter((x) => x.id !== r.id) ?? null);
                  }}
                  className="mt-1 text-neutral-400 underline hover:text-white"
                >
                  Dismiss
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </details>
  );
}

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
        <span className="rounded-md bg-warning/10 px-2 py-1 text-portal-xs font-medium text-warning">
          Offline{pendingCount > 0 ? ` — ${pendingCount} order${pendingCount > 1 ? "s" : ""} pending` : ""}
        </span>
      )}
      {online && pendingCount > 0 && (
        <button
          type="button"
          onClick={sync}
          disabled={syncing}
          className="rounded-md bg-warning/10 px-2 py-1 text-portal-xs font-medium text-warning hover:bg-warning/20"
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
      <summary className="cursor-pointer list-none rounded-md bg-danger/10 px-2 py-1 text-portal-xs font-medium text-danger hover:bg-danger/20">
        {count} order{count > 1 ? "s" : ""} couldn&apos;t sync
      </summary>
      <div className="absolute right-0 z-20 mt-1 w-72 rounded-lg border border-line bg-surface p-3 text-portal-xs text-ink-700 shadow-[0_4px_12px_rgba(0,0,0,0.08)]">
        <p className="mb-2 text-ink-500">
          These were rejected by the server (not a connection problem) while offline — a real reason, not
          something retrying will fix. Handle with the customer, then dismiss.
        </p>
        {!rows ? (
          <p className="text-ink-500">Loading…</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {rows.map((r) => (
              <li key={r.id} className="rounded-md bg-canvas p-2">
                <p className="text-danger">{r.lastError}</p>
                <p className="mt-1 text-ink-500">
                  {r.items.length} item(s), {new Date(r.createdAt).toLocaleTimeString()}
                </p>
                <button
                  type="button"
                  onClick={() => {
                    onDismiss(r.id!);
                    setRows((prev) => prev?.filter((x) => x.id !== r.id) ?? null);
                  }}
                  className="mt-1 text-ink-500 underline hover:text-ink-900"
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

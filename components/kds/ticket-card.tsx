"use client";

import { useEffect, useState } from "react";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { BanIcon, RecallIcon, PrintIcon } from "@/components/ui/icons";
import { useToast } from "@/components/ui/Toast";
import {
  ticketAgeLevel,
  ticketAgeMinutes,
  ticketItemsForStation,
  type KdsTicket,
  type KdsOrderItem,
  type Station,
} from "@/lib/kds";
import { buildKitchenTicketDoc } from "@/lib/print-templates";
import { printOrQueue } from "@/lib/print-queue";

const AGE_BORDER: Record<ReturnType<typeof ticketAgeLevel>, string> = {
  neutral: "border-neutral-800",
  warning: "border-warning",
  danger: "border-danger",
};

const AGE_TEXT: Record<ReturnType<typeof ticketAgeLevel>, string> = {
  neutral: "text-neutral-400",
  warning: "text-warning",
  danger: "text-danger",
};

const ORDER_TYPE_LABEL: Record<string, string> = {
  dine_in: "Dine-in",
  takeaway: "Takeaway",
  delivery: "Delivery",
};

const ITEM_BADGE: Record<KdsOrderItem["status"], "neutral" | "waiting" | "ready"> = {
  pending: "neutral",
  preparing: "waiting",
  ready: "ready",
  served: "ready",
  voided: "neutral",
};

const NEXT_STATUS: Record<string, "preparing" | "ready" | null> = {
  pending: "preparing",
  preparing: "ready",
  ready: null,
};

export function TicketCard({
  ticket,
  station,
  onAdvanceItem,
  onMarkReady,
  onRecall,
  onToggle86,
}: {
  ticket: KdsTicket;
  station: Station | null;
  onAdvanceItem: (orderItemId: string, next: "preparing" | "ready") => void;
  onMarkReady: () => void;
  onRecall: () => void;
  onToggle86: (menuItemId: string) => void;
}) {
  // Re-renders once a minute so the age colour/timer stays live without
  // a per-ticket interval timer per card — one shared tick is enough.
  const [, forceTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => forceTick((n) => n + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  const { showToast } = useToast();
  const age = ticketAgeMinutes(ticket.created_at);
  const level = ticketAgeLevel(age);
  const visibleItems = ticketItemsForStation(ticket.items, station);
  const allVisibleReady = visibleItems.every((i) => i.status === "ready" || i.status === "served");

  async function handlePrintTicket() {
    const { printed } = await printOrQueue("kitchen", buildKitchenTicketDoc(ticket, station), {
      meta: { station },
    });
    showToast(printed ? "Ticket sent to printer." : "Printer unreachable — queued for retry.", printed ? "success" : "error");
  }

  return (
    <div className={`flex flex-col gap-3 rounded-md border-2 bg-neutral-900 p-4 ${AGE_BORDER[level]}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-2xl font-bold tabular-nums">#{ticket.order_no}</div>
          <div className="text-base text-neutral-300">
            {ORDER_TYPE_LABEL[ticket.order_type] ?? ticket.order_type}
            {ticket.table_label ? ` — ${ticket.table_label}` : ""}
          </div>
        </div>
        <div className="text-right">
          <div className={`text-xl font-bold tabular-nums ${AGE_TEXT[level]}`}>{Math.floor(age)} min</div>
          {ticket.status === "ready" && <StatusBadge status="ready" label="Ready" />}
        </div>
        <button
          type="button"
          onClick={handlePrintTicket}
          title="Print this station's items to the kitchen printer"
          className="flex min-h-16 min-w-16 items-center justify-center rounded-md bg-neutral-800 text-neutral-200 hover:bg-neutral-700"
        >
          <PrintIcon size={24} />
        </button>
      </div>

      {ticket.note && <p className="rounded-md bg-neutral-800 px-3 py-2 text-base text-neutral-200">{ticket.note}</p>}

      <ul className="flex flex-col gap-2">
        {visibleItems.map((item) => {
          const next = NEXT_STATUS[item.status];
          return (
            <li key={item.id} className="flex items-center gap-2 rounded-md bg-neutral-800 p-3">
              <button
                type="button"
                disabled={!next}
                onClick={() => next && onAdvanceItem(item.id, next)}
                className="min-h-16 flex-1 rounded-md text-left disabled:cursor-default"
              >
                <div className="flex items-center gap-2 text-lg font-semibold">
                  <span className="tabular-nums">{item.qty}×</span>
                  <span className={item.status === "ready" ? "line-through opacity-60" : ""}>
                    {item.name_snapshot}
                  </span>
                  <StatusBadge status={ITEM_BADGE[item.status]} />
                </div>
                {item.modifiers.length > 0 && (
                  <div className="mt-1 text-base text-neutral-400">
                    {item.modifiers.map((m) => m.name ?? m.modifier_id).join(", ")}
                  </div>
                )}
                {item.note && <div className="mt-1 text-base text-warning">{item.note}</div>}
              </button>
              {item.menu_item_id && (
                <button
                  type="button"
                  onClick={() => onToggle86(item.menu_item_id!)}
                  title="86 this item — mark it out of stock"
                  className="flex min-h-16 min-w-16 items-center justify-center rounded-md bg-neutral-700 text-danger hover:bg-neutral-600"
                >
                  <BanIcon size={24} />
                </button>
              )}
            </li>
          );
        })}
      </ul>

      <div className="flex gap-2">
        {ticket.status === "sent_to_kitchen" && (
          <button
            type="button"
            disabled={allVisibleReady}
            onClick={onMarkReady}
            className="min-h-16 flex-1 rounded-md bg-brand-600 text-xl font-bold text-white hover:bg-brand-700 disabled:bg-brand-600/30"
          >
            All ready
          </button>
        )}
        {ticket.status === "ready" && (
          <button
            type="button"
            onClick={onRecall}
            className="flex min-h-16 flex-1 items-center justify-center gap-2 rounded-md bg-neutral-700 text-xl font-bold text-neutral-100 hover:bg-neutral-600"
          >
            <RecallIcon size={22} /> Recall
          </button>
        )}
      </div>
    </div>
  );
}

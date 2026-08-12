"use client";

import { useState } from "react";
import { useStaffSession } from "@/lib/auth";
import { useBusinessDay } from "@/lib/business-day";
import {
  useKdsTickets,
  advanceOrderItemStatus,
  markTicketItemsReady,
  recallOrder,
  toggleItem86,
  ticketMatchesStation,
  type Station,
} from "@/lib/kds";
import { isKdsMuted, setKdsMuted, useNewTicketSound } from "@/lib/kds-sound";
import { useToast } from "@/components/ui/Toast";
import { EmptyState } from "@/components/ui/EmptyState";
import { SpeakerIcon, SpeakerMuteIcon } from "@/components/ui/icons";
import { StationTabs } from "@/components/kds/station-tabs";
import { TicketCard } from "@/components/kds/ticket-card";
import { TicketTimeReport } from "@/components/kds/ticket-time-report";

const OUTLET_ID = process.env.NEXT_PUBLIC_SUPABASE_OUTLET_ID!;

/**
 * Kitchen Display System — Part 17. The single biggest functional gap
 * in the old system: chef/kitchen/barista roles could see inventory but
 * never a single order — every ticket travelled by someone shouting it
 * across the kitchen. See docs/kitchen-display.md for the full design
 * writeup (station routing, the "All ready" completion rule, recall,
 * why this screen forces dark mode instead of following the OS theme).
 */
export default function KdsPage() {
  const { staff, loading: staffLoading, lock } = useStaffSession("kds");
  const { day } = useBusinessDay(OUTLET_ID);
  const { tickets, loading: ticketsLoading } = useKdsTickets(OUTLET_ID);
  const { showToast } = useToast();

  const [station, setStation] = useState<Station | null>(null);
  const [muted, setMuted] = useState(() => isKdsMuted());
  const [reportOpen, setReportOpen] = useState(false);

  useNewTicketSound(tickets.map((t) => t.id));

  function toggleMute() {
    const next = !muted;
    setMuted(next);
    setKdsMuted(next);
  }

  async function handleAdvanceItem(orderItemId: string, next: "preparing" | "ready") {
    try {
      await advanceOrderItemStatus(orderItemId, next);
    } catch (err) {
      showToast((err as Error).message, "error");
    }
  }

  async function handleMarkReady(orderId: string) {
    try {
      await markTicketItemsReady(orderId, station);
    } catch (err) {
      showToast((err as Error).message, "error");
    }
  }

  async function handleRecall(orderId: string) {
    try {
      await recallOrder(orderId);
    } catch (err) {
      showToast((err as Error).message, "error");
    }
  }

  async function handleToggle86(menuItemId: string) {
    try {
      await toggleItem86(menuItemId, true);
      showToast("Item 86'd.", "success");
    } catch (err) {
      showToast((err as Error).message, "error");
    }
  }

  if (staffLoading || ticketsLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-neutral-950 text-neutral-400">Loading…</div>
    );
  }

  const visibleTickets = tickets.filter((t) => ticketMatchesStation(t.items, station));

  return (
    // Dark mode is forced here, not left to `prefers-color-scheme` like
    // the rest of the app (globals.css) — this is a dedicated kitchen
    // device, not a screen reflecting whoever's OS theme happens to be
    // set, and the brief calls out dark-by-default as a hard requirement
    // for a screen sitting under bright service lighting.
    <div className="min-h-screen bg-neutral-950 text-lg text-neutral-100">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-neutral-800 px-4 py-3">
        <div>
          <div className="text-2xl font-bold">Kitchen</div>
          <div className="text-base text-neutral-400">
            {staff?.name ?? "—"} · {day?.business_date ?? "no open day"}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={toggleMute}
            aria-label={muted ? "Unmute new-order sound" : "Mute new-order sound"}
            className="flex min-h-16 min-w-16 items-center justify-center rounded-md bg-neutral-800 hover:bg-neutral-700"
          >
            {muted ? <SpeakerMuteIcon size={26} /> : <SpeakerIcon size={26} />}
          </button>
          <button
            type="button"
            onClick={() => setReportOpen(true)}
            className="min-h-16 rounded-md bg-neutral-800 px-5 text-lg font-semibold hover:bg-neutral-700"
          >
            Report
          </button>
          <button
            type="button"
            onClick={lock}
            className="min-h-16 rounded-md bg-neutral-800 px-5 text-lg font-semibold hover:bg-neutral-700"
          >
            Lock
          </button>
        </div>
      </header>

      <div className="px-4 py-3">
        <StationTabs active={station} onChange={setStation} />
      </div>

      <main className="px-4 pb-8">
        {visibleTickets.length === 0 ? (
          <EmptyState message="No tickets right now — new orders show up here the instant they're sent." />
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {visibleTickets.map((ticket) => (
              <TicketCard
                key={ticket.id}
                ticket={ticket}
                station={station}
                onAdvanceItem={handleAdvanceItem}
                onMarkReady={() => handleMarkReady(ticket.id)}
                onRecall={() => handleRecall(ticket.id)}
                onToggle86={handleToggle86}
              />
            ))}
          </div>
        )}
      </main>

      {reportOpen && (
        <TicketTimeReport outletId={OUTLET_ID} businessDayId={day?.id ?? null} onClose={() => setReportOpen(false)} />
      )}
    </div>
  );
}

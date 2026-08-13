"use client";

import { useEffect, useMemo, useState } from "react";
import { useStaffSession } from "@/lib/auth";
import { useBusinessDay } from "@/lib/business-day";
import {
  useKdsTickets,
  advanceOrderItemStatus,
  markTicketItemsReady,
  recallOrder,
  toggleItem86,
  ticketMatchesStation,
  allDayCounts,
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

  const visibleTickets = useMemo(
    () => tickets.filter((t) => ticketMatchesStation(t.items, station)),
    [tickets, station]
  );
  const dayCounts = useMemo(() => allDayCounts(tickets, station), [tickets, station]);

  // Bump bar (Toast KDS benchmark) — 1-9 on a physical keyboard bumps the
  // ticket in that grid position straight to "All ready", the same
  // action as tapping its own button. Digits are the SAME convention
  // POS already uses for "pick item N", so kitchen staff who also work
  // the register get one consistent keyboard language across screens.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (!/^[1-9]$/.test(e.key)) return;
      const ticket = visibleTickets[Number(e.key) - 1];
      if (ticket && ticket.status === "sent_to_kitchen") {
        e.preventDefault();
        handleMarkReady(ticket.id);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleTickets, station]);

  if (staffLoading || ticketsLoading) {
    return (
      <div data-mode="kds" className="flex min-h-screen items-center justify-center bg-canvas text-ink-500">
        Loading…
      </div>
    );
  }

  return (
    // Dark mode is forced here via data-mode="kds" (app/globals.css), not
    // left to `prefers-color-scheme` like the rest of the app — this is a
    // dedicated kitchen device, not a screen reflecting whoever's OS theme
    // happens to be set, and the design direction calls out dark-by-default
    // as a hard requirement for a screen sitting under bright service
    // lighting. Every token below (bg-canvas, text-ink-*, border-line, ...)
    // resolves to its dark KDS value automatically because it's a CSS
    // descendant of this attribute — no separate dark component variants
    // needed anywhere in this tree, including inside <Modal>.
    <div data-mode="kds" className="min-h-screen bg-canvas text-kds-sm text-ink-900">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
        <div>
          <div className="text-kds-xl font-bold text-ink-900">Kitchen</div>
          <div className="text-kds-sm text-ink-500">
            {staff?.name ?? "—"} · {day?.business_date ?? "no open day"}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={toggleMute}
            aria-label={muted ? "Unmute new-order sound" : "Mute new-order sound"}
            className="flex min-h-16 min-w-16 items-center justify-center rounded-md bg-surface text-ink-700 hover:bg-line"
          >
            {muted ? <SpeakerMuteIcon size={26} /> : <SpeakerIcon size={26} />}
          </button>
          <button
            type="button"
            onClick={() => setReportOpen(true)}
            className="min-h-16 rounded-md bg-surface px-5 text-kds-sm font-semibold text-ink-700 hover:bg-line"
          >
            Report
          </button>
          <button
            type="button"
            onClick={lock}
            className="min-h-16 rounded-md bg-surface px-5 text-kds-sm font-semibold text-ink-700 hover:bg-line"
          >
            Lock
          </button>
        </div>
      </header>

      <div className="px-4 py-3">
        <StationTabs active={station} onChange={setStation} />
      </div>

      {dayCounts.length > 0 && (
        <div className="flex flex-wrap gap-2 border-b border-line px-4 pb-3">
          {dayCounts.map((c) => (
            <span key={c.name} className="rounded-md bg-surface px-3 py-1.5 text-kds-sm text-ink-700">
              <span className="font-bold tabular-nums text-ink-900">{c.qty}</span> {c.name}
            </span>
          ))}
        </div>
      )}

      <main className="px-4 pb-8 pt-4">
        {visibleTickets.length === 0 ? (
          <EmptyState message="No tickets right now — new orders show up here the instant they're sent." />
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {visibleTickets.map((ticket, i) => (
              <TicketCard
                key={ticket.id}
                ticket={ticket}
                station={station}
                bumpKey={i < 9 ? String(i + 1) : undefined}
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

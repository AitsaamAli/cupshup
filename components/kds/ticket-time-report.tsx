"use client";

import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import {
  STATIONS,
  averageMinutesByHour,
  averageMinutesByStation,
  averageTicketMinutes,
  fetchTicketTimeSamples,
} from "@/lib/kds";

function fmt(minutes: number | null): string {
  return minutes === null ? "—" : `${minutes.toFixed(1)} min`;
}

/**
 * Average ticket time report — Part 17. Scoped to the currently open
 * business day, same window every other day-scoped screen in this app
 * uses. Tells the owner/manager which stations run slow and which hours
 * need more hands — nothing here is a live operational control, so it's
 * readable by whoever's staffing the KDS, matching orders/order_items'
 * existing outlet-wide read policy (Part 04) rather than adding a new
 * owner-only gate for it.
 */
export function TicketTimeReport({
  outletId,
  businessDayId,
  onClose,
}: {
  outletId: string;
  businessDayId: string | null;
  onClose: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [avgTicket, setAvgTicket] = useState<number | null>(null);
  const [byStation, setByStation] = useState<Record<string, number | null>>({});
  const [byHour, setByHour] = useState<Record<number, number | null>>({});

  useEffect(() => {
    let mounted = true;
    fetchTicketTimeSamples(outletId, businessDayId).then(({ tickets, items }) => {
      if (!mounted) return;
      setAvgTicket(averageTicketMinutes(tickets));
      setByStation(averageMinutesByStation(items));
      setByHour(averageMinutesByHour(tickets));
      setLoading(false);
    });
    return () => {
      mounted = false;
    };
  }, [outletId, businessDayId]);

  const hoursWithData = Object.entries(byHour)
    .filter(([, v]) => v !== null)
    .map(([h, v]) => ({ hour: Number(h), minutes: v as number }))
    .sort((a, b) => a.hour - b.hour);

  return (
    <Modal title="Ticket time — today" onClose={onClose}>
      {loading ? (
        <p className="text-sm text-neutral-400">Loading…</p>
      ) : (
        <div className="flex flex-col gap-4 text-sm">
          <div>
            <div className="text-neutral-400">Average ticket time</div>
            <div className="text-2xl font-bold tabular-nums">{fmt(avgTicket)}</div>
          </div>

          <div>
            <div className="mb-1 text-neutral-400">By station</div>
            <ul className="flex flex-col gap-1">
              {STATIONS.map((s) => (
                <li key={s.value} className="flex justify-between">
                  <span>{s.label}</span>
                  <span className="tabular-nums">{fmt(byStation[s.value] ?? null)}</span>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <div className="mb-1 text-neutral-400">By hour</div>
            {hoursWithData.length === 0 ? (
              <p className="text-neutral-500">No completed tickets yet today.</p>
            ) : (
              <ul className="flex flex-col gap-1">
                {hoursWithData.map(({ hour, minutes }) => (
                  <li key={hour} className="flex justify-between">
                    <span className="tabular-nums">
                      {String(hour).padStart(2, "0")}:00–{String((hour + 1) % 24).padStart(2, "0")}:00
                    </span>
                    <span className="tabular-nums">{fmt(minutes)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}

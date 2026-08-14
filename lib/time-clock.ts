"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

export interface AttendanceRow {
  id: string;
  outlet_id: string;
  staff_id: string;
  business_date: string;
  clock_in: string;
  clock_out: string | null;
  break_minutes: number;
  approved_by: string | null;
  created_at: string;
}

/**
 * The current staff member's own OPEN shift, if any — Patch 2 (Staff
 * Time Clock). Reads the row directly (RLS-scoped to the caller's own
 * outlet, same as every other read in this app); clock_in()/clock_out()
 * themselves are the only way to write it (0049's own revoke on direct
 * table writes).
 */
export function useMyAttendance(staffId: string | undefined) {
  const [open, setOpen] = useState<AttendanceRow | null>(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    if (!staffId) {
      setOpen(null);
      setLoading(false);
      return;
    }
    const supabase = createClient();
    const { data } = await supabase
      .from("attendance")
      .select("*")
      .eq("staff_id", staffId)
      .is("clock_out", null)
      .maybeSingle();
    setOpen((data as AttendanceRow | null) ?? null);
    setLoading(false);
  }, [staffId]);

  useEffect(() => {
    reload();
  }, [reload]);

  return { open, loading, reload };
}

export async function clockIn(): Promise<AttendanceRow> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("clock_in");
  if (error) throw new Error(error.message);
  return data as AttendanceRow;
}

export async function clockOut(breakMinutes = 0): Promise<AttendanceRow> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("clock_out", { p_break_minutes: breakMinutes });
  if (error) throw new Error(error.message);
  return data as AttendanceRow;
}

/** "2h 14m" — for the header's live elapsed-time display. */
export function formatElapsed(clockInIso: string, now: Date): string {
  const ms = Math.max(0, now.getTime() - new Date(clockInIso).getTime());
  const totalMinutes = Math.floor(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}h ${minutes}m`;
}

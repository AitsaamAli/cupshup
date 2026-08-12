"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

/** Mirrors the `staff_role` enum from 0001_schema.sql. */
export type StaffRole =
  | "owner"
  | "manager"
  | "supervisor"
  | "cashier"
  | "chef"
  | "kitchen"
  | "barista";

export interface StaffSession {
  id: string;
  name: string;
  role: StaffRole;
}

/** Which screen is asking — decides the idle-timeout duration. */
export type Screen = "pos" | "pl" | "kds" | "manage";

const IDLE_TIMEOUT_MS: Record<Screen, number> = {
  pos: 15 * 60 * 1000, // POS: 15 minutes idle -> PIN again
  pl: 5 * 60 * 1000, // Master P&L: 5 minutes idle -> PIN again, every time
  kds: Number.POSITIVE_INFINITY, // KDS: no timeout — the kitchen screen stays open
  // Back-office screens (menu, inventory, expenses, ...) weren't named in
  // Part 07's session table — 10 minutes is a deliberate middle ground
  // between POS and P&L until Part 15 settles the full screen inventory.
  manage: 10 * 60 * 1000,
};

const DEFAULT_ROUTE_FOR_ROLE: Record<StaffRole, string> = {
  owner: "/reports/dashboard",
  manager: "/reports/dashboard",
  supervisor: "/pos",
  cashier: "/pos",
  chef: "/kds",
  kitchen: "/kds",
  barista: "/kds",
};

/** Where a role lands right after login. Used by the login page, and by
 * any screen that needs to bounce a staff member somewhere sensible. */
export function defaultRouteForRole(role: StaffRole): string {
  return DEFAULT_ROUTE_FOR_ROLE[role] ?? "/login";
}

/**
 * Tracks the currently PIN-authenticated staff member for a given screen,
 * and enforces that screen's idle timeout by signing out and redirecting
 * to /login. There is no `masterAuthed`-style permanent unlock anywhere in
 * this app — every timeout re-locks, no exceptions, and Master P&L
 * re-locks faster than anything else on purpose (Part 07, Section 4).
 *
 * This hook does NOT enforce who is ALLOWED on a screen — that's Row
 * Level Security (Part 04), which still applies underneath regardless of
 * what this hook or the UI does. This hook only handles session display
 * and idle-timeout UX.
 */
export function useStaffSession(screen: Screen) {
  const [staff, setStaff] = useState<StaffSession | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const lock = useCallback(async () => {
    const supabase = createClient();
    // Best-effort audit trail; a failed logout write should never block
    // the actual sign-out from happening.
    try {
      await supabase.rpc("log_staff_logout");
    } catch {
      // ignore — signing out below must still proceed
    }
    await supabase.auth.signOut();
    setStaff(null);
    router.push("/login");
  }, [router]);

  const resetIdleTimer = useCallback(() => {
    if (idleTimer.current) clearTimeout(idleTimer.current);
    const timeout = IDLE_TIMEOUT_MS[screen];
    if (!Number.isFinite(timeout)) return; // KDS: no timeout, nothing to schedule
    idleTimer.current = setTimeout(lock, timeout);
  }, [screen, lock]);

  // Load the current staff member once on mount.
  useEffect(() => {
    let mounted = true;
    const supabase = createClient();

    supabase.auth.getUser().then(async ({ data }) => {
      if (!data.user) {
        if (mounted) {
          setLoading(false);
          router.push("/login");
        }
        return;
      }

      const { data: staffRow } = await supabase
        .from("staff")
        .select("id, name, role")
        .eq("user_id", data.user.id)
        .single();

      if (mounted) {
        setStaff((staffRow as StaffSession) ?? null);
        setLoading(false);
        if (!staffRow) router.push("/login");
      }
    });

    return () => {
      mounted = false;
    };
  }, [router]);

  // Reset the idle timer on any real interaction; lock when it fires.
  useEffect(() => {
    resetIdleTimer();
    const events: (keyof WindowEventMap)[] = ["mousedown", "keydown", "touchstart", "scroll"];
    events.forEach((e) => window.addEventListener(e, resetIdleTimer));
    return () => {
      events.forEach((e) => window.removeEventListener(e, resetIdleTimer));
      if (idleTimer.current) clearTimeout(idleTimer.current);
    };
  }, [resetIdleTimer]);

  return { staff, loading, lock };
}

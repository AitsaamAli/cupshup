import { describe, it, expect } from "vitest";
import { formatElapsed } from "../lib/time-clock";

/**
 * Patch 2 (staff time clock). Pure formatting only — the actual
 * clock_in()/clock_out() logic (including the credit/break validation)
 * is exercised server-side by supabase/tests/database/staff_time_clock.sql,
 * same split every other RPC-backed feature in this app already uses.
 */
describe("formatElapsed — header's live clocked-in display", () => {
  it("0 minutes right after clocking in", () => {
    const clockIn = "2026-08-13T12:00:00+05:00";
    const now = new Date("2026-08-13T12:00:00+05:00");
    expect(formatElapsed(clockIn, now)).toBe("0h 0m");
  });

  it("1h 30m into a shift", () => {
    const clockIn = "2026-08-13T12:00:00+05:00";
    const now = new Date("2026-08-13T13:30:00+05:00");
    expect(formatElapsed(clockIn, now)).toBe("1h 30m");
  });

  it("just under an hour rounds down to whole minutes, not up", () => {
    const clockIn = "2026-08-13T12:00:00+05:00";
    const now = new Date("2026-08-13T12:59:59+05:00");
    expect(formatElapsed(clockIn, now)).toBe("0h 59m");
  });

  it("a shift spanning past midnight into double-digit hours", () => {
    const clockIn = "2026-08-13T15:00:00+05:00";
    const now = new Date("2026-08-14T01:15:00+05:00");
    expect(formatElapsed(clockIn, now)).toBe("10h 15m");
  });

  it("never goes negative if `now` is somehow before clock-in", () => {
    const clockIn = "2026-08-13T12:00:00+05:00";
    const now = new Date("2026-08-13T11:00:00+05:00");
    expect(formatElapsed(clockIn, now)).toBe("0h 0m");
  });
});

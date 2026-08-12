import { describe, it, expect } from "vitest";
import { businessDateOf } from "../lib/business-date";

/**
 * These cases mirror the ones worked through by hand in
 * 06-money-and-calculation-rules.md and supabase/migrations/
 * 0002_business_date_function.sql — the TypeScript and SQL
 * implementations must agree on every one of them.
 *
 * All timestamps are written with an explicit +05:00 offset (Pakistan
 * Standard Time) so the test never depends on the machine's local
 * timezone — that dependency is exactly what caused the original bug.
 */
describe("businessDateOf — trading day is 3pm to 3am, Asia/Karachi", () => {
  it("3:00 PM exactly — the moment the day opens", () => {
    expect(businessDateOf("2026-08-11T15:00:00+05:00")).toBe("2026-08-11");
  });

  it("8:00 PM — normal evening trade", () => {
    expect(businessDateOf("2026-08-11T20:00:00+05:00")).toBe("2026-08-11");
  });

  it("11:59 PM — just before midnight", () => {
    expect(businessDateOf("2026-08-11T23:59:00+05:00")).toBe("2026-08-11");
  });

  it("12:01 AM — just after midnight, still the same trading day", () => {
    expect(businessDateOf("2026-08-12T00:01:00+05:00")).toBe("2026-08-11");
  });

  it("2:00 AM — the headline bug: must NOT roll back two calendar days", () => {
    expect(businessDateOf("2026-08-12T02:00:00+05:00")).toBe("2026-08-11");
  });

  it("2:59 AM — just before the (closed-hours) 3am mark", () => {
    expect(businessDateOf("2026-08-12T02:59:00+05:00")).toBe("2026-08-11");
  });

  it("3:01 AM — still labelled the prior trading day (the day only flips at 3pm)", () => {
    expect(businessDateOf("2026-08-12T03:01:00+05:00")).toBe("2026-08-11");
  });

  it("2:00 PM — one hour before opening, still yesterday's trading day", () => {
    expect(businessDateOf("2026-08-11T14:00:00+05:00")).toBe("2026-08-10");
  });

  it("2:59:59 PM — one second before opening", () => {
    expect(businessDateOf("2026-08-11T14:59:59+05:00")).toBe("2026-08-10");
  });

  it("uses Asia/Karachi and start_hour=15 by default when not specified", () => {
    // Same instant as the 2am case above, expressed in UTC, with no
    // tz/startHour arguments passed — defaults must produce the same result.
    expect(businessDateOf("2026-08-11T21:00:00.000Z")).toBe("2026-08-11");
  });

  it("throws on an invalid timestamp instead of silently returning a wrong date", () => {
    expect(() => businessDateOf("not-a-real-date")).toThrow();
  });

  it("is DST-safe: with start_hour=0, matches the plain calendar date across a DST spring-forward", () => {
    // 2026-03-08 is the US spring-forward date (clocks jump 2am -> 3am,
    // America/New_York). With start_hour=0 the "business date" should
    // just equal the ordinary calendar date in that zone.
    const ts = "2026-03-08T07:30:00.000Z";
    const tz = "America/New_York";
    const expected = new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(
      new Date(ts)
    );
    expect(businessDateOf(ts, tz, 0)).toBe(expected);
  });

  it("is DST-safe: does not throw or misbehave across a DST fall-back transition", () => {
    const ts = "2026-11-01T06:30:00.000Z"; // around the US fall-back date
    expect(() => businessDateOf(ts, "America/New_York", 15)).not.toThrow();
    expect(businessDateOf(ts, "America/New_York", 15)).toMatch(
      /^\d{4}-\d{2}-\d{2}$/
    );
  });

  it("accepts a Date object as well as a string", () => {
    const d = new Date("2026-08-12T02:00:00+05:00");
    expect(businessDateOf(d)).toBe("2026-08-11");
  });
});

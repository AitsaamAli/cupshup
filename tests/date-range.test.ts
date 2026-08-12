import { describe, it, expect } from "vitest";
import { todayIso, daysAgoIso, startOfMonthIso } from "../lib/date-range";

describe("date-range helpers — local calendar date, not UTC", () => {
  it("todayIso reads local date parts, not toISOString's UTC date", () => {
    // 00:30 local time on the 12th — toISOString() on a UTC+5 clock would
    // report this instant as the 11th (19:30 UTC the day before). This
    // is exactly the bug the module exists to avoid for a cafe open past
    // midnight.
    const localMidnightPlus30 = new Date(2026, 7, 12, 0, 30); // month is 0-indexed: 7 = August
    expect(todayIso(localMidnightPlus30)).toBe("2026-08-12");
  });

  it("daysAgoIso subtracts calendar days", () => {
    expect(daysAgoIso(7, new Date(2026, 7, 12))).toBe("2026-08-05");
  });

  it("daysAgoIso crosses a month boundary correctly", () => {
    expect(daysAgoIso(5, new Date(2026, 7, 2))).toBe("2026-07-28");
  });

  it("startOfMonthIso returns the 1st of the given date's month", () => {
    expect(startOfMonthIso(new Date(2026, 7, 27))).toBe("2026-08-01");
  });
});

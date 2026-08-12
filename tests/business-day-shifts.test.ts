import { describe, it, expect, vi, beforeEach } from "vitest";

const rpcMock = vi.fn();
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ rpc: rpcMock }),
}));

const {
  openBusinessDay,
  closeBusinessDay,
  openShift,
  closeShift,
  recordCashMovement,
  previewExpectedCash,
} = await import("../lib/business-day");

describe("previewExpectedCash — matches close_shift()/close_business_day()'s formula", () => {
  it("opening float + cash sales + paid in - cash expenses - drops", () => {
    // Rs 5,000 float + Rs 20,000 cash sales + Rs 1,000 paid in
    // - Rs 2,000 cash expenses - Rs 3,000 dropped to the safe = Rs 21,000
    expect(previewExpectedCash(500000, 2000000, 100000, 200000, 300000)).toBe(2100000);
  });

  it("a shift with no activity beyond its float expects exactly the float back", () => {
    expect(previewExpectedCash(500000, 0, 0, 0, 0)).toBe(500000);
  });
});

describe("openBusinessDay / closeBusinessDay", () => {
  beforeEach(() => rpcMock.mockReset());

  it("opens with the right shape", async () => {
    rpcMock.mockResolvedValue({ data: {}, error: null });
    await openBusinessDay("outlet-1", 500000);
    expect(rpcMock).toHaveBeenCalledWith("open_business_day", {
      p_outlet: "outlet-1",
      p_opening_float_paisa: 500000,
    });
  });

  it("closes with the right shape and returns the snapshot", async () => {
    const snapshot = { variance_paisa: -500 };
    rpcMock.mockResolvedValue({ data: snapshot, error: null });
    const result = await closeBusinessDay("day-1", 2100000);
    expect(rpcMock).toHaveBeenCalledWith("close_business_day", {
      p_business_day_id: "day-1",
      p_counted_cash_paisa: 2100000,
    });
    expect(result).toEqual(snapshot);
  });

  it("open_business_day surfaces a closed-day error instead of silently succeeding", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "DAY: 2026-08-12 is already closed" } });
    await expect(openBusinessDay("outlet-1", 500000)).rejects.toThrow("already closed");
  });
});

describe("openShift / closeShift", () => {
  beforeEach(() => rpcMock.mockReset());

  it("opens a shift with the right shape", async () => {
    rpcMock.mockResolvedValue({ data: {}, error: null });
    await openShift(500000, "terminal-1");
    expect(rpcMock).toHaveBeenCalledWith("open_shift", {
      p_terminal_id: "terminal-1",
      p_opening_float_paisa: 500000,
    });
  });

  it("rejects a second open shift for the same cashier", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "SHIFT: you already have an open shift" } });
    await expect(openShift(500000)).rejects.toThrow("already have an open shift");
  });

  it("closes a shift with the right shape", async () => {
    rpcMock.mockResolvedValue({ data: {}, error: null });
    await closeShift("shift-1", 2100000);
    expect(rpcMock).toHaveBeenCalledWith("close_shift", {
      p_shift_id: "shift-1",
      p_counted_cash_paisa: 2100000,
    });
  });
});

describe("recordCashMovement", () => {
  beforeEach(() => rpcMock.mockReset());

  it("sends the right shape for a drop", async () => {
    rpcMock.mockResolvedValue({ data: {}, error: null });
    await recordCashMovement("shift-1", "drop", 300000, "end of rush safe drop");
    expect(rpcMock).toHaveBeenCalledWith("record_cash_movement", {
      p_shift_id: "shift-1",
      p_type: "drop",
      p_amount_paisa: 300000,
      p_reason: "end of rush safe drop",
    });
  });
});

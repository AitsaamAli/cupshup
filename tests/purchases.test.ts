import { describe, it, expect, vi, beforeEach } from "vitest";

const rpcMock = vi.fn();
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ rpc: rpcMock }),
}));

const { recordPurchaseGrn, recordPurchaseReturn, upsertSupplier, previewWeightedAvgCost } =
  await import("../lib/purchases");

describe("previewWeightedAvgCost — the worked example from the Part 12 brief", () => {
  it("10kg @ Rs 800 on hand, buy 10kg @ Rs 900 -> new average is exactly Rs 850", () => {
    // amounts in paisa: Rs 800 = 80000, Rs 900 = 90000, expect Rs 850 = 85000
    expect(previewWeightedAvgCost(10, 80000, 10, 90000)).toBe(85000);
  });

  it("nothing on hand yet -> the new cost simply becomes the average", () => {
    expect(previewWeightedAvgCost(0, 0, 5, 120000)).toBe(120000);
  });

  it("rounds half up when the blend isn't a whole paisa", () => {
    // (3 * 100 + 1 * 101) / 4 = 401/4 = 100.25 -> 100
    expect(previewWeightedAvgCost(3, 100, 1, 101)).toBe(100);
  });
});

describe("recordPurchaseGrn", () => {
  beforeEach(() => rpcMock.mockReset());

  it("sends lines with ingredient_id/qty/unit_cost_paisa — never a pre-computed average", async () => {
    rpcMock.mockResolvedValue({ data: { id: "p1", total_paisa: 850000 }, error: null });
    await recordPurchaseGrn("supplier-1", [
      { ingredient_id: "ing-1", qty: 10, unit_cost_paisa: 90000 },
    ]);
    const args = rpcMock.mock.calls[0][1];
    expect(args.p_lines).toEqual([{ ingredient_id: "ing-1", qty: 10, unit_cost_paisa: 90000 }]);
    expect(args).not.toHaveProperty("p_moving_avg_cost_paisa");
  });

  it("defaults payment_status to credit and amount_paid to 0", async () => {
    rpcMock.mockResolvedValue({ data: {}, error: null });
    await recordPurchaseGrn("supplier-1", [{ ingredient_id: "ing-1", qty: 1, unit_cost_paisa: 1000 }]);
    const args = rpcMock.mock.calls[0][1];
    expect(args.p_payment_status).toBe("credit");
    expect(args.p_amount_paid_paisa).toBe(0);
  });

  it("throws a plain Error on failure (e.g. an unknown ingredient)", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "INGREDIENT: not found" } });
    await expect(
      recordPurchaseGrn("supplier-1", [{ ingredient_id: "bad", qty: 1, unit_cost_paisa: 1000 }])
    ).rejects.toThrow("INGREDIENT: not found");
  });
});

describe("recordPurchaseReturn", () => {
  beforeEach(() => rpcMock.mockReset());

  it("calls record_purchase_return with the right shape", async () => {
    rpcMock.mockResolvedValue({ data: {}, error: null });
    await recordPurchaseReturn("purchase-1", "ing-1", 2, "damaged");
    expect(rpcMock).toHaveBeenCalledWith("record_purchase_return", {
      p_purchase_id: "purchase-1",
      p_ingredient_id: "ing-1",
      p_qty: 2,
      p_reason: "damaged",
    });
  });
});

describe("upsertSupplier", () => {
  beforeEach(() => rpcMock.mockReset());

  it("passes null id for a new supplier", async () => {
    rpcMock.mockResolvedValue({ data: "new-id", error: null });
    await upsertSupplier(null, "Metro Cash & Carry", { phone: "0300...", terms: "Net 15" });
    expect(rpcMock).toHaveBeenCalledWith("upsert_supplier", {
      p_id: null,
      p_name: "Metro Cash & Carry",
      p_phone: "0300...",
      p_terms: "Net 15",
    });
  });
});

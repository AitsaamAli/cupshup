import { describe, it, expect, vi, beforeEach } from "vitest";

const rpcMock = vi.fn();
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ rpc: rpcMock }),
}));

const {
  requiredApprovalRole,
  previewAmortizedDailyAmount,
  recordExpense,
  approveExpense,
  summarizeByCategory,
  summarizeByVendor,
  summarizeCashVsNonCash,
} = await import("../lib/expenses");

describe("requiredApprovalRole — the threshold table from the Part 14 brief", () => {
  it("under Rs 5,000 needs no approval", () => {
    expect(requiredApprovalRole(499999)).toBe("supervisor");
  });

  it("Rs 5,000 to Rs 25,000 needs a manager", () => {
    expect(requiredApprovalRole(500000)).toBe("manager"); // exactly Rs 5,000
    expect(requiredApprovalRole(2500000)).toBe("manager"); // exactly Rs 25,000
  });

  it("over Rs 25,000 needs the owner", () => {
    expect(requiredApprovalRole(2500001)).toBe("owner");
  });
});

describe("previewAmortizedDailyAmount — the brief's own worked example, and the rounding bug found by testing it live", () => {
  it("Rs 200,000 monthly rent over 31 days (a real August) lands around Rs 6,667/day and reconciles exactly", () => {
    const total = 20000000; // Rs 200,000 in paisa
    const days = 31;
    let sum = 0;
    for (let i = 0; i < days; i++) {
      const day = previewAmortizedDailyAmount(total, "monthly", i, days);
      sum += day;
      if (i < days - 1) {
        // every non-last day should be the plain rounded per-day share
        expect(day).toBe(Math.round(total / days));
      }
    }
    // This is the exact bug caught by live-testing 0021_expense_amortization_view.sql
    // against a real 31-day row: rounding each day independently landed on
    // 19999991, nine paisa short of 20000000, before the last-day-absorbs-
    // the-remainder fix. Must reconcile exactly now.
    expect(sum).toBe(total);
  });

  it("an immediate expense is the full amount on its one day, not divided", () => {
    expect(previewAmortizedDailyAmount(50000, "immediate", 0, 1)).toBe(50000);
  });

  it("a 30-day month matches the brief's own round-number example (200,000 / 30 = 6,667)", () => {
    const total = 20000000;
    const perDay = previewAmortizedDailyAmount(total, "monthly", 0, 30);
    expect(perDay).toBe(666667); // Rs 6,666.67 -> rounds to 666667 paisa
  });
});

describe("recordExpense / approveExpense", () => {
  beforeEach(() => rpcMock.mockReset());

  it("sends the right shape, defaulting optional fields to null", async () => {
    rpcMock.mockResolvedValue({ data: {}, error: null });
    await recordExpense({ categoryId: "cat-1", amountPaisa: 300000, paymentMethod: "cash" });
    expect(rpcMock).toHaveBeenCalledWith("record_expense", {
      p_category_id: "cat-1",
      p_amount_paisa: 300000,
      p_payment_method: "cash",
      p_vendor: null,
      p_note: null,
      p_receipt_url: null,
      p_period_start: null,
      p_period_end: null,
    });
  });

  it("throws a plain Error when the approval-tier entry gate rejects it", async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: { message: "PERM: expenses over Rs 25,000 must be entered by a manager or owner" },
    });
    await expect(
      recordExpense({ categoryId: "cat-1", amountPaisa: 3000000, paymentMethod: "cash" })
    ).rejects.toThrow("must be entered by a manager or owner");
  });

  it("approveExpense calls approve_expense with the expense id", async () => {
    rpcMock.mockResolvedValue({ data: null, error: null });
    await approveExpense("exp-1");
    expect(rpcMock).toHaveBeenCalledWith("approve_expense", { p_expense_id: "exp-1" });
  });
});

describe("report summaries", () => {
  const categories = [
    { id: "c1", outlet_id: "o1", name: "Rent", accrual_type: "monthly" as const, color: null },
    { id: "c2", outlet_id: "o1", name: "Supplies", accrual_type: "immediate" as const, color: null },
  ];
  const expenses = [
    { id: "e1", category_id: "c1", amount_paisa: 200000, payment_method: "cash", vendor: "Landlord" },
    { id: "e2", category_id: "c2", amount_paisa: 50000, payment_method: "card", vendor: "Metro" },
    { id: "e3", category_id: "c2", amount_paisa: 30000, payment_method: "cash", vendor: "Metro" },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ] as any[];

  it("summarizes by category, largest first", () => {
    expect(summarizeByCategory(expenses, categories)).toEqual([
      { categoryId: "c1", categoryName: "Rent", totalPaisa: 200000 },
      { categoryId: "c2", categoryName: "Supplies", totalPaisa: 80000 },
    ]);
  });

  it("summarizes by vendor, largest first", () => {
    expect(summarizeByVendor(expenses)).toEqual([
      { vendor: "Landlord", totalPaisa: 200000 },
      { vendor: "Metro", totalPaisa: 80000 },
    ]);
  });

  it("splits cash vs non-cash correctly", () => {
    expect(summarizeCashVsNonCash(expenses)).toEqual({ cashPaisa: 230000, nonCashPaisa: 50000 });
  });
});

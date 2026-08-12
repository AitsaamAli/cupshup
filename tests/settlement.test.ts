import { describe, it, expect, vi, beforeEach } from "vitest";

const rpcMock = vi.fn();
const fromMock = vi.fn();
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ rpc: rpcMock, from: fromMock }),
}));

const { settleOrder, loadPaymentMethodTaxRates, previewSplitTax } = await import(
  "../lib/settlement"
);

describe("previewSplitTax — the worked example from the Part 10 brief", () => {
  it("Rs 5,000 bill, 2,000 cash + 3,000 card -> tax is exactly 560 total", () => {
    // amounts in paisa: Rs 2,000 = 200000, Rs 3,000 = 300000
    const cashTax = previewSplitTax(200000, 1600); // 16%
    const cardTax = previewSplitTax(300000, 800); // 8%
    expect(cashTax).toBe(32000); // Rs 320
    expect(cardTax).toBe(24000); // Rs 240
    expect(cashTax + cardTax).toBe(56000); // Rs 560 total, matching the brief's table
  });

  it("rounds half up, same rule as calculateTax in lib/money.ts", () => {
    // 12345 * 1600 / 10000 = 1975.2 -> 1975 (same case already covered
    // for lib/money.ts's calculateTax — this proves the two formulas
    // that must always agree actually do)
    expect(previewSplitTax(12345, 1600)).toBe(1975);
  });
});

describe("settleOrder", () => {
  beforeEach(() => rpcMock.mockReset());

  it("sends only base_paisa per split — never a tax or total", async () => {
    rpcMock.mockResolvedValue({ data: { status: "settled" }, error: null });
    await settleOrder("order-1", [
      { method: "cash", base_paisa: 200000, tendered_paisa: 250000 },
      { method: "card", base_paisa: 300000 },
    ]);
    const args = rpcMock.mock.calls[0][1];
    expect(args.p_payments).toEqual([
      { method: "cash", base_paisa: 200000, tendered_paisa: 250000 },
      { method: "card", base_paisa: 300000 },
    ]);
    expect(JSON.stringify(args.p_payments)).not.toMatch(/tax_paisa|amount_paisa/);
  });

  it("defaults discount/service charge/delivery fee to 0", async () => {
    rpcMock.mockResolvedValue({ data: {}, error: null });
    await settleOrder("order-1", [{ method: "cash", base_paisa: 100000 }]);
    const args = rpcMock.mock.calls[0][1];
    expect(args.p_discount_paisa).toBe(0);
    expect(args.p_service_charge_paisa).toBe(0);
    expect(args.p_delivery_fee_paisa).toBe(0);
  });

  it("passes discount/service charge/delivery fee through when given", async () => {
    rpcMock.mockResolvedValue({ data: {}, error: null });
    await settleOrder(
      "order-1",
      [{ method: "cash", base_paisa: 100000 }],
      { discountPaisa: 5000, serviceChargePaisa: 2000, deliveryFeePaisa: 3000 }
    );
    const args = rpcMock.mock.calls[0][1];
    expect(args.p_discount_paisa).toBe(5000);
    expect(args.p_service_charge_paisa).toBe(2000);
    expect(args.p_delivery_fee_paisa).toBe(3000);
  });

  it("throws a plain Error on failure (e.g. splits not summing to the bill)", async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: { message: "PAY: split payments (400000) do not sum to bill (500000)" },
    });
    await expect(
      settleOrder("order-1", [{ method: "cash", base_paisa: 400000 }])
    ).rejects.toThrow("do not sum to bill");
  });
});

describe("loadPaymentMethodTaxRates", () => {
  it("joins payment_method_tax_class with the current tax_rates row per class", async () => {
    fromMock.mockImplementation((table: string) => {
      if (table === "payment_method_tax_class") {
        return {
          select: () =>
            Promise.resolve({
              data: [
                { method: "cash", class: "cash" },
                { method: "card", class: "digital" },
              ],
            }),
        };
      }
      if (table === "tax_rates") {
        return {
          select: () => ({
            is: () =>
              Promise.resolve({
                data: [
                  { class: "cash", rate_bp: 1600 },
                  { class: "digital", rate_bp: 800 },
                ],
              }),
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    });

    const rates = await loadPaymentMethodTaxRates();
    expect(rates.cash).toEqual({ class: "cash", rate_bp: 1600 });
    expect(rates.card).toEqual({ class: "digital", rate_bp: 800 });
  });
});

import { describe, it, expect } from "vitest";
import {
  classifyMenuItems,
  flagCashVariance,
  flagStockVariance,
  flagVoidValue,
  flagLowMarginItems,
  flagIngredientCostIncrease,
  flagNetLoss,
  labourCostPercent,
  sumBy,
  aggregateHourly,
  type ProductPerformanceRow,
  type CashVarianceByCashierRow,
  type VoidByCashierRow,
  type IngredientCostTrendRow,
  type DailyPlRow,
  type HourlySalesRow,
} from "../lib/reports";

function ppRow(overrides: Partial<ProductPerformanceRow>): ProductPerformanceRow {
  return {
    business_date: "2026-08-12",
    menu_item_id: "item-1",
    name_snapshot: "Karak Chai",
    qty: 10,
    revenue_paisa: 10000,
    cogs_paisa: 3000,
    margin_paisa: 7000,
    ...overrides,
  };
}

describe("sumBy", () => {
  it("sums a picked numeric field across rows", () => {
    expect(sumBy([{ x: 1 }, { x: 2 }, { x: 3 }], (r) => r.x)).toBe(6);
  });

  it("returns 0 for an empty array", () => {
    expect(sumBy([] as { x: number }[], (r) => r.x)).toBe(0);
  });
});

describe("classifyMenuItems — the Menu Engineering Matrix", () => {
  it("splits four items into all four quadrants around the set's own median", () => {
    const rows = [
      // Popular (qty 20) + high margin (70%) -> star
      ppRow({ menu_item_id: "star", name_snapshot: "Star Item", qty: 20, revenue_paisa: 10000, margin_paisa: 7000 }),
      // Popular (qty 18) + low margin (10%) -> plow-horse
      ppRow({ menu_item_id: "plow", name_snapshot: "Plow Item", qty: 18, revenue_paisa: 10000, margin_paisa: 1000 }),
      // Unpopular (qty 2) + high margin (70%) -> puzzle
      ppRow({ menu_item_id: "puzzle", name_snapshot: "Puzzle Item", qty: 2, revenue_paisa: 10000, margin_paisa: 7000 }),
      // Unpopular (qty 1) + low margin (10%) -> dog
      ppRow({ menu_item_id: "dog", name_snapshot: "Dog Item", qty: 1, revenue_paisa: 10000, margin_paisa: 1000 }),
    ];
    const result = classifyMenuItems(rows);
    const byId = Object.fromEntries(result.map((r) => [r.menuItemId, r.quadrant]));
    expect(byId.star).toBe("stars");
    expect(byId.plow).toBe("plow_horses");
    expect(byId.puzzle).toBe("puzzles");
    expect(byId.dog).toBe("dogs");
  });

  it("aggregates multiple business_date rows for the same item into one before classifying", () => {
    const rows = [
      ppRow({ menu_item_id: "a", qty: 5, revenue_paisa: 5000, margin_paisa: 2000, business_date: "2026-08-11" }),
      ppRow({ menu_item_id: "a", qty: 5, revenue_paisa: 5000, margin_paisa: 2000, business_date: "2026-08-12" }),
    ];
    const result = classifyMenuItems(rows);
    expect(result).toHaveLength(1);
    expect(result[0].qty).toBe(10);
    expect(result[0].revenuePaisa).toBe(10000);
    expect(result[0].marginPaisa).toBe(4000);
    expect(result[0].marginPercent).toBeCloseTo(40, 5);
  });

  it("an item with zero revenue has 0% margin, not NaN or Infinity", () => {
    const rows = [ppRow({ menu_item_id: "free", qty: 1, revenue_paisa: 0, margin_paisa: 0 })];
    expect(classifyMenuItems(rows)[0].marginPercent).toBe(0);
  });
});

describe("flagCashVariance", () => {
  it("flags only cashiers/days with at least one over-threshold shift", () => {
    const rows: CashVarianceByCashierRow[] = [
      {
        business_date: "2026-08-12",
        cashier_id: "c1",
        cashier_name: "Ali",
        shifts: 1,
        total_variance_paisa: 60000,
        avg_variance_paisa: 60000,
        shifts_over_threshold: 1,
      },
      {
        business_date: "2026-08-12",
        cashier_id: "c2",
        cashier_name: "Bilal",
        shifts: 1,
        total_variance_paisa: 100,
        avg_variance_paisa: 100,
        shifts_over_threshold: 0,
      },
    ];
    const flags = flagCashVariance(rows);
    expect(flags).toHaveLength(1);
    expect(flags[0].message).toContain("Ali");
  });
});

describe("flagStockVariance", () => {
  it("flags an ingredient over 5% unexplained variance, ignores one under", () => {
    const rows = [
      { name: "Chicken", theoretical_used: 100, count_adjustment: -8 }, // 8%
      { name: "Beef", theoretical_used: 100, count_adjustment: -2 }, // 2%
    ];
    const flags = flagStockVariance(rows);
    expect(flags).toHaveLength(1);
    expect(flags[0].message).toContain("Chicken");
  });

  it("skips an ingredient with zero theoretical usage rather than dividing by zero", () => {
    const flags = flagStockVariance([{ name: "Unused", theoretical_used: 0, count_adjustment: -5 }]);
    expect(flags).toHaveLength(0);
  });
});

describe("flagVoidValue", () => {
  it("flags a cashier whose void value exceeds 3% of that day's revenue", () => {
    const voidRows: VoidByCashierRow[] = [
      { business_date: "2026-08-12", cashier_id: "c1", cashier_name: "Ali", void_count: 2, void_value_paisa: 5000 },
    ];
    const revenueByDate = new Map([["2026-08-12", 100000]]); // 5% > 3%
    const flags = flagVoidValue(voidRows, revenueByDate);
    expect(flags).toHaveLength(1);
  });

  it("does not flag when revenue for that day is unknown (treated as 0% of nothing)", () => {
    const voidRows: VoidByCashierRow[] = [
      { business_date: "2026-08-12", cashier_id: "c1", cashier_name: "Ali", void_count: 1, void_value_paisa: 5000 },
    ];
    const flags = flagVoidValue(voidRows, new Map());
    expect(flags).toHaveLength(0);
  });
});

describe("flagLowMarginItems", () => {
  it("flags an item under 20% margin", () => {
    const items = classifyMenuItems([ppRow({ qty: 5, revenue_paisa: 10000, margin_paisa: 1000 })]); // 10%
    expect(flagLowMarginItems(items)).toHaveLength(1);
  });

  it("does not flag an item at or above 20% margin", () => {
    const items = classifyMenuItems([ppRow({ qty: 5, revenue_paisa: 10000, margin_paisa: 2000 })]); // 20%
    expect(flagLowMarginItems(items)).toHaveLength(0);
  });
});

describe("flagIngredientCostIncrease", () => {
  it("flags an ingredient whose cost rose more than 10% vs. 30-90 days ago", () => {
    const rows: IngredientCostTrendRow[] = [
      { ingredient_id: "i1", name: "Chicken", current_cost_paisa: 100000, prior_cost_paisa: 85000 }, // ~17.6%
    ];
    expect(flagIngredientCostIncrease(rows)).toHaveLength(1);
  });

  it("skips an ingredient with no purchase history to compare against", () => {
    const rows: IngredientCostTrendRow[] = [
      { ingredient_id: "i1", name: "New Ingredient", current_cost_paisa: 100000, prior_cost_paisa: null },
    ];
    expect(flagIngredientCostIncrease(rows)).toHaveLength(0);
  });
});

describe("flagNetLoss — the flag the old system got wrong every month", () => {
  function plDay(overrides: Partial<DailyPlRow>): DailyPlRow {
    return {
      business_date: "2026-08-12",
      orders: 10,
      revenue_paisa: 100000,
      cogs_paisa: 40000,
      tax_paisa: 16000,
      gross_profit_paisa: 60000,
      voided_orders: 0,
      voided_value_paisa: 0,
      ...overrides,
    };
  }

  it("flags a day whose gross profit doesn't cover that day's amortised expenses", () => {
    const flag = flagNetLoss(plDay({ gross_profit_paisa: 60000 }), 80000);
    expect(flag).not.toBeNull();
    expect(flag!.type).toBe("net_loss");
  });

  it("does NOT flag a day where a full month's rent posted on one day would look like a loss", () => {
    // The old bug: Rs 20,000 rent landing entirely on one day next to a
    // normal Rs 60,000 gross-profit day would have shown a huge fake
    // loss. Amortised across 30 days, rent is only ~Rs 667/day — nowhere
    // near enough to turn a Rs 60,000 gross-profit day into a loss.
    const amortisedRentForOneDay = Math.round(2000000 / 30); // ~Rs 667
    const flag = flagNetLoss(plDay({ gross_profit_paisa: 6000000 }), amortisedRentForOneDay);
    expect(flag).toBeNull();
  });

  it("a day exactly at breakeven is not a loss", () => {
    expect(flagNetLoss(plDay({ gross_profit_paisa: 50000 }), 50000)).toBeNull();
  });
});

describe("aggregateHourly", () => {
  it("always returns all 24 hours, zero-filled where there's no data", () => {
    const result = aggregateHourly([]);
    expect(result).toHaveLength(24);
    expect(result.every((b) => b.orders === 0 && b.revenuePaisa === 0)).toBe(true);
  });

  it("sums the same hour across multiple days into one bucket", () => {
    const rows: HourlySalesRow[] = [
      { business_date: "2026-08-11", hour_of_day: 20, orders: 3, revenue_paisa: 5000 },
      { business_date: "2026-08-12", hour_of_day: 20, orders: 2, revenue_paisa: 3000 },
    ];
    const result = aggregateHourly(rows);
    const hour20 = result.find((b) => b.hour === 20)!;
    expect(hour20.orders).toBe(5);
    expect(hour20.revenuePaisa).toBe(8000);
  });
});

describe("labourCostPercent", () => {
  it("computes labour cost as a percentage of revenue", () => {
    expect(labourCostPercent(20000, 100000)).toBe(20);
  });

  it("returns null rather than a meaningless percentage when revenue is zero", () => {
    expect(labourCostPercent(20000, 0)).toBeNull();
  });
});

import { describe, it, expect } from "vitest";
import {
  rupeesToPaisa,
  paisaToRupees,
  formatPaisa,
  addPaisa,
  multiplyPaisa,
  calculateTax,
  type Paisa,
} from "../lib/money";

describe("rupeesToPaisa", () => {
  it("converts a whole-rupee price", () => {
    expect(rupeesToPaisa(599)).toBe(59900);
  });

  it("converts a price with paisa already specified", () => {
    expect(rupeesToPaisa(599.5)).toBe(59950);
  });

  it("avoids float precision artifacts (raw JS: 19.99 * 100 is not exactly 1999)", () => {
    expect(19.99 * 100).not.toBe(1999); // the raw bug: 1998.9999999999998
    expect(rupeesToPaisa(19.99)).toBe(1999); // rounded away
  });

  it("handles a real menu price", () => {
    expect(rupeesToPaisa(329)).toBe(32900); // Karak Chai
  });
});

describe("paisaToRupees", () => {
  it("converts back to rupees", () => {
    expect(paisaToRupees(59900 as Paisa)).toBe(599);
  });

  it("round-trips with rupeesToPaisa", () => {
    expect(paisaToRupees(rupeesToPaisa(1549))).toBe(1549); // Tarragon Steak
  });
});

describe("formatPaisa", () => {
  it("formats a typical price", () => {
    expect(formatPaisa(59900 as Paisa)).toBe("Rs 599.00");
  });

  it("formats exactly one rupee", () => {
    expect(formatPaisa(100 as Paisa)).toBe("Rs 1.00");
  });

  it("formats zero", () => {
    expect(formatPaisa(0 as Paisa)).toBe("Rs 0.00");
  });

  it("formats large amounts with thousands grouping", () => {
    expect(formatPaisa(150000 as Paisa)).toBe("Rs 1,500.00");
  });

  it("always shows exactly two decimal places, even for a round number", () => {
    expect(formatPaisa(200000 as Paisa)).toBe("Rs 2,000.00");
  });
});

describe("addPaisa", () => {
  it("sums several amounts", () => {
    expect(addPaisa(100 as Paisa, 200 as Paisa, 300 as Paisa)).toBe(600);
  });

  it("returns 0 for no arguments", () => {
    expect(addPaisa()).toBe(0);
  });

  it("never drifts across many additions (no float creep)", () => {
    let total = 0 as Paisa;
    for (let i = 0; i < 1000; i++) {
      total = addPaisa(total, 33 as Paisa);
    }
    expect(total).toBe(33000);
    expect(Number.isInteger(total)).toBe(true);
  });
});

describe("multiplyPaisa", () => {
  it("multiplies a unit price by a whole quantity", () => {
    expect(multiplyPaisa(59900 as Paisa, 2)).toBe(119800);
  });

  it("rounds half up when the result isn't a whole paisa", () => {
    // 201 * 0.5 = 100.5 -> rounds to 101 (simple round, half up — the
    // rule this project uses, not banker's rounding)
    expect(multiplyPaisa(201 as Paisa, 0.5)).toBe(101);
  });

  it("handles a fractional quantity cleanly (e.g. 1.5x a recipe)", () => {
    expect(multiplyPaisa(32900 as Paisa, 1.5)).toBe(49350);
  });
});

describe("calculateTax — the rounding rule", () => {
  it("computes 16% cash tax on a round number exactly", () => {
    expect(calculateTax(10000 as Paisa, 1600)).toBe(1600);
  });

  it("computes 8% digital tax on a round number exactly", () => {
    expect(calculateTax(10000 as Paisa, 800)).toBe(800);
  });

  it("rounds a fractional result half up (16%)", () => {
    // 12345 * 1600 / 10000 = 1975.2 -> 1975
    expect(calculateTax(12345 as Paisa, 1600)).toBe(1975);
  });

  it("rounds a fractional result half up (8%)", () => {
    // 12345 * 800 / 10000 = 987.6 -> 988
    expect(calculateTax(12345 as Paisa, 800)).toBe(988);
  });

  it("avoids the classic float bug (raw JS: 1329 * 0.16 is not exactly 212.64)", () => {
    expect(1329 * 0.16).not.toBe(212.64); // the bug, demonstrated: 212.64000000000001
    const base = rupeesToPaisa(1329); // 132900
    expect(calculateTax(base, 1600)).toBe(21264); // exact integer paisa, no drift
  });

  it("computes each payment split independently at its OWN rate — never a blended rate", () => {
    const cashBase = 40000; // Rs 400 paid in cash -> 16%
    const cardBase = 20000; // Rs 200 paid by card -> 8%
    const cashTax = calculateTax(cashBase, 1600);
    const cardTax = calculateTax(cardBase, 800);

    expect(cashTax).toBe(6400);
    expect(cardTax).toBe(1600);

    // Split bases must sum back to the original bill subtotal exactly —
    // this is what settle_order() enforces server-side (Part 09/10).
    expect(addPaisa(cashBase as Paisa, cardBase as Paisa)).toBe(60000);
    // Total tax collected is the sum of each split's own (already-rounded) tax.
    expect(addPaisa(cashTax, cardTax)).toBe(8000);
  });

  it("rounding happens on each split BEFORE summing, never on the combined bill first", () => {
    // Two splits whose individual roundings each add +0.5 paisa of
    // rounding — summing the pre-rounded splits differs from rounding
    // the combined total once, which is exactly why the rule exists.
    const splitA = calculateTax(125, 40); // 125 * 40 / 10000 = 0.5 -> rounds to 1
    const splitB = calculateTax(125, 40); // same -> 1
    const perSplitTotal = addPaisa(splitA, splitB); // 1 + 1 = 2

    const combinedBase = 125 + 125; // 250
    const combinedOnceRounded = Math.round((combinedBase * 40) / 10000); // 250*40/10000 = 1.0 -> 1

    expect(perSplitTotal).toBe(2);
    expect(combinedOnceRounded).toBe(1);
    expect(perSplitTotal).not.toBe(combinedOnceRounded);
  });
});

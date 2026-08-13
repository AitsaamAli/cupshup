import { describe, it, expect } from "vitest";
import { priceForOrderType, type MenuData, type MenuItemPrice } from "../lib/menu";

// Matches the doc's own worked example: Karak Chai default 329, takeaway
// 349, delivery 379 — Part 22 §1's "sabse zyada paise wala gap".
const ITEM_ID = "karak-chai";

function priceRow(pricePaisa: number, orderType: MenuItemPrice["order_type"] = null): MenuItemPrice {
  return {
    id: "row",
    menu_item_id: ITEM_ID,
    price_paisa: pricePaisa,
    effective_from: "2026-01-01",
    effective_to: null,
    order_type: orderType,
  };
}

describe("priceForOrderType", () => {
  const currentPrices: MenuData["currentPrices"] = { [ITEM_ID]: priceRow(32900) };
  const orderTypePrices: MenuData["orderTypePrices"] = {
    [ITEM_ID]: {
      takeaway: priceRow(34900, "takeaway"),
      delivery: priceRow(37900, "delivery"),
    },
  };

  it("dine_in (no override) reads the default price", () => {
    expect(priceForOrderType(ITEM_ID, "dine_in", currentPrices, orderTypePrices)).toBe(32900);
  });

  it("takeaway reads its own override, not the default", () => {
    expect(priceForOrderType(ITEM_ID, "takeaway", currentPrices, orderTypePrices)).toBe(34900);
  });

  it("delivery reads its own override, not the default", () => {
    expect(priceForOrderType(ITEM_ID, "delivery", currentPrices, orderTypePrices)).toBe(37900);
  });

  it("an order type with no override falls back to the default", () => {
    const noOverrides: MenuData["orderTypePrices"] = {};
    expect(priceForOrderType(ITEM_ID, "delivery", currentPrices, noOverrides)).toBe(32900);
  });

  it("null orderType (unknown/not-yet-chosen) reads the default", () => {
    expect(priceForOrderType(ITEM_ID, null, currentPrices, orderTypePrices)).toBe(32900);
  });

  it("an item with no price at all resolves to 0, never throws", () => {
    expect(priceForOrderType("unknown-item", "delivery", currentPrices, orderTypePrices)).toBe(0);
  });
});

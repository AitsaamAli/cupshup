import { describe, it, expect, vi, beforeEach } from "vitest";

// The real client would need a live Supabase project (see docs/order-engine.md
// for what still needs that). These tests cover the parts that don't:
// the idempotency-key contract and the shape of each RPC call.
const rpcMock = vi.fn();
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ rpc: rpcMock }),
}));

const { placeOrder, addItemsToOrder, advanceOrderStatus, voidOrder, OrderError } = await import(
  "../lib/orders"
);

describe("placeOrder", () => {
  beforeEach(() => {
    rpcMock.mockReset();
  });

  it("generates a fresh idempotency key when none is provided", async () => {
    rpcMock.mockResolvedValue({ data: { order: { id: "o1" }, duplicate: false }, error: null });
    await placeOrder("outlet-1", "dine_in", [{ menu_item_id: "item-1", qty: 1 }]);
    const args = rpcMock.mock.calls[0][1];
    expect(args.p_idempotency_key).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    );
  });

  it("reuses a provided idempotency key exactly, never generating a new one", async () => {
    rpcMock.mockResolvedValue({ data: { order: { id: "o1" }, duplicate: true }, error: null });
    await placeOrder("outlet-1", "dine_in", [{ menu_item_id: "item-1", qty: 1 }], {
      idempotencyKey: "fixed-key-123",
    });
    const args = rpcMock.mock.calls[0][1];
    expect(args.p_idempotency_key).toBe("fixed-key-123");
  });

  it("sends only menu_item_id/qty/modifiers — never a price or total", async () => {
    rpcMock.mockResolvedValue({ data: { order: { id: "o1" }, duplicate: false }, error: null });
    await placeOrder("outlet-1", "dine_in", [
      { menu_item_id: "item-1", qty: 2, modifiers: [{ modifier_id: "m1", price_delta_paisa: 100 }] },
    ]);
    const args = rpcMock.mock.calls[0][1];
    expect(args.p_items).toEqual([
      {
        menu_item_id: "item-1",
        qty: 2,
        modifiers: [{ modifier_id: "m1", price_delta_paisa: 100 }],
      },
    ]);
    // The one "price_delta_paisa" above is a MODIFIER's own delta, which
    // the server still verifies against the real modifiers table — not
    // a client-asserted item price or order total, which must never appear.
    expect(args).not.toHaveProperty("p_total_paisa");
    expect(args).not.toHaveProperty("p_subtotal_paisa");
  });

  it("throws OrderError carrying the idempotency key on failure, so a caller can retry safely", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "DAY: closed" } });

    try {
      await placeOrder("outlet-1", "dine_in", [{ menu_item_id: "item-1", qty: 1 }], {
        idempotencyKey: "retry-key",
      });
      throw new Error("expected placeOrder to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(OrderError);
      expect((err as InstanceType<typeof OrderError>).idempotencyKey).toBe("retry-key");
      expect((err as Error).message).toBe("DAY: closed");
    }
  });

  it("returns duplicate: true when the server recognises a repeated key", async () => {
    rpcMock.mockResolvedValue({ data: { order: { id: "o1" }, duplicate: true }, error: null });
    const result = await placeOrder("outlet-1", "dine_in", [{ menu_item_id: "item-1", qty: 1 }], {
      idempotencyKey: "same-key",
    });
    expect(result.duplicate).toBe(true);
  });
});

describe("addItemsToOrder / advanceOrderStatus / voidOrder", () => {
  beforeEach(() => {
    rpcMock.mockReset();
  });

  it("addItemsToOrder calls add_items_to_order with the right shape", async () => {
    rpcMock.mockResolvedValue({ data: { order: { id: "o1" } }, error: null });
    await addItemsToOrder("o1", [{ menu_item_id: "item-2", qty: 1 }]);
    expect(rpcMock).toHaveBeenCalledWith("add_items_to_order", {
      p_order_id: "o1",
      p_items: [{ menu_item_id: "item-2", qty: 1 }],
    });
  });

  it("advanceOrderStatus only ever requests ready or served", async () => {
    rpcMock.mockResolvedValue({ data: {}, error: null });
    await advanceOrderStatus("o1", "ready");
    expect(rpcMock).toHaveBeenCalledWith("advance_order_status", {
      p_order_id: "o1",
      p_new_status: "ready",
    });
  });

  it("voidOrder defaults reasonNote/orderItemId to null for a full-order void", async () => {
    rpcMock.mockResolvedValue({ data: {}, error: null });
    await voidOrder("o1", "customer_cancel");
    expect(rpcMock).toHaveBeenCalledWith("void_order", {
      p_order_id: "o1",
      p_reason_code: "customer_cancel",
      p_reason_note: null,
      p_order_item_id: null,
    });
  });

  it("voidOrder passes orderItemId through for a single-line void", async () => {
    rpcMock.mockResolvedValue({ data: {}, error: null });
    await voidOrder("o1", "wrong_item", { orderItemId: "line-1", reasonNote: "typo" });
    expect(rpcMock).toHaveBeenCalledWith("void_order", {
      p_order_id: "o1",
      p_reason_code: "wrong_item",
      p_reason_note: "typo",
      p_order_item_id: "line-1",
    });
  });

  it("addItemsToOrder throws a plain Error (no idempotency concept there)", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "ORDER: voided" } });
    await expect(addItemsToOrder("o1", [{ menu_item_id: "item-2", qty: 1 }])).rejects.toThrow(
      "ORDER: voided"
    );
  });
});

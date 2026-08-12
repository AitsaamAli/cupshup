import { describe, it, expect } from "vitest";
import {
  buildReceiptDoc,
  buildKitchenTicketDoc,
  buildDayReportDoc,
  type ReceiptOutlet,
  type ReceiptOrder,
  type ReceiptPayment,
} from "../lib/print-templates";
import type { KdsTicket } from "../lib/kds";
import type { ClosingSnapshot } from "../lib/business-day";

// Fixtures follow the brief's own worked example (19-printing-and-pra-
// invoice.md §4) exactly, so the test doubles as a check that the
// template reproduces that layout's numbers.
const outlet: ReceiptOutlet = {
  name: "CUP SHUP",
  address: "Johar Town, Lahore",
  phone: "0300-XXXXXXX",
  ntn: "XXXXXXX-X",
  strn: "XXXXXXXXXXXXX",
  praRegNo: "XXXXXXXX",
};

const order: ReceiptOrder = {
  invoiceNo: "CS-20260812-0042",
  praInvoiceNo: "PRA-9988",
  praQrPayload: "https://example.pra.gov.pk/verify/CS-20260812-0042",
  orderType: "dine_in",
  tableLabel: "7",
  settledAtIso: "2026-08-12T21:47:00+05:00",
  items: [
    { qty: 2, name: "Karak Chai", lineTotalPaisa: 65800 },
    { qty: 1, name: "Loaded Fries", lineTotalPaisa: 74900 },
  ],
  subtotalPaisa: 140700,
  discountPaisa: 0,
  serviceChargePaisa: 0,
  deliveryFeePaisa: 0,
  totalPaisa: 160000,
};

const payments: ReceiptPayment[] = [
  { method: "cash", basePaisa: 100000, taxRateBp: 1600, taxPaisa: 16000, amountPaisa: 116000, tenderedPaisa: 120000, changePaisa: 4000 },
  { method: "card", basePaisa: 40700, taxRateBp: 800, taxPaisa: 3300, amountPaisa: 44000, tenderedPaisa: null, changePaisa: null },
];

function rowText(rows: ReturnType<typeof buildReceiptDoc>["rows"]): string[] {
  return rows.map((r) => ("divider" in r ? "---" : "blank" in r ? "" : `${r.left}|${r.right ?? ""}`));
}

describe("buildReceiptDoc — the brief's own worked example", () => {
  it("prints each item with its own qty and line total", () => {
    const doc = buildReceiptDoc({
      outlet,
      order,
      payments,
      cashierName: "Ali",
      cashierCode: "ORD001",
      terminalName: "T1",
      printNumber: 1,
    });
    const text = rowText(doc.rows);
    expect(text).toContain("2 x Karak Chai|658.00");
    expect(text).toContain("1 x Loaded Fries|749.00");
  });

  it("shows each payment split at its OWN rate, never one blended rate", () => {
    const doc = buildReceiptDoc({ outlet, order, payments, cashierName: "Ali", cashierCode: "ORD001", terminalName: "T1", printNumber: 1 });
    const text = rowText(doc.rows);
    expect(text).toContain("Cash  1,000.00 @16%|160.00");
    expect(text).toContain("Card  407.00 @8%|33.00");
  });

  it("shows tendered/change from the cash split only", () => {
    const doc = buildReceiptDoc({ outlet, order, payments, cashierName: "Ali", cashierCode: "ORD001", terminalName: "T1", printNumber: 1 });
    const text = rowText(doc.rows);
    expect(text).toContain("Cash tendered|1,200.00");
    expect(text).toContain("Change|40.00");
  });

  it("does not show a REPRINT marker on the first print", () => {
    const doc = buildReceiptDoc({ outlet, order, payments, cashierName: "Ali", cashierCode: "ORD001", terminalName: "T1", printNumber: 1 });
    expect(rowText(doc.rows).some((r) => r.startsWith("REPRINT"))).toBe(false);
  });

  it("shows REPRINT #N from the second print onward", () => {
    const doc = buildReceiptDoc({ outlet, order, payments, cashierName: "Ali", cashierCode: "ORD001", terminalName: "T1", printNumber: 2 });
    expect(rowText(doc.rows)).toContain("REPRINT #2|");
  });

  it("carries the PRA QR payload through when PRA has already confirmed", () => {
    const doc = buildReceiptDoc({ outlet, order, payments, cashierName: "Ali", cashierCode: "ORD001", terminalName: "T1", printNumber: 1 });
    expect(doc.qrPayload).toBe(order.praQrPayload);
  });

  it("prints 'pending' for the PRA number and no QR when PRA hasn't confirmed yet (offline queue case)", () => {
    const offlineOrder = { ...order, praInvoiceNo: null, praQrPayload: null };
    const doc = buildReceiptDoc({ outlet, order: offlineOrder, payments, cashierName: "Ali", cashierCode: "ORD001", terminalName: "T1", printNumber: 1 });
    expect(rowText(doc.rows)).toContain("PRA No :|pending");
    expect(doc.qrPayload).toBeUndefined();
  });
});

describe("buildKitchenTicketDoc — Part 17's station filtering, reused", () => {
  const ticket: KdsTicket = {
    id: "order-1",
    order_no: 42,
    order_type: "dine_in",
    status: "sent_to_kitchen",
    table_label: "7",
    note: null,
    created_at: "2026-08-12T20:00:00Z",
    ready_at: null,
    items: [
      {
        id: "i1",
        order_id: "order-1",
        menu_item_id: "m1",
        name_snapshot: "Thunder Grilled Burger",
        qty: 1,
        modifiers: [],
        note: null,
        status: "pending",
        created_at: "2026-08-12T20:00:00Z",
        ready_at: null,
        station: "hot_kitchen",
      },
      {
        id: "i2",
        order_id: "order-1",
        menu_item_id: "m2",
        name_snapshot: "Karak Chai",
        qty: 2,
        modifiers: [],
        note: null,
        status: "pending",
        created_at: "2026-08-12T20:00:00Z",
        ready_at: null,
        station: "chai_coffee",
      },
    ],
  };

  it("only prints the requested station's own items", () => {
    const doc = buildKitchenTicketDoc(ticket, "hot_kitchen");
    const text = rowText(doc.rows);
    expect(text.some((r) => r.includes("Burger"))).toBe(true);
    expect(text.some((r) => r.includes("Karak Chai"))).toBe(false);
  });

  it("prints every item when station is null (All stations)", () => {
    const doc = buildKitchenTicketDoc(ticket, null);
    const text = rowText(doc.rows);
    expect(text.some((r) => r.includes("Burger"))).toBe(true);
    expect(text.some((r) => r.includes("Karak Chai"))).toBe(true);
  });

  it("never prints a price", () => {
    const doc = buildKitchenTicketDoc(ticket, null);
    const text = rowText(doc.rows).join("\n");
    expect(text).not.toContain("Rs");
  });
});

describe("buildDayReportDoc — Part 13's ClosingSnapshot, unchanged", () => {
  const snapshot: ClosingSnapshot = {
    orders: 40,
    revenue_paisa: 5000000,
    tax_paisa: 700000,
    collected_paisa: 5700000,
    cogs_paisa: 2000000,
    gross_profit_paisa: 3000000,
    expenses_paisa: 500000,
    net_profit_paisa: 2500000,
    cash_sales_paisa: 3000000,
    opening_float_paisa: 500000,
    cash_drops_paisa: 1000000,
    expected_cash_paisa: 2500000,
    counted_cash_paisa: 2450000,
    variance_paisa: -50000,
  };

  it("prints the snapshot's own numbers without re-deriving them", () => {
    const doc = buildDayReportDoc({ outletName: "CUP SHUP", businessDate: "2026-08-12", snapshot });
    const text = rowText(doc.rows);
    expect(text).toContain("Net profit|25,000.00");
    expect(text).toContain("Variance|-500.00");
  });
});

/**
 * Print content builders — Part 19. Every template here returns a
 * `PrintDoc`: a renderer-agnostic list of rows (plain text, optionally
 * paired left/right on one line, plus dividers and an optional QR
 * payload). Neither the local print agent's ESC/POS renderer nor the
 * browser CSS fallback (components/print/*) cares how a `PrintDoc` was
 * built — they only need to lay out `PrintRow`s, which is what makes it
 * safe to unit test every template here without a printer, an HTTP
 * call, or a browser at all.
 */

import { formatPaisa } from "./money";
import type { KdsTicket, Station } from "./kds";
import { STATIONS, ticketItemsForStation } from "./kds";
import type { ClosingSnapshot } from "./business-day";

export type PrintAlign = "left" | "center";

export interface PrintRow {
  /** Left-aligned (or centered, if `align` is "center") text. */
  left: string;
  /** Right-aligned text on the SAME line as `left` — the renderer pads
   * between them to the printer's/page's own column width. Omit for a
   * plain single-column row. */
  right?: string;
  align?: PrintAlign;
  bold?: boolean;
  /** "large" doubles the row's height/width — used for kitchen ticket
   * item lines, which need to be readable from across the kitchen. */
  size?: "normal" | "large";
}

export interface PrintDoc {
  rows: (PrintRow | { divider: true } | { blank: true })[];
  /** Rendered as a QR code by whichever renderer supports one — plain
   * text as a fallback line if it doesn't. */
  qrPayload?: string;
}

function money(paisa: number): string {
  return formatPaisa(paisa).replace("Rs ", "");
}

// -----------------------------------------------------------------------
// Customer receipt — the brief's own worked example (19-printing-and-
// pra-invoice.md §4), reproduced exactly: header, invoice/PRA/date/
// table/cashier/terminal block, items, subtotal/discount, one row per
// payment split (each at ITS OWN rate — impossible in the old system),
// total/tendered/change, QR + PRA verification line.
// -----------------------------------------------------------------------

export interface ReceiptOutlet {
  name: string;
  address: string | null;
  phone: string | null;
  ntn: string | null;
  strn: string | null;
  praRegNo: string | null;
}

export interface ReceiptItem {
  qty: number;
  name: string;
  lineTotalPaisa: number;
}

export interface ReceiptPayment {
  method: string;
  basePaisa: number;
  taxRateBp: number;
  taxPaisa: number;
  amountPaisa: number;
  tenderedPaisa: number | null;
  changePaisa: number | null;
}

export interface ReceiptOrder {
  invoiceNo: string;
  praInvoiceNo: string | null;
  praQrPayload: string | null;
  orderType: "dine_in" | "takeaway" | "delivery";
  tableLabel: string | null;
  settledAtIso: string;
  items: ReceiptItem[];
  subtotalPaisa: number;
  discountPaisa: number;
  serviceChargePaisa: number;
  deliveryFeePaisa: number;
  totalPaisa: number;
}

const ORDER_TYPE_LABEL: Record<ReceiptOrder["orderType"], string> = {
  dine_in: "Dine In",
  takeaway: "Takeaway",
  delivery: "Delivery",
};

const METHOD_LABEL: Record<string, string> = {
  cash: "Cash",
  card: "Card",
  jazzcash: "JazzCash",
  easypaisa: "Easypaisa",
  qr: "QR",
  foodpanda: "Foodpanda",
};

function formatReceiptDate(iso: string): string {
  const d = new Date(iso);
  const day = String(d.getDate()).padStart(2, "0");
  const month = d.toLocaleString("en-US", { month: "short" });
  const year = d.getFullYear();
  const hours = String(d.getHours()).padStart(2, "0");
  const minutes = String(d.getMinutes()).padStart(2, "0");
  return `${day}-${month}-${year}  ${hours}:${minutes}`;
}

export function buildReceiptDoc(input: {
  outlet: ReceiptOutlet;
  order: ReceiptOrder;
  payments: ReceiptPayment[];
  cashierName: string;
  cashierCode: string;
  terminalName: string | null;
  /** From record_invoice_print() — 1 for a first print, so no REPRINT
   * marker is rendered; 2+ prints "REPRINT #N" per the brief's own
   * fraud-control requirement. */
  printNumber: number;
}): PrintDoc {
  const { outlet, order, payments, cashierName, cashierCode, terminalName, printNumber } = input;
  const rows: PrintDoc["rows"] = [];

  rows.push({ left: outlet.name, align: "center", bold: true });
  if (outlet.address) rows.push({ left: outlet.address, align: "center" });
  if (outlet.phone) rows.push({ left: outlet.phone, align: "center" });
  if (outlet.ntn) rows.push({ left: `NTN: ${outlet.ntn}`, align: "center" });
  if (outlet.strn) rows.push({ left: `STRN: ${outlet.strn}`, align: "center" });
  if (outlet.praRegNo) rows.push({ left: `PRA Reg: ${outlet.praRegNo}`, align: "center" });
  rows.push({ divider: true });

  if (printNumber > 1) {
    rows.push({ left: `REPRINT #${printNumber}`, align: "center", bold: true });
  }

  rows.push({ left: "Invoice:", right: order.invoiceNo });
  rows.push({ left: "PRA No :", right: order.praInvoiceNo ?? "pending" });
  rows.push({ left: "Date   :", right: formatReceiptDate(order.settledAtIso) });
  rows.push({
    left: order.tableLabel ? `Table  : ${order.tableLabel}` : "",
    right: `Type: ${ORDER_TYPE_LABEL[order.orderType]}`,
  });
  rows.push({ left: "Cashier:", right: `${cashierName} (${cashierCode})` });
  if (terminalName) rows.push({ left: "Terminal:", right: terminalName });
  rows.push({ divider: true });

  for (const item of order.items) {
    rows.push({ left: `${item.qty} x ${item.name}`, right: money(item.lineTotalPaisa) });
  }
  rows.push({ divider: true });

  rows.push({ left: "Subtotal", right: money(order.subtotalPaisa) });
  rows.push({ left: "Discount", right: money(order.discountPaisa) });
  if (order.serviceChargePaisa > 0) rows.push({ left: "Service charge", right: money(order.serviceChargePaisa) });
  if (order.deliveryFeePaisa > 0) rows.push({ left: "Delivery fee", right: money(order.deliveryFeePaisa) });
  rows.push({ divider: true });

  // One row PER SPLIT, each at its own rate — the brief's own point:
  // "split payment par har hissay ka rate alag dikhta hai", impossible
  // in the old single-rate invoice.
  let cashTenderedPaisa = 0;
  let cashChangePaisa = 0;
  for (const p of payments) {
    const ratePercent = (p.taxRateBp / 100).toFixed(0);
    rows.push({
      left: `${METHOD_LABEL[p.method] ?? p.method}  ${money(p.basePaisa)} @${ratePercent}%`,
      right: money(p.taxPaisa),
    });
    if (p.method === "cash") {
      cashTenderedPaisa += p.tenderedPaisa ?? 0;
      cashChangePaisa += p.changePaisa ?? 0;
    }
  }
  rows.push({ divider: true });

  rows.push({ left: "TOTAL", right: money(order.totalPaisa), bold: true });
  if (cashTenderedPaisa > 0) {
    rows.push({ left: "Cash tendered", right: money(cashTenderedPaisa) });
    rows.push({ left: "Change", right: money(cashChangePaisa) });
  }
  rows.push({ divider: true });

  if (order.praQrPayload) {
    rows.push({ left: "Verify on PRA Tax App", align: "center" });
  } else {
    rows.push({ left: "PRA verification pending — reprint once synced", align: "center" });
  }
  rows.push({ blank: true });
  rows.push({ left: "Thank you", align: "center" });

  return { rows, qrPayload: order.praQrPayload ?? undefined };
}

// -----------------------------------------------------------------------
// Kitchen ticket — one station's own items only (Part 17's
// ticketItemsForStation), large type ("bari type — screen 2 meter door
// hai" applies just as much to a printed ticket taped to a kitchen
// wall). No prices anywhere, same rule as the KDS screen itself.
// -----------------------------------------------------------------------

const STATION_LABEL: Record<Station, string> = Object.fromEntries(STATIONS.map((s) => [s.value, s.label])) as Record<
  Station,
  string
>;

export function buildKitchenTicketDoc(ticket: KdsTicket, station: Station | null): PrintDoc {
  const items = ticketItemsForStation(ticket.items, station);
  const rows: PrintDoc["rows"] = [];

  rows.push({ left: `#${ticket.order_no}`, align: "center", bold: true, size: "large" });
  rows.push({
    left: ticket.table_label ? `${ticket.order_type} — ${ticket.table_label}` : ticket.order_type,
    align: "center",
  });
  if (station) rows.push({ left: STATION_LABEL[station], align: "center", bold: true });
  rows.push({ divider: true });

  for (const item of items) {
    rows.push({ left: `${item.qty} x ${item.name_snapshot}`, bold: true, size: "large" });
    if (item.modifiers.length > 0) {
      rows.push({ left: `  ${item.modifiers.map((m) => m.name ?? m.modifier_id).join(", ")}` });
    }
    if (item.note) rows.push({ left: `  NOTE: ${item.note}` });
  }
  rows.push({ divider: true });
  if (ticket.note) rows.push({ left: ticket.note });

  return { rows };
}

// -----------------------------------------------------------------------
// Shift / day close report — Part 13's ClosingSnapshot, unchanged,
// printed exactly as computed (never re-derived here).
// -----------------------------------------------------------------------

export function buildDayReportDoc(input: {
  outletName: string;
  businessDate: string;
  snapshot: ClosingSnapshot;
}): PrintDoc {
  const { outletName, businessDate, snapshot } = input;
  const rows: PrintDoc["rows"] = [
    { left: outletName, align: "center", bold: true },
    { left: `Day close — ${businessDate}`, align: "center" },
    { divider: true },
    { left: "Orders", right: String(snapshot.orders) },
    { left: "Revenue", right: money(snapshot.revenue_paisa) },
    { left: "Tax collected", right: money(snapshot.tax_paisa) },
    { left: "COGS", right: money(snapshot.cogs_paisa) },
    { left: "Gross profit", right: money(snapshot.gross_profit_paisa) },
    { left: "Expenses", right: money(snapshot.expenses_paisa) },
    { left: "Net profit", right: money(snapshot.net_profit_paisa), bold: true },
    { divider: true },
    { left: "Opening float", right: money(snapshot.opening_float_paisa) },
    { left: "Cash sales", right: money(snapshot.cash_sales_paisa) },
    { left: "Cash drops", right: money(snapshot.cash_drops_paisa) },
    { left: "Expected cash", right: money(snapshot.expected_cash_paisa) },
    { left: "Counted cash", right: money(snapshot.counted_cash_paisa) },
    { left: "Variance", right: money(snapshot.variance_paisa), bold: snapshot.variance_paisa !== 0 },
  ];
  return { rows };
}

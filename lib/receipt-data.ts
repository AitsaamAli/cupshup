"use client";

import { createClient } from "@/lib/supabase/client";
import { castRows } from "@/lib/supabase/rows";
import type { ReceiptOrder, ReceiptOutlet, ReceiptPayment } from "@/lib/print-templates";

export interface ReceiptData {
  outlet: ReceiptOutlet;
  order: ReceiptOrder;
  payments: ReceiptPayment[];
  cashierName: string;
  cashierCode: string;
  terminalName: string | null;
}

/** Gathers everything buildReceiptDoc() needs for one settled order —
 * called once, right before printing, rather than threading all of this
 * through component props from the settlement flow. Settlement (Part
 * 10) doesn't itself carry outlet/cashier/terminal details, only the
 * order id, so this always re-fetches fresh at print time — which also
 * means a reprint always reflects the CURRENT outlet header (address,
 * NTN, ...) even if it changed since the original sale, which is
 * correct: the header describes who's printing this copy, not a
 * snapshot frozen at sale time the way price/cost fields are. */
export async function fetchReceiptData(orderId: string): Promise<ReceiptData> {
  const supabase = createClient();

  const { data: orderRow, error } = await supabase
    .from("orders")
    .select(
      "id, outlet_id, invoice_no, pra_invoice_no, pra_qr_payload, order_type, table_id, subtotal_paisa, discount_paisa, service_charge_paisa, delivery_fee_paisa, total_paisa, settled_at, created_by, shift_id, order_items(id, qty, name_snapshot, line_total_paisa, status)"
    )
    .eq("id", orderId)
    .single();
  if (error || !orderRow) throw new Error(error?.message ?? "Order not found");

  type OrderRow = {
    id: string;
    outlet_id: string;
    invoice_no: string | null;
    pra_invoice_no: string | null;
    pra_qr_payload: string | null;
    order_type: ReceiptOrder["orderType"];
    table_id: string | null;
    subtotal_paisa: number;
    discount_paisa: number;
    service_charge_paisa: number;
    delivery_fee_paisa: number;
    total_paisa: number;
    settled_at: string | null;
    created_by: string | null;
    shift_id: string | null;
    order_items: { id: string; qty: number; name_snapshot: string; line_total_paisa: number; status: string }[];
  };
  const o = orderRow as unknown as OrderRow;
  if (!o.invoice_no) throw new Error("Order has not been settled yet — no invoice number.");

  const [{ data: outletRow }, { data: staffRow }, { data: tableRow }, { data: shiftRow }, { data: paymentRows }] =
    await Promise.all([
      supabase.from("outlets").select("name, address, phone, ntn, strn, pra_reg_no").eq("id", o.outlet_id).single(),
      o.created_by ? supabase.from("staff").select("name, code").eq("id", o.created_by).single() : Promise.resolve({ data: null }),
      o.table_id ? supabase.from("dining_tables").select("label").eq("id", o.table_id).single() : Promise.resolve({ data: null }),
      o.shift_id ? supabase.from("shifts").select("terminal_id").eq("id", o.shift_id).single() : Promise.resolve({ data: null }),
      supabase
        .from("payments")
        .select("method, base_paisa, tax_rate_bp, tax_paisa, amount_paisa, tendered_paisa, change_paisa")
        .eq("order_id", orderId),
    ]);

  const outletData = outletRow as unknown as {
    name: string;
    address: string | null;
    phone: string | null;
    ntn: string | null;
    strn: string | null;
    pra_reg_no: string | null;
  } | null;

  let terminalName: string | null = null;
  const shiftData = shiftRow as unknown as { terminal_id: string | null } | null;
  if (shiftData?.terminal_id) {
    const { data: terminalRow } = await supabase.from("terminals").select("name").eq("id", shiftData.terminal_id).single();
    terminalName = (terminalRow as unknown as { name: string } | null)?.name ?? null;
  }

  const staffData = staffRow as unknown as { name: string; code: string } | null;
  const tableData = tableRow as unknown as { label: string } | null;

  return {
    outlet: {
      name: outletData?.name ?? "Cup Shup",
      address: outletData?.address ?? null,
      phone: outletData?.phone ?? null,
      ntn: outletData?.ntn ?? null,
      strn: outletData?.strn ?? null,
      praRegNo: outletData?.pra_reg_no ?? null,
    },
    order: {
      invoiceNo: o.invoice_no,
      praInvoiceNo: o.pra_invoice_no,
      praQrPayload: o.pra_qr_payload,
      orderType: o.order_type,
      tableLabel: tableData?.label ?? null,
      settledAtIso: o.settled_at ?? new Date().toISOString(),
      items: o.order_items
        .filter((i) => i.status !== "voided")
        .map((i) => ({ qty: i.qty, name: i.name_snapshot, lineTotalPaisa: i.line_total_paisa })),
      subtotalPaisa: o.subtotal_paisa,
      discountPaisa: o.discount_paisa,
      serviceChargePaisa: o.service_charge_paisa,
      deliveryFeePaisa: o.delivery_fee_paisa,
      totalPaisa: o.total_paisa,
    },
    payments: castRows<{
      method: string;
      base_paisa: number;
      tax_rate_bp: number;
      tax_paisa: number;
      amount_paisa: number;
      tendered_paisa: number | null;
      change_paisa: number | null;
    }>(paymentRows).map((p) => ({
      method: p.method,
      basePaisa: p.base_paisa,
      taxRateBp: p.tax_rate_bp,
      taxPaisa: p.tax_paisa,
      amountPaisa: p.amount_paisa,
      tenderedPaisa: p.tendered_paisa,
      changePaisa: p.change_paisa,
    })),
    cashierName: staffData?.name ?? "—",
    cashierCode: staffData?.code ?? "—",
    terminalName,
  };
}

/** Records one print (or reprint) of an order's invoice and returns its
 * 1-indexed sequence number for that order — 1 means this is the first
 * print, so buildReceiptDoc() renders no REPRINT marker; 2+ renders
 * "REPRINT #N". See record_invoice_print() (0030_printing_functions.sql)
 * for why this has to be an RPC rather than a direct insert. */
export async function recordInvoicePrint(orderId: string): Promise<number> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("record_invoice_print", { p_order_id: orderId });
  if (error) throw new Error(error.message);
  return data as number;
}

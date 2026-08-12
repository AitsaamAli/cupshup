import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * PRA eIMS submission — server only, per settle_order()'s own note
 * ("NOTE: transmit to PRA eIMS here", 0011_settlement_functions.sql).
 *
 * THIS IS NOT A REAL PRA INTEGRATION. Fiscal invoice numbers are issued
 * by PRA, not this app (Part 05) — actually calling their eIMS requires
 * a PRA-registered integration vendor's endpoint, credentials, and
 * certification, none of which exist in this environment. Everything
 * around the actual HTTP call — the queue, the retry/backoff, the
 * "print locally now, sync later" flow, the audit trail — is real and
 * ready; `callPraVendor()` below is the ONE function a vendor
 * integration replaces. Until `PRA_API_URL` is set, it returns a
 * clearly-marked mock result so the rest of the system is fully
 * testable without one.
 *
 * Uses the session-aware server client (lib/supabase/server.ts), not
 * the service-role admin client — record_pra_result()/
 * record_pra_failure() are SECURITY DEFINER and read current_staff()
 * from the caller's own session, same as every other RPC in this app,
 * so the audit trail correctly attributes who triggered each attempt.
 */

interface PraVendorResult {
  praInvoiceNo: string;
  praQrPayload: string;
}

class PraVendorError extends Error {}

async function callPraVendor(order: {
  invoiceNo: string;
  totalPaisa: number;
  outletNtn: string | null;
  outletStrn: string | null;
}): Promise<PraVendorResult> {
  const apiUrl = process.env.PRA_API_URL;

  if (!apiUrl) {
    // No vendor configured — mock, so the queue/retry/print pipeline
    // can be exercised end-to-end before a real integration exists.
    if (process.env.PRA_MOCK_FORCE_FAIL === "true") {
      throw new PraVendorError("MOCK: forced failure (PRA_MOCK_FORCE_FAIL=true)");
    }
    return {
      praInvoiceNo: `MOCK-${order.invoiceNo}`,
      praQrPayload: `MOCK-PRA-VERIFY:${order.invoiceNo}:${order.totalPaisa}`,
    };
  }

  // Real vendor call — shape is a placeholder; a PRA-registered vendor
  // supplies the actual request/response contract. Deliberately
  // isolated to this one function so wiring a real vendor in never
  // touches the queue/retry/route logic around it.
  const res = await fetch(apiUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.PRA_API_KEY ?? ""}`,
    },
    body: JSON.stringify({
      invoiceNo: order.invoiceNo,
      totalPaisa: order.totalPaisa,
      ntn: order.outletNtn,
      strn: order.outletStrn,
    }),
  });
  if (!res.ok) throw new PraVendorError(`PRA vendor returned ${res.status}`);
  const body = await res.json();
  if (!body.praInvoiceNo || !body.praQrPayload) {
    throw new PraVendorError("PRA vendor response missing praInvoiceNo/praQrPayload");
  }
  return { praInvoiceNo: body.praInvoiceNo, praQrPayload: body.praQrPayload };
}

export async function POST(request: Request) {
  let body: { orderId?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  const { orderId } = body;
  if (!orderId) return NextResponse.json({ error: "orderId is required" }, { status: 400 });

  const supabase = await createClient();

  const { data: order, error: orderError } = await supabase
    .from("orders")
    .select("id, invoice_no, total_paisa, outlet_id")
    .eq("id", orderId)
    .single();
  if (orderError || !order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }
  const orderRow = order as unknown as { id: string; invoice_no: string | null; total_paisa: number; outlet_id: string };
  if (!orderRow.invoice_no) {
    return NextResponse.json({ error: "Order has no invoice_no yet — settle it first" }, { status: 400 });
  }

  const { data: outlet } = await supabase
    .from("outlets")
    .select("ntn, strn")
    .eq("id", orderRow.outlet_id)
    .single();
  const outletRow = outlet as unknown as { ntn: string | null; strn: string | null } | null;

  try {
    const result = await callPraVendor({
      invoiceNo: orderRow.invoice_no,
      totalPaisa: orderRow.total_paisa,
      outletNtn: outletRow?.ntn ?? null,
      outletStrn: outletRow?.strn ?? null,
    });

    const { error: rpcError } = await supabase.rpc("record_pra_result", {
      p_order_id: orderId,
      p_pra_invoice_no: result.praInvoiceNo,
      p_qr_payload: result.praQrPayload,
    });
    if (rpcError) throw new Error(rpcError.message);

    return NextResponse.json(result satisfies PraVendorResult);
  } catch (err) {
    const message = (err as Error).message;
    const { data: queueId } = await supabase.rpc("enqueue_pra_submission", { p_order_id: orderId });
    if (queueId) {
      await supabase.rpc("record_pra_failure", { p_queue_id: queueId, p_error: message });
    }
    return NextResponse.json({ error: message, queued: true }, { status: 502 });
  }
}

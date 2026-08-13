// Permanent PROOF (not a pass/fail regression — there is no fix to
// regress-test yet) for the OPEN CRITICAL financial-integrity finding
// from the third-wave audit (docs/security-audit-2026-08-14-third-wave.md
// §H, confirmed live in Phase 4,
// docs/security-audit-2026-08-14-phase4-live-verification.md):
// voiding a SETTLED order makes its real payment silently disappear from
// cash reconciliation, with no compensating reversal record anywhere.
//
// This script creates one real order, settles it with a real cash
// payment, measures the outlet's cash_sales the same way
// close_business_day()/close_shift() compute it (sum of payments joined
// to orders WHERE status = 'settled'), voids the order, and measures it
// again. It does NOT assert pass/fail — it reports the numbers, because
// there is no fix yet to verify (this needs a product decision first,
// per the audit doc). Once a fix lands, this script should be turned
// into a real assertion of whatever the new invariant is.
//
// NOT self-cleaning: the order and its void are left in place
// deliberately, as this project has no delete-an-order operation by
// design (void, never delete) — same convention as concurrency-attack.mjs.

import { createClient } from "@supabase/supabase-js";

function requireEnv(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing ${name} — run with: node --env-file=.env.local scripts/live-audit/settled-order-void-invariant.mjs`);
    process.exit(1);
  }
  return v;
}

const url = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
const anonKey = requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");
const serviceKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
const OUTLET = requireEnv("NEXT_PUBLIC_SUPABASE_OUTLET_ID");

const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });

const { data: owner } = await admin.from("staff").select("id, user_id").eq("outlet_id", OUTLET).eq("role", "owner").limit(1).single();
const email = `staff-${owner.id}@staff.cupshup.internal`;
const { data: link } = await admin.auth.admin.generateLink({ type: "magiclink", email });
const client = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
await client.auth.verifyOtp({ type: "magiclink", token_hash: link.properties.hashed_token });

const { data: day } = await admin.from("business_days").select("id").eq("outlet_id", OUTLET).eq("status", "open").limit(1).maybeSingle();
if (!day) {
  console.error("No open business day for this outlet — open one first (open_business_day) then re-run.");
  process.exit(1);
}
const { data: item } = await admin.from("menu_items").select("id").eq("active", true).eq("is_86", false).limit(1).single();

async function cashSalesForDay() {
  const { data: orders } = await admin.from("orders").select("id,status").eq("business_day_id", day.id);
  const settledIds = orders.filter((o) => o.status === "settled").map((o) => o.id);
  if (settledIds.length === 0) return 0;
  const { data: payments } = await admin.from("payments").select("amount_paisa").in("order_id", settledIds).eq("method", "cash");
  return payments.reduce((s, p) => s + p.amount_paisa, 0);
}

const { data: placed } = await client.rpc("place_order", {
  p_outlet: OUTLET,
  p_order_type: "takeaway",
  p_items: [{ menu_item_id: item.id, qty: 1 }],
  p_idempotency_key: "invariant-proof-" + Date.now(),
});
const orderId = placed.order.id;

const { data: settled } = await client.rpc("settle_order", {
  p_order_id: orderId,
  p_payments: [{ method: "cash", base_paisa: placed.order.subtotal_paisa, tendered_paisa: placed.order.subtotal_paisa }],
  p_discount_paisa: 0,
  p_service_charge_paisa: 0,
  p_delivery_fee_paisa: 0,
});

const { data: paymentRow } = await admin.from("payments").select("amount_paisa").eq("order_id", orderId).single();
const before = await cashSalesForDay();

await client.rpc("void_order", { p_order_id: orderId, p_reason_code: "customer_cancel", p_reason_note: "live-audit invariant proof" });

const after = await cashSalesForDay();
const { data: paymentRowAfter } = await admin.from("payments").select("amount_paisa").eq("order_id", orderId).single();

console.log(`Order ${orderId}: settled for ${paymentRow.amount_paisa} paisa cash, then voided.`);
console.log(`cash_sales reconciliation BEFORE void: ${before} paisa`);
console.log(`cash_sales reconciliation AFTER void:  ${after} paisa`);
console.log(`payments row: unchanged at ${paymentRowAfter.amount_paisa} paisa (no reversal, no flag)`);

if (before - after === paymentRow.amount_paisa && paymentRowAfter.amount_paisa === paymentRow.amount_paisa) {
  console.log(
    "\n--- CONFIRMED (again): the settled payment vanished from reconciliation with zero compensating record. " +
      "OPEN CRITICAL — see docs/security-audit-2026-08-14-third-wave.md §H for the three proposed remediations. ---"
  );
} else {
  console.log("\n--- Numbers did not match the known-open defect's shape — behaviour may have changed. Re-investigate before assuming fixed. ---");
}

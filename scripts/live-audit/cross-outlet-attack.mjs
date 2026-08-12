// Permanent regression tool for Case A — cross-outlet write bypass.
// See scripts/live-audit/README.md. Safe to re-run: fully self-cleaning.

import { createClient } from "@supabase/supabase-js";

const url = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
const anonKey = requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");
const serviceKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
const REAL_OUTLET = requireEnv("NEXT_PUBLIC_SUPABASE_OUTLET_ID");

function requireEnv(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing ${name} — run with: node --env-file=.env.local scripts/live-audit/cross-outlet-attack.mjs`);
    process.exit(1);
  }
  return v;
}

const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });

let failures = 0;
async function expectRejected(label, fn) {
  try {
    const { error } = await fn();
    if (!error) {
      console.log(`[FAIL] ${label}: SUCCEEDED — should have been rejected. CROSS-OUTLET BYPASS.`);
      failures++;
    } else {
      console.log(`[PASS] ${label}: rejected (${error.message})`);
    }
  } catch (err) {
    console.log(`[FAIL] ${label}: threw unexpectedly — ${err.message}`);
    failures++;
  }
}
async function expectRowCount(label, fn, expected) {
  const { data, error } = await fn();
  if (error) {
    console.log(`[FAIL] ${label}: query errored — ${error.message}`);
    failures++;
    return;
  }
  if (data.length !== expected) {
    console.log(`[FAIL] ${label}: expected ${expected} rows, saw ${data.length}. LEAK.`);
    failures++;
  } else {
    console.log(`[PASS] ${label}: saw exactly ${expected} row(s)`);
  }
}

console.log("Setting up a throwaway second outlet + owner session...");
const { data: outlet2 } = await admin
  .from("outlets")
  .insert({ name: "AUDIT-OTHER-OUTLET", timezone: "Asia/Karachi", day_start_hour: 15 })
  .select()
  .single();
const { data: staff2 } = await admin
  .from("staff")
  .insert({ outlet_id: outlet2.id, code: "AUDIT-OWNER", name: "Audit Other Owner", role: "owner", active: true })
  .select()
  .single();
const email2 = `staff-${staff2.id}@staff.cupshup.internal`;
await admin.auth.admin.createUser({ email: email2, email_confirm: true, password: crypto.randomUUID() });
const { data: users } = await admin.auth.admin.listUsers({ perPage: 200 });
const user2 = users.users.find((u) => u.email === email2);
await admin.from("staff").update({ user_id: user2.id }).eq("id", staff2.id);
const { data: link2 } = await admin.auth.admin.generateLink({ type: "magiclink", email: email2 });
const anon2 = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
await anon2.auth.verifyOtp({ type: "magiclink", token_hash: link2.properties.hashed_token });
console.log("Other-outlet owner session minted. Attacking...\n");

// --- READ isolation (RLS SELECT side) ---
await expectRowCount("SELECT staff (real outlet)", () => anon2.from("staff").select("id").eq("outlet_id", REAL_OUTLET), 0);
await expectRowCount("SELECT orders (real outlet)", () => anon2.from("orders").select("id").eq("outlet_id", REAL_OUTLET), 0);
await expectRowCount("SELECT menu_categories (real outlet)", () => anon2.from("menu_categories").select("id").eq("outlet_id", REAL_OUTLET), 0);
await expectRowCount("SELECT daily_pl (owner-only view, real outlet)", () => anon2.from("daily_pl").select("*"), 0);

// --- WRITE isolation: direct p_outlet parameter ---
const { data: item } = await admin.from("menu_items").select("id").eq("active", true).limit(1).single();
await expectRejected("place_order(p_outlet = real outlet)", () =>
  anon2.rpc("place_order", {
    p_outlet: REAL_OUTLET,
    p_order_type: "dine_in",
    p_items: [{ menu_item_id: item.id, qty: 1 }],
    p_idempotency_key: "audit-xoutlet-" + Date.now(),
  })
);
await expectRejected("open_business_day(p_outlet = real outlet)", () =>
  anon2.rpc("open_business_day", { p_outlet: REAL_OUTLET, p_opening_float_paisa: 1000 })
);

// --- WRITE isolation: id-based, targeting a REAL order ---
const { data: realOrder } = await admin
  .from("orders")
  .select("id, status")
  .eq("outlet_id", REAL_OUTLET)
  .limit(1)
  .maybeSingle();

if (realOrder) {
  await expectRejected("void_order(real order id)", () =>
    anon2.rpc("void_order", { p_order_id: realOrder.id, p_reason_code: "customer_cancel" })
  );
  await expectRejected("advance_order_status(real order id)", () =>
    anon2.rpc("advance_order_status", { p_order_id: realOrder.id, p_new_status: "ready" })
  );
  await expectRejected("add_items_to_order(real order id)", () =>
    anon2.rpc("add_items_to_order", { p_order_id: realOrder.id, p_items: [{ menu_item_id: item.id, qty: 1 }] })
  );
  await expectRejected("settle_order(real order id)", () =>
    anon2.rpc("settle_order", {
      p_order_id: realOrder.id,
      p_payments: [{ method: "cash", base_paisa: 1 }],
      p_discount_paisa: 0,
      p_service_charge_paisa: 0,
      p_delivery_fee_paisa: 0,
    })
  );

  const { data: realItem } = await admin.from("order_items").select("id").eq("order_id", realOrder.id).limit(1).maybeSingle();
  if (realItem) {
    await expectRejected("advance_order_item_status(real order item id)", () =>
      anon2.rpc("advance_order_item_status", { p_order_item_id: realItem.id, p_new_status: "preparing" })
    );
  }
} else {
  console.log("[SKIP] id-based order attacks — no real order exists yet to target");
}

console.log("\nCleaning up throwaway rows...");
await admin.from("staff").delete().eq("outlet_id", outlet2.id);
await admin.from("outlets").delete().eq("id", outlet2.id);
await admin.auth.admin.deleteUser(user2.id);

console.log(failures === 0 ? "\n--- ALL PASS: cross-outlet isolation holds ---" : `\n--- ${failures} FAILURE(S) — CROSS-OUTLET BYPASS PRESENT ---`);
process.exit(failures === 0 ? 0 : 1);

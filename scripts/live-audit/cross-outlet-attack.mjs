// Permanent regression tool for Case A (cross-outlet write bypass,
// 2026-08-13) AND its second-wave siblings (2026-08-14, see
// docs/security-audit-2026-08-14-second-wave.md). See
// scripts/live-audit/README.md. Safe to re-run: fully self-cleaning.

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
// For direct table writes (no RPC): Postgrest doesn't return an error
// when an UPDATE/INSERT is blocked by RLS matching zero rows — it just
// returns an empty `data` array with no error. So "rejected" here means
// "affected/returned zero rows," not "threw an error."
async function expectNoRowsAffected(label, fn) {
  try {
    const { data, error } = await fn();
    if (error) {
      console.log(`[PASS] ${label}: rejected (${error.message})`);
      return;
    }
    if (Array.isArray(data) && data.length === 0) {
      console.log(`[PASS] ${label}: RLS matched zero rows`);
    } else {
      console.log(`[FAIL] ${label}: affected ${data?.length ?? "?"} row(s) — CROSS-OUTLET BYPASS.`);
      failures++;
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

// --- Second-wave (2026-08-14): siblings found by re-checking every
// other function that takes a foreign resource id the same way Finding A
// was found — see docs/security-audit-2026-08-14-second-wave.md. ---

const { data: realDay } = await admin
  .from("business_days")
  .select("id")
  .eq("outlet_id", REAL_OUTLET)
  .eq("status", "open")
  .limit(1)
  .maybeSingle();

if (realDay) {
  await expectRejected("close_business_day(real business_day id)", () =>
    anon2.rpc("close_business_day", { p_business_day_id: realDay.id, p_counted_cash_paisa: 0 })
  );

  const { data: realShift } = await admin
    .from("shifts")
    .select("id")
    .eq("business_day_id", realDay.id)
    .limit(1)
    .maybeSingle();
  if (realShift) {
    await expectRejected("close_shift(real shift id)", () =>
      anon2.rpc("close_shift", { p_shift_id: realShift.id, p_counted_cash_paisa: 0 })
    );
    await expectRejected("record_cash_movement(real shift id)", () =>
      anon2.rpc("record_cash_movement", { p_shift_id: realShift.id, p_type: "paid_in", p_amount_paisa: 100 })
    );
  } else {
    console.log("[SKIP] close_shift / record_cash_movement — no real open shift to target");
  }
} else {
  console.log("[SKIP] close_business_day / close_shift / record_cash_movement — no real open business day");
}

await expectRejected("change_item_price(real menu item id)", () =>
  anon2.rpc("change_item_price", { p_item_id: item.id, p_new_price_paisa: 999999 })
);
await expectRejected("toggle_86(real menu item id)", () => anon2.rpc("toggle_86", { p_item_id: item.id, p_is_86: true }));
await expectRejected("set_menu_item_active(real menu item id)", () =>
  anon2.rpc("set_menu_item_active", { p_item_id: item.id, p_active: false })
);
const { data: realCategory } = await admin.from("menu_categories").select("id").eq("outlet_id", REAL_OUTLET).limit(1).single();
await expectRejected("upsert_menu_item(real item id, own outlet's category)", () =>
  anon2.rpc("upsert_menu_item", { p_id: item.id, p_category_id: realCategory.id, p_name: "AUDIT-HIJACKED" })
);

const { data: realIngredient } = await admin.from("ingredients").select("id").eq("outlet_id", REAL_OUTLET).limit(1).maybeSingle();
if (realIngredient) {
  await expectRejected("upsert_recipe_line(real item + real ingredient id)", () =>
    anon2.rpc("upsert_recipe_line", { p_menu_item_id: item.id, p_ingredient_id: realIngredient.id, p_qty: 1 })
  );
  await expectRejected("record_purchase(real ingredient id)", () =>
    anon2.rpc("record_purchase", { p_ingredient_id: realIngredient.id, p_qty: 10, p_unit_cost_paisa: 500 })
  );
  await expectRejected("record_stock_count(real ingredient id)", () =>
    anon2.rpc("record_stock_count", { p_ingredient_id: realIngredient.id, p_counted_qty: 999 })
  );

  const { data: realPurchase } = await admin.from("purchases").select("id").eq("outlet_id", REAL_OUTLET).limit(1).maybeSingle();
  if (realPurchase) {
    await expectRejected("record_purchase_return(real purchase id + real ingredient id)", () =>
      anon2.rpc("record_purchase_return", { p_purchase_id: realPurchase.id, p_ingredient_id: realIngredient.id, p_qty: 1 })
    );
  } else {
    console.log("[SKIP] record_purchase_return — no real purchase to target");
  }
} else {
  console.log("[SKIP] recipe/inventory attacks — no real ingredient seeded for this outlet");
}

// --- Direct-table RLS bypass attempts — no RPC involved at all, proving
// the 0037 policy fix (not just the 0036 RPC fix) actually holds. The
// second-outlet owner genuinely holds role 'owner', so a role-only USING
// clause would have let every one of these through before 0037. ---
await expectNoRowsAffected("direct UPDATE menu_items (real item, bypassing the RPC)", () =>
  anon2.from("menu_items").update({ name: "AUDIT-RLS-BYPASS" }).eq("id", item.id).select()
);
if (realIngredient) {
  await expectNoRowsAffected("direct INSERT recipe_lines (real item + real ingredient, bypassing the RPC)", () =>
    anon2.from("recipe_lines").insert({ menu_item_id: item.id, ingredient_id: realIngredient.id, qty: 1 }).select()
  );
}

console.log("\nCleaning up throwaway rows...");
await admin.from("staff").delete().eq("outlet_id", outlet2.id);
await admin.from("outlets").delete().eq("id", outlet2.id);
await admin.auth.admin.deleteUser(user2.id);

console.log(failures === 0 ? "\n--- ALL PASS: cross-outlet isolation holds ---" : `\n--- ${failures} FAILURE(S) — CROSS-OUTLET BYPASS PRESENT ---`);
process.exit(failures === 0 ? 0 : 1);

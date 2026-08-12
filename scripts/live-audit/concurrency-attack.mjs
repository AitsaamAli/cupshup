// Permanent regression tool for Case B — idempotency under real
// concurrency. See scripts/live-audit/README.md. Safe to re-run: every
// order it creates uses a fresh, uniquely-timestamped idempotency key
// and is left in place as an ordinary (if clearly test-flavoured)
// order — this project has no "delete an order" operation by design
// (Part 09: void, never delete), so cleanup here means voiding, not
// deleting. Voiding is skipped by default; pass --void to also void
// every order this script creates.

import { createClient } from "@supabase/supabase-js";

function requireEnv(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing ${name} — run with: node --env-file=.env.local scripts/live-audit/concurrency-attack.mjs`);
    process.exit(1);
  }
  return v;
}

const url = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
const anonKey = requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");
const serviceKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
const OUTLET = requireEnv("NEXT_PUBLIC_SUPABASE_OUTLET_ID");

const CONCURRENCY = Number(process.env.AUDIT_CONCURRENCY ?? 20);
const ROUNDS = Number(process.env.AUDIT_ROUNDS ?? 5);
const SHOULD_VOID = process.argv.includes("--void");

const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });

// Reuse (or mint) a real staff session — the project's own demo
// cashier if present, otherwise the first active staff member found.
const { data: staffRow } = await admin.from("staff").select("id, user_id, name").eq("outlet_id", OUTLET).eq("active", true).limit(1).single();
if (!staffRow.user_id) {
  const email = `staff-${staffRow.id}@staff.cupshup.internal`;
  await admin.auth.admin.createUser({ email, email_confirm: true, password: crypto.randomUUID() });
  const { data: users } = await admin.auth.admin.listUsers({ perPage: 200 });
  const user = users.users.find((u) => u.email === email);
  await admin.from("staff").update({ user_id: user.id }).eq("id", staffRow.id);
  staffRow.user_id = user.id;
}
const email = `staff-${staffRow.id}@staff.cupshup.internal`;
const { data: link } = await admin.auth.admin.generateLink({ type: "magiclink", email });
const client = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
await client.auth.verifyOtp({ type: "magiclink", token_hash: link.properties.hashed_token });
console.log(`Session minted for ${staffRow.name}. Firing ${ROUNDS} rounds of ${CONCURRENCY} concurrent place_order() calls...\n`);

const { data: item } = await admin.from("menu_items").select("id").eq("active", true).eq("is_86", false).limit(1).single();

let failures = 0;
const createdOrderIds = [];

for (let round = 1; round <= ROUNDS; round++) {
  const idKey = `audit-concurrency-${Date.now()}-${round}`;
  const calls = Array.from({ length: CONCURRENCY }, () =>
    client.rpc("place_order", {
      p_outlet: OUTLET,
      p_order_type: "takeaway",
      p_items: [{ menu_item_id: item.id, qty: 1 }],
      p_idempotency_key: idKey,
    })
  );
  const results = await Promise.all(calls);
  const errors = results.filter((r) => r.error);
  const { data: orders } = await admin.from("orders").select("id").eq("idempotency_key", idKey);

  const ok = orders.length === 1 && errors.length === 0;
  console.log(
    `${ok ? "[PASS]" : "[FAIL]"} round ${round}: ${orders.length} order(s) created, ${errors.length} raw error(s)` +
      (errors.length ? ` — ${errors.map((e) => e.error.message).join("; ")}` : "")
  );
  if (!ok) failures++;
  if (orders[0]) createdOrderIds.push(orders[0].id);
}

if (SHOULD_VOID && createdOrderIds.length) {
  console.log(`\nVoiding ${createdOrderIds.length} test order(s) (--void was passed)...`);
  for (const id of createdOrderIds) {
    try {
      await admin.rpc("void_order", { p_order_id: id, p_reason_code: "training" });
    } catch {
      // best-effort cleanup — a failed void here doesn't affect the
      // attack's own pass/fail result above, already recorded
    }
  }
}

console.log(
  failures === 0
    ? `\n--- ALL PASS: ${ROUNDS * CONCURRENCY} concurrent calls, always exactly 1 order, zero raw errors ---`
    : `\n--- ${failures}/${ROUNDS} round(s) FAILED — idempotency race present ---`
);
process.exit(failures === 0 ? 0 : 1);

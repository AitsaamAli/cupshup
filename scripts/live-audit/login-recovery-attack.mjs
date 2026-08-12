// Permanent regression tool for Case C — partial first-login
// provisioning failure must be recoverable, never a permanent lockout.
// See scripts/live-audit/README.md. Safe to re-run: fully self-cleaning.
//
// Reproduces the exact failure mode found live 2026-08-13: a staff
// member's auth.users row gets created on first login, but the
// staff.user_id link update never runs (a crash, a network blip —
// anything between the two calls). Before the fix
// (app/api/auth/pin/route.ts's findUserByEmail() self-heal), every
// subsequent login attempt re-hit createUser() against the same
// deterministic email and failed with "already registered" forever.
//
// This script can't call the Next.js route handler directly (no
// running server assumed) — it reproduces the ROUTE'S OWN LOGIC against
// the real Auth API instead: same createUser() call, same deliberate
// non-link to simulate the crash, same recovery lookup the fixed route
// now performs.

import { createClient } from "@supabase/supabase-js";

function requireEnv(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing ${name} — run with: node --env-file=.env.local scripts/live-audit/login-recovery-attack.mjs`);
    process.exit(1);
  }
  return v;
}

const url = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
const serviceKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
const OUTLET = requireEnv("NEXT_PUBLIC_SUPABASE_OUTLET_ID");

const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });

let failures = 0;

console.log("Creating a throwaway staff member with no linked auth user...");
const { data: staff } = await admin
  .from("staff")
  .insert({ outlet_id: OUTLET, code: "AUDIT-RECOVERY", name: "Audit Recovery Test", role: "cashier", active: true })
  .select()
  .single();
const email = `staff-${staff.id}@staff.cupshup.internal`;

// --- Attempt 1: simulates a first login that creates the auth user
// but "crashes" before linking staff.user_id (deliberately skip the link).
console.log("Attempt 1: create the auth user, deliberately DON'T link it (simulates a crash)...");
const { data: created1, error: createErr1 } = await admin.auth.admin.createUser({
  email,
  email_confirm: true,
  password: crypto.randomUUID(),
});
if (createErr1) {
  console.log("[FAIL] first createUser itself failed unexpectedly:", createErr1.message);
  failures++;
} else {
  console.log(`[PASS] auth user created (${created1.user.id}), staff.user_id deliberately left null`);
}

// --- Attempt 2: simulates the staff member trying to log in again.
// Before the fix, this createUser() call fails with "already
// registered" and the route gave up — permanent lockout. After the
// fix, it looks the existing user up by the same deterministic email
// and links it instead.
console.log("Attempt 2: re-attempt provisioning (this is where the old code permanently locked out)...");
const { data: created2, error: createErr2 } = await admin.auth.admin.createUser({
  email,
  email_confirm: true,
  password: crypto.randomUUID(),
});

let recoveredUserId = null;
if (createErr2) {
  const alreadyExists = createErr2.message?.toLowerCase().includes("already been registered");
  if (!alreadyExists) {
    console.log("[FAIL] unexpected error on second attempt:", createErr2.message);
    failures++;
  } else {
    console.log("[PASS] second createUser correctly reports already-registered (expected — this is the exact failure mode)");
    // This is the self-healing step app/api/auth/pin/route.ts's
    // findUserByEmail() now performs — reproduced here directly.
    let page = 1;
    for (;;) {
      const { data } = await admin.auth.admin.listUsers({ page, perPage: 200 });
      const match = data.users.find((u) => u.email === email);
      if (match) {
        recoveredUserId = match.id;
        break;
      }
      if (!data || data.users.length < 200) break;
      page += 1;
    }
    if (recoveredUserId) {
      console.log(`[PASS] self-heal recovered the existing user id: ${recoveredUserId}`);
    } else {
      console.log("[FAIL] self-heal lookup did NOT find the existing user — recovery is broken");
      failures++;
    }
  }
} else {
  console.log("[FAIL] second createUser SUCCEEDED — Supabase allowed a duplicate email, unexpected");
  failures++;
  recoveredUserId = created2.user.id;
}

if (recoveredUserId) {
  const { error: linkErr } = await admin.from("staff").update({ user_id: recoveredUserId }).eq("id", staff.id);
  if (linkErr) {
    console.log("[FAIL] linking the recovered user id back to staff failed:", linkErr.message);
    failures++;
  } else {
    console.log("[PASS] staff.user_id successfully linked after recovery — this staff member can now log in normally");
  }
}

console.log("\nCleaning up...");
await admin.from("staff").delete().eq("id", staff.id);
if (recoveredUserId) await admin.auth.admin.deleteUser(recoveredUserId);

console.log(failures === 0 ? "\n--- ALL PASS: first-login provisioning is recoverable, no permanent lockout ---" : `\n--- ${failures} FAILURE(S) ---`);
process.exit(failures === 0 ? 0 : 1);

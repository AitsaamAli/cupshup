// Permanent regression tool for the Phase 4 (2026-08-14) live-only
// finding: verify_staff_pin() was directly callable by a completely
// unauthenticated `anon` client, because `revoke all ... from public`
// (used throughout this codebase) does not touch the direct EXECUTE
// grant Supabase's project bootstrap gives anon/authenticated on every
// public-schema function by default. Fixed in
// 0042_verify_staff_pin_grant_fix.sql, which explicitly revokes from
// anon and authenticated too. See scripts/live-audit/README.md and
// docs/security-audit-2026-08-14-phase4-live-verification.md.
//
// This is the one function where that gap was actually exploitable:
// every other SECURITY DEFINER function still gets rejected by its own
// internal current_staff()/has_role() check even when directly callable
// (anon has no auth.uid(), so current_staff() returns null) — but
// verify_staff_pin is deliberately callable with NO session yet (that's
// its whole purpose), so it has no such internal check.
//
// PASS means: the RPC call fails with a genuine Postgres permission
// error (SQLSTATE 42501, "permission denied for function") — proving
// the call never even reached the function body. FAIL means it reached
// the function's own logic (any other error, or success) — proving
// EXECUTE is still open to anon.

import { createClient } from "@supabase/supabase-js";

function requireEnv(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing ${name} — run with: node --env-file=.env.local scripts/live-audit/pin-grant-isolation.mjs`);
    process.exit(1);
  }
  return v;
}

const url = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
const anonKey = requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");

// Deliberately a bare, fully unauthenticated client — no login, no
// session, nothing beyond the public anon key any browser bundle ships.
const anon = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });

const { error } = await anon.rpc("verify_staff_pin", {
  p_staff_id: "00000000-0000-0000-0000-000000000000",
  p_pin: "0000",
});

if (error && error.code === "42501") {
  console.log(`[PASS] anon cannot execute verify_staff_pin at all (${error.message})`);
  process.exit(0);
} else {
  console.log(
    `[FAIL] anon reached verify_staff_pin's own logic — EXECUTE grant is open. ` +
      `Response: ${error ? `${error.code}: ${error.message}` : "call succeeded (!)"}`
  );
  console.log("--- CRITICAL: unauthenticated PIN brute-force is possible against the real database ---");
  process.exit(1);
}

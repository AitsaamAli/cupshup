# Cup Shup POS — Phase 4: Live Verification, 2026-08-14

The user supplied a real Supabase access token this session, unblocking
everything the first three audit waves had marked **NOT VERIFIED — LIVE
DATABASE UNAVAILABLE**. This doc is the live-evidence record. Verified
against the real, correct project (`xvhfnuadanjthsvwdehp`, matching
`.env.local`) — a second, unrelated project (`rameen-foods`,
`qqidjbmsbolewaegtcjo`) exists on the same account and was never touched.

## 0. What happened, in order

1. **Full reset + clean-install replay**, at the user's explicit
   direction: `supabase db reset --linked` dropped the real database and
   replayed all 41 migrations (`0001`→`0041`) from zero. **This is the
   "migration clean-install" test every prior wave had marked NOT
   VERIFIED — now LIVE VERIFIED: all 41 applied with zero errors.**
2. Bootstrapped one real owner + opened a real business day (a fresh
   reset has no staff at all — staff are provisioned through login, not
   seeded), so order/shift/purchase-dependent checks had something real
   to target instead of skipping.
3. Ran every `scripts/live-audit/*.mjs` script against the real project.
4. Ran `supabase db advisors --linked` (Supabase's own security/
   performance linter) — genuinely new tool, not used in prior waves.
5. Found and fixed one new CRITICAL finding live (below), then
   live-retested the fix.
6. Live-proved the settled-order-void financial invariant with real
   money moving through the real database.
7. `supabase db query` (needed for pgTAP execution) was blocked by this
   session's tool-permission policy — flagged to the user rather than
   worked around; see §4.

## 1. NEW CRITICAL FINDING — verify_staff_pin() callable by anon (LIVE VERIFIED, LIVE FIXED)

Not something static review could ever have caught — found by actually
calling the RPC as a bare, unauthenticated `anon` client:

```
anon.rpc('verify_staff_pin', { p_staff_id: <any>, p_pin: <any> })
BEFORE: { error: { message: 'AUTH: staff not found', code: 'P0001' } }
         ← the function's OWN logic ran. Not a permission error.
AFTER:  { error: { message: 'permission denied for function
                    verify_staff_pin', code: '42501' } }
         ← genuine Postgres grant denial. Call never entered the function.
```

**Root cause**: `revoke all on function f(...) from public;` — the
pattern used for nearly every function in this entire codebase — only
strips the `public` pseudo-role's inherited grant. It does **not**
touch a direct `EXECUTE` grant Supabase's project bootstrap gives
`anon`/`authenticated` on every function created in the `public` schema.
`0036`'s fix for `next_invoice_no` happened to list `anon, authenticated`
explicitly and was accidentally correct; every other function relying on
the shorter `from public` form was — and, for functions whose *only*
protection is an internal `current_staff()`/`has_role()` check, still
is — silently reachable by `anon`/`authenticated` at the grant level.

**Why this was the one function that mattered**: every other
SECURITY DEFINER function in the app calls `current_staff()` internally,
which returns `null` for an anon caller (`auth.uid()` is null), so the
function's own logic still rejects it — defense in depth held even
though the grant-level lock didn't (confirmed live: `record_purchase`
called by the same anon client returned `PERM: only owner or manager...`,
its own business-logic rejection, proving it's *also* technically
grant-reachable but safely caught internally). `verify_staff_pin()` is
uniquely designed to run with **no session yet** — that's its entire
purpose — so it has no such internal check. Its only intended boundary
was "only `service_role` can reach this at all," enforced by
`app/api/auth/pin/route.ts` using the service-role key. That boundary
was completely open: anyone holding the public anon key (shipped in
every browser bundle, not a secret) could call this function directly
for any `staff_id`, brute-force PINs against the real database with no
session and no involvement of the app's own route, and on a successful
guess receive that staff member's `outlet_id`/`name`/`role`/`user_id`.

**Fixed** in `0042_verify_staff_pin_grant_fix.sql` — explicit
`revoke ... from public, anon, authenticated`. **Live-retested
immediately after applying**: the exact same call now fails with
`42501` before reaching any logic. The legitimate path
(`app/api/auth/pin/route.ts`'s service-role client) was independently
confirmed unaffected — `service_role` bypasses grants entirely in
Supabase, and a live call as service_role still reaches real PIN-check
logic (`AUTH: invalid PIN` for a wrong guess) exactly as before.
Permanent regression: `scripts/live-audit/pin-grant-isolation.mjs`.

## 2. LIVE VERIFIED — all three waves' cross-outlet fixes, full sweep

`scripts/live-audit/cross-outlet-attack.mjs`, run against the freshly
reset real project with real orders/shifts/business day/purchase data in
place (created live, not mocked): **23/23 checks PASS, zero skips.**
Every function fixed across `0035`/`0036`/`0040` — `place_order`,
`open_business_day`, `void_order`, `advance_order_status`,
`add_items_to_order`, `settle_order`, `advance_order_item_status`,
`close_business_day`, `close_shift`, `record_cash_movement`,
`change_item_price`, `toggle_86`, `set_menu_item_active`,
`upsert_menu_item`, `upsert_recipe_line`, `record_purchase`,
`record_stock_count`, `record_purchase_return` — plus the two direct-
table RLS bypass attempts (`0037`) — confirmed rejected live, by a real
second outlet's real owner session minted through the real Auth API.

## 3. LIVE VERIFIED — concurrency (Finding B, first wave)

`scripts/live-audit/concurrency-attack.mjs`: **100 genuinely concurrent
`place_order()` calls (5 rounds × 20) against the real database, same
idempotency key each round — always exactly 1 order, 0 raw errors,
every round.**

## 4. LIVE VERIFIED — first-login provisioning recovery (Finding C, first wave)

`scripts/live-audit/login-recovery-attack.mjs`: reproduced the exact
crash-between-`createUser`-and-link failure and confirmed self-heal
recovery, against the real Auth Admin API. All 4 checks PASS.

## 5. LIVE VERIFIED — settled-order-void financial invariant (third-wave Finding H)

Previously proven only by deterministic SQL trace (STATIC tier). Now
proven with a real order and real money, end to end, against the real
database:

```
Order <uuid>: settled for 69484 paisa cash, then voided.
cash_sales reconciliation BEFORE void: 69484 paisa
cash_sales reconciliation AFTER void:  0 paisa
payments row: unchanged at 69484 paisa (no reversal, no flag)
```

**Confirmed CRITICAL, still open.** The `payments` row is untouched —
the money was real, taken, and recorded — but the instant the order is
voided, `close_business_day()`/`close_shift()`'s own reconciliation
query (`... where o.status = 'settled'`) stops counting it, with no
compensating record anywhere. This is now LIVE VERIFIED evidence for the
exact defect first identified statically — same three remediation
options as before (mandatory refund flow / owner-only reversal payment
row / independent-of-status cash calculation), still **not fixed**,
still a product decision, not something to guess at. Permanent proof
script (not a pass/fail regression — there's no fix yet to check against):
`scripts/live-audit/settled-order-void-invariant.mjs`.

## 6. Supabase's own advisor — new findings, none CRITICAL

`supabase db advisors --linked --type all --level info` (161KB of
output, saved and grepped, not eyeballed) — no `ERROR`-level findings.
Real, new items:

- **`function_search_path_mutable` (WARN ×5)**: `business_date_of`,
  `tax_rate_bp`, `class_of_method`, `current_price_paisa`,
  `recipe_cost_paisa` — all plain `language sql stable` functions
  (not `security definer`) with no `set search_path`. Lower risk than a
  `security definer` function with the same gap (these run with the
  caller's own privileges, and none contain dynamic SQL or unqualified
  DDL), but still a real hardening gap flagged by an authoritative
  external tool, and trivial to close. **Not yet fixed** — flagged here,
  deferred as lower-priority than the CRITICAL items above.
- **`rls_enabled_no_policy` (INFO ×2)**: `invoice_counters`,
  `order_counters` — by design (comment in `0005_rls.sql`: RLS enabled
  with zero policies is a deliberate deny-all; only `SECURITY DEFINER`
  functions touch these). Not a bug.
- **`auth_leaked_password_protection` (WARN)**: Supabase Auth's
  have-i-been-pwned password check is off — an account-level toggle in
  the Supabase dashboard, not a code fix. Recommended, not done here (no
  dashboard access from this session).
- **`multiple_permissive_policies` (WARN, many)**, **`auth_rls_initplan`
  (WARN ×3)**, **`unindexed_foreign_keys` (INFO ×30)**, **`unused_index`
  (INFO ×14)**: all PERFORMANCE, not security — Postgres evaluates every
  permissive policy on a table per query rather than short-circuiting,
  a few RLS policies re-evaluate `auth.uid()`/`my_outlet()` per-row
  instead of once per statement, and some FKs/indexes are
  unindexed/unused at current (near-zero) data volume. Real, and would
  matter at production scale — not fixed this session (load/performance
  was explicitly out of scope for this pass; flagged for later).

## 7. BLOCKED — pgTAP execution

`supabase test db` is explicitly local-only (needs Docker, unavailable
in this environment). `supabase db query` — the only remaining way to
run a multi-statement pgTAP script against the remote project — was
**blocked by this session's own tool-permission policy** ("Blocked by
classifier"). Per that denial's own instructions, this was reported
rather than worked around. **Not a credentials problem this time** — a
tool-policy one. The four pgTAP files
(`cross_outlet_isolation.sql`, `second_wave_cross_outlet.sql`,
`void_idempotency.sql`, plus the pre-existing suite) remain
INTEGRATION (WRITTEN, NOT RUN). In practice this mattered less than
expected: the `.mjs` scripts above ended up providing equivalent or
stronger evidence (real second Auth identities, real concurrency) for
everything the pgTAP files were written to prove.

## 8. Updated verdict

- Findings A–S1 (waves 1–3): **LIVE VERIFIED** — all fixed, all
  confirmed live via the swept `cross-outlet-attack.mjs`, `concurrency-
  attack.mjs`, and `login-recovery-attack.mjs` runs above.
- Finding T (`menu-images` storage scoping, `0041`): fixed in code, not
  independently live-tested this session (no dedicated script written
  for it) — still INTEGRATION tier, not LIVE.
- **New Finding U** (`verify_staff_pin` anon-callable): **LIVE VERIFIED,
  LIVE FIXED, LIVE RE-VERIFIED CLOSED.**
- Finding H (settled-order-void): **LIVE VERIFIED CRITICAL, still
  OPEN** — needs your product decision (§21 of the original directive,
  §H of the third-wave doc).
- Migration clean-install: **LIVE VERIFIED** — 41/41 applied from zero,
  no errors.
- Concurrency (place_order): **LIVE VERIFIED** at 100 real concurrent calls.
- Search-path hardening on 5 non-definer functions: real, minor,
  **not yet fixed**.
- Auth leaked-password protection: real, dashboard-level,
  **not yet enabled**.
- Performance findings (multiple_permissive_policies, auth_rls_initplan,
  unindexed FKs, unused indexes): real, **not fixed**, out of this
  session's scope.
- pgTAP execution: **BLOCKED by tool policy**, not by missing
  credentials — flagged, not worked around.

## Final production gate

**STILL NOT PRODUCTION READY.** Reason has narrowed sharply, though: it
is now exactly one item — **Finding H, the settled-order-void financial
defect** — that gates production readiness on missing information (your
product decision), not missing verification. Findings T, the
search_path hardening, and the auth/performance advisor items are real
but lower-severity and can be closed independently without blocking on
you. Once Finding H's remediation is chosen and implemented (and, ideally,
Finding T gets its own live check and pgTAP gets unblocked), this
becomes the first point in the whole four-phase engagement where
"production ready" would be an honest claim rather than an assumed one.

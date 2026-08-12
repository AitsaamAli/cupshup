# Cup Shup POS — Live Adversarial Audit, 2026-08-13

**What this is:** the first time in this project's 20-part build that
the application was actually run in a browser and attacked with real
requests against the real linked Supabase project, rather than verified
by schema inspection and mocked-client unit tests. It found five real
bugs — one of them CRITICAL — none of which any prior part's testing
had a way to catch, because none of them exercised a real HTTP request
against the live auth/RPC stack end to end.

This doc is the incident record. `scripts/live-audit/` holds the
permanent, re-runnable proof for the two findings that need real
concurrency or a real second identity (things no pgTAP/Vitest test can
express); `supabase/tests/database/cross_outlet_isolation.sql` and
`tests/{middleware,auth-otp}.test.ts` hold the rest as ordinary,
CI-runnable regression tests.

---

## Findings

| Case | Title | Severity | Root cause | Fix |
|---|---|---|---|---|
| D | `/api/auth/pin` redirected to `/login` | High | `middleware.ts`'s matcher never excluded `api/*` — the PIN-verification call itself, made with no session yet, was redirected before it could run | Excluded `api/` from the matcher |
| E | `verifyOtp` rejected `email` + `token_hash` together | High | This project's GoTrue version rejects the combination outright | Send only `token_hash` + `type` (`lib/auth-otp.ts`) |
| — | `crypt()`/`gen_salt()` unreachable | High | `pgcrypto` lives in Supabase's `extensions` schema on this project, not `public`; every `SECURITY DEFINER` function restricts `search_path` to `public` for security | Added `extensions` to `verify_staff_pin()`/`set_staff_pin()`'s search_path |
| B | `place_order()` race-window error leak | Medium | SELECT-then-INSERT dedup check has an inherent gap between the two statements under true concurrency | Catch `unique_violation` around the insert, return the winning row |
| C | First-login provisioning permanent lockout | Medium | If `staff.user_id` linking fails after `auth.users` creation, every retry re-hits the same deterministic email and fails forever | Look the existing user up by email and link it instead of failing |
| A | **Cross-outlet write bypass** | **CRITICAL** | Every write RPC in the order/KDS/printing/business-day path checked WHO the caller is but never WHICH OUTLET the row belonged to | Added an explicit outlet-ownership check to all 13 affected functions |

D and E were found and fixed first, while getting the login screen to
work at all. Fixing them exposed the pgcrypto bug immediately behind
it. Once login worked, a live order-lifecycle test (place → KDS →
settle, with independent tax reconciliation) passed cleanly, which
prompted the concurrency stress test (finding B) and the cross-outlet
test (finding A) — the two things a "does it work once" pass can never
catch.

## Finding A in detail — why it matters most

Reproduced live: a completely separate, throwaway outlet was created
with its own real owner session (minted through the actual PIN→session
flow, not a shortcut). That session then called
`place_order(p_outlet = <the real outlet's id>)` — and it succeeded,
writing a genuine order into the real outlet's data as an impostor.

RLS's `SELECT` side (`outlet_id = my_outlet()`, Part 04) was
independently re-confirmed correct in the same run — the other
outlet's owner saw zero rows from the real outlet through ordinary
queries. The gap was specific to `SECURITY DEFINER` functions: they run
with the function owner's privileges precisely so they can bypass RLS
for their own legitimate purpose (writing into tables whose direct
`INSERT`/`UPDATE` grants are revoked, Part 04's own design) — which
means they are also the one place RLS's protection does **not** apply
for free, and has to be re-asserted by hand. Thirteen functions across
Parts 09, 10, 17, and 19 had this gap; two other function families —
`0020_expenses_functions.sql` and `0019_business_day_functions.sql`'s
shift functions — already did this correctly from the start
(`where id = p_expense_id and outlet_id = v_staff.outlet_id`), which is
exactly the standard every affected function was brought up to in
`0035_cross_outlet_isolation_fix.sql`.

This project has run as a single-outlet deployment for its entire
build, which is exactly why this was never caught before: with nothing
to leak to, the bug was silent. The moment a second outlet exists —
which the platform this runs on (Supabase, one project can genuinely
host multiple outlets/tenants) makes entirely plausible — it becomes a
real, exploitable path for one business's staff to write into another
business's financial records.

## What's permanently guarding against regression

- `scripts/live-audit/cross-outlet-attack.mjs` — 11 checks: 4 SELECT-side
  RLS confirmations, 2 direct-`p_outlet`-parameter attacks, 5 id-based
  attacks against a real order (`void_order`, `advance_order_status`,
  `add_items_to_order`, `settle_order`, `advance_order_item_status`).
- `scripts/live-audit/concurrency-attack.mjs` — 100 genuinely concurrent
  `place_order()` calls (5 rounds × 20), asserting exactly one order and
  zero raw errors every round.
- `scripts/live-audit/login-recovery-attack.mjs` — reproduces the exact
  crash-between-two-calls failure and confirms the same staff member
  can still recover.
- `supabase/tests/database/cross_outlet_isolation.sql` — the parts of
  Case A expressible in a single pgTAP session (identity-switching via
  `set_config`, no real concurrency needed for this class of bug):
  6 assertions, run live, all passing.
- `tests/middleware.test.ts` / `tests/auth-otp.test.ts` — Cases D and E,
  ordinary Vitest, run on every `npm test`.

None of the three `scripts/live-audit/*.mjs` files can run inside
`npm test` — they need a real service-role key and a real network
round trip to Supabase's Auth Admin API, which is exactly why they're
scripts, not Vitest specs. They should be re-run by hand after any
change to a `SECURITY DEFINER` function that accepts an outlet id or a
row id, or after any change to `place_order()`'s dedup logic or the
login route's provisioning logic — `scripts/live-audit/README.md` has
the exact commands.

## What this audit did NOT cover

Per the same "mark it unverified, never fake a pass" standard the audit
itself was run under:

- Mutation testing, property-based testing — no framework for either
  exists in this project.
- Load testing at 1k/10k/100k order scale — this outlet has real order
  volume in the tens, not thousands; running that against the live
  linked project wasn't judged worth the load it would put on it for a
  scale this deployment won't see for a long time.
- A real backup/restore drill — an infrastructure/plan decision
  (`docs/monitoring-and-backup.md` §3), not something to fake here.
- Migration-from-a-clean-database testing — no Docker/local Supabase
  stack available in this environment.
- The full Playwright E2E suite (`e2e/*.spec.ts`, Part 20) — written,
  still not executed; this audit's live testing used direct RPC calls
  (faster, and what actually found the bugs above) rather than full
  browser automation.

These remain **NOT VERIFIED**, explicitly, not silently assumed fine.

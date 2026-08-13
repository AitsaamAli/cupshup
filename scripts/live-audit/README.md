# scripts/live-audit

Real, live regression scripts for the two defect classes found during
this project's live adversarial audit that **cannot** be expressed as a
pgTAP test (single Postgres session) or a Vitest test (mocked client):
true cross-process concurrency, and a genuine second-tenant identity
minted through the real Auth API.

These are not scratch files — they are the permanent evidence and
re-verification tool for **Case A** (cross-outlet write bypass) and
**Case B** (idempotency race under real concurrency), matching the
regression-case numbering in the adversarial audit protocol these were
written against.

## Running them

Both read from the same env vars `.env.local` already defines
(`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
`SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SUPABASE_OUTLET_ID`) — never
hard-coded, so this directory is safe to commit. Node 20+'s built-in
`--env-file` loads them without needing `dotenv` as a dependency:

```sh
node --env-file=.env.local scripts/live-audit/cross-outlet-attack.mjs
node --env-file=.env.local scripts/live-audit/concurrency-attack.mjs
node --env-file=.env.local scripts/live-audit/login-recovery-attack.mjs
node --env-file=.env.local scripts/live-audit/pin-grant-isolation.mjs
node --env-file=.env.local scripts/live-audit/settled-order-void-invariant.mjs
```

Both are fully self-cleaning: every row they create (a throwaway
outlet, throwaway staff, throwaway orders, a throwaway `auth.users`
row) is deleted at the end of the script, whether it passes or fails.
Safe to run repeatedly against the real linked project.

## What each proves

- **`cross-outlet-attack.mjs`** — creates a second, completely
  unrelated outlet with its own real staff session, then attempts to
  read and write the real outlet's data through every write RPC that
  takes an outlet id or a row id belonging to that outlet across all
  three audit waves (order/KDS/printing/business-day/shift/menu/
  recipe/inventory/purchase functions — 21 RPC checks) plus two direct-
  table RLS bypass attempts. Every one must reject — never succeed,
  never leak a different error that would confirm the row exists in
  another tenant. 23/23 LIVE VERIFIED 2026-08-14 (Phase 4) — see
  `docs/security-audit-2026-08-14-phase4-live-verification.md`.
- **`concurrency-attack.mjs`** — fires N genuinely concurrent
  `place_order()` calls (default 20, five rounds) with the SAME
  idempotency key and asserts exactly one order was created and zero
  callers received a raw database error. Pass `--void` to also void
  every test order it creates. LIVE VERIFIED at 100 real concurrent
  calls, 2026-08-14.
- **`login-recovery-attack.mjs`** — reproduces a first-login
  provisioning failure (the `auth.users` row gets created, the
  `staff.user_id` link never runs) and confirms the SAME staff member
  can still recover on their next attempt instead of being permanently
  locked out.
- **`pin-grant-isolation.mjs`** — calls `verify_staff_pin()` as a bare,
  fully unauthenticated `anon` client (no session at all) and asserts
  the call fails with a genuine Postgres permission error (`42501`),
  not the function's own logic. Regression for the Phase 4 live-only
  finding: `revoke all ... from public` never actually blocked `anon`/
  `authenticated` execute — fixed in
  `0042_verify_staff_pin_grant_fix.sql`.
- **`settled-order-void-invariant.mjs`** — NOT a pass/fail regression
  (there's no fix yet to check against): settles a real order with real
  cash, measures cash reconciliation, voids it, measures again, and
  reports whether the payment vanished with no compensating record.
  Proves the still-OPEN CRITICAL financial-integrity finding on demand.

## History

First run 2026-08-13 against the real project found the cross-outlet
bypass (P0, fixed in `0035_cross_outlet_isolation_fix.sql`) and the
idempotency race (fixed in `0034_place_order_race_fix.sql`). Both
scripts pass cleanly as of that fix. Re-run after any change to
`place_order`, `settle_order`, `void_order`, `advance_order_status`,
`add_items_to_order`, or any other SECURITY DEFINER function that takes
an outlet id or a row id — see `docs/security-audit-2026-08-13.md` for
the full incident writeup.

`cross-outlet-attack.mjs` was extended 2026-08-14 with checks for 12
more sibling functions/policies found the same way — `close_business_day`,
`close_shift`, `record_cash_movement`, `change_item_price`, `toggle_86`,
`set_menu_item_active`, `upsert_menu_item`, `upsert_recipe_line`,
`record_purchase`, `record_stock_count`, `record_purchase_return`, plus
two direct-table RLS bypass attempts — fixed in `0036`–`0038`. **These
new checks have not yet run**: the session that wrote them had no
project credentials available (`supabase link` failed, no
`SUPABASE_ACCESS_TOKEN`, no direct Postgres URL). Full findings:
`docs/security-audit-2026-08-14-second-wave.md`.

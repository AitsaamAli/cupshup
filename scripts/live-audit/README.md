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
```

Both are fully self-cleaning: every row they create (a throwaway
outlet, throwaway staff, throwaway orders, a throwaway `auth.users`
row) is deleted at the end of the script, whether it passes or fails.
Safe to run repeatedly against the real linked project.

## What each proves

- **`cross-outlet-attack.mjs`** — creates a second, completely
  unrelated outlet with its own real staff session, then attempts to
  read and write the real outlet's data through every write RPC that
  takes an outlet id or a row id belonging to that outlet
  (`place_order`, `void_order`, `settle_order`, `add_items_to_order`,
  `advance_order_status`, `advance_order_item_status`). Every one must
  reject with `AUTH: not a staff member` or `... not found` — never
  succeed, never leak a different error that would confirm the row
  exists in another tenant.
- **`concurrency-attack.mjs`** — fires N genuinely concurrent
  `place_order()` calls (default 20, five rounds) with the SAME
  idempotency key and asserts exactly one order was created and zero
  callers received a raw database error. Pass `--void` to also void
  every test order it creates.
- **`login-recovery-attack.mjs`** — reproduces a first-login
  provisioning failure (the `auth.users` row gets created, the
  `staff.user_id` link never runs) and confirms the SAME staff member
  can still recover on their next attempt instead of being permanently
  locked out.

## History

First run 2026-08-13 against the real project found the cross-outlet
bypass (P0, fixed in `0035_cross_outlet_isolation_fix.sql`) and the
idempotency race (fixed in `0034_place_order_race_fix.sql`). Both
scripts pass cleanly as of that fix. Re-run after any change to
`place_order`, `settle_order`, `void_order`, `advance_order_status`,
`add_items_to_order`, or any other SECURITY DEFINER function that takes
an outlet id or a row id — see `docs/security-audit-2026-08-13.md` for
the full incident writeup.

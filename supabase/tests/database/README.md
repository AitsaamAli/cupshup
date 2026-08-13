# supabase/tests/database

pgTAP database tests — Part 20. Standard `supabase test db` layout
(`supabase/tests/database/*.sql`), so this runs unchanged the moment a
local Supabase stack (Docker) is available:

```
supabase test db
```

Until then — no Docker in this environment — every file here was
instead executed directly against the real linked project (a plain
`pg` connection, transaction wrapped in `begin; ... rollback;` so
nothing persists) and passed. See `docs/testing-strategy.md` §3 for
the exact method and full run output, and each file's own header for
its specific pass count.

- `rls.sql` — a cashier session can't read the owner-only Part 18 views
  (`daily_pl`, `product_performance`); an owner session can; nobody can
  UPDATE `orders` directly (a real permission error — the grant was
  explicitly revoked, Part 04); `stock_movements` has no UPDATE policy
  at all, so a write against a real row matches zero rows (Part 11's
  "the stock ledger is append-only").
- `idempotency.sql` — the same idempotency key, called twice, returns
  the original order both times and never creates a second one. Found
  and fixed a real bug along the way — see this file's own header and
  `supabase/migrations/0032_idempotency_bugfix.sql`. **Scope note:**
  this proves the sequential case only; true concurrent-call testing
  needs pgbench or N parallel connections, not a single pgTAP session —
  see `docs/testing-strategy.md` §4.
- `business_day.sql` — `place_order()` refuses to create an order when
  today's business day is closed, and no order is left behind by the
  rejected attempt.
- `cross_outlet_isolation.sql` — the 2026-08-13 live audit's Case A
  (CRITICAL): a staff member from a genuinely separate, throwaway
  outlet cannot read, and cannot write via `place_order`,
  `open_business_day`, `void_order`, `advance_order_status`,
  `add_items_to_order`, or `settle_order`, anything belonging to the
  real outlet — even when targeting a real order id directly. Fixed in
  `0035_cross_outlet_isolation_fix.sql`; full incident record in
  `docs/security-audit-2026-08-13.md`. The parts of this attack that
  need real concurrency or a second real Auth session (rather than
  identity-switching within one pgTAP transaction) live in
  `scripts/live-audit/` instead — see that directory's own README.

- `second_wave_cross_outlet.sql` — the 2026-08-14 second-wave audit's 12
  sibling findings (F–O in `docs/security-audit-2026-08-14-second-wave.md`):
  14 assertions attacking `close_business_day`, `close_shift`,
  `record_cash_movement`, `upsert_menu_item`, `change_item_price`,
  `toggle_86`, `set_menu_item_active`, `upsert_recipe_line`,
  `record_purchase`, `record_stock_count`, and `record_purchase_return`
  with a second, throwaway outlet's owner identity — plus three direct
  raw-table writes (bypassing the RPC layer entirely) proving the
  `0037` RLS-policy fix holds on its own, not just the `0036` RPC fix.
  Fixed in `0036_second_wave_ownership_fixes.sql` /
  `0037_second_wave_rls_fixes.sql`. **Written but not yet executed** —
  see that migration's own live-verification banner.
- `void_idempotency.sql` — finding N of the same audit: `void_order()`
  had no guard against being called twice on the same order, silently
  duplicating the stock give-back on the second call. Fixed in
  `0039_void_order_idempotency_fix.sql`. **Written but not yet executed.**

Every test creates only throwaway `auth.users`/`staff` rows (and one
throwaway `stock_movements` row) inside its own rolled-back
transaction — never real data, never left behind.

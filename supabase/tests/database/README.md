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

Every test creates only throwaway `auth.users`/`staff` rows (and one
throwaway `stock_movements` row) inside its own rolled-back
transaction — never real data, never left behind.

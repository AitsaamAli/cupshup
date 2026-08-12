# Cup Shup POS — Testing Strategy

**Depends on:** every prior part
**Code delivered in this part:** `supabase/tests/database/*.sql`, `e2e/*`,
`playwright.config.ts`, `.github/workflows/*.yml`

---

## 1. The Vitest list was already done

The brief's own Part 20 unit-test list — money rounding, split-payment
sums, business date at 3pm/8pm/11:59pm/12:01am/2am/2:59am/3:01am, tax
16%/8%, COGS/margin, moving average cost — is not new work. Every one of
these was already built and tested as the part that introduced it
landed:

| Brief's ask | Already covered by |
|---|---|
| Money rounding, float-bug regression | `tests/money.test.ts` (Part 06) |
| Split payment sum | `tests/settlement.test.ts` (Part 10) |
| Business date, all 7 boundary times | `tests/business-date.test.ts` (Part 06) |
| Tax 16%/8% | `tests/money.test.ts`, `tests/settlement.test.ts` |
| COGS / margin | `tests/reports.test.ts` (Part 18) |
| Moving average cost | `tests/purchases.test.ts` (Part 12) |

155 tests total, all passing (`npm test`) — nothing here needed
duplicating; verifying that coverage already existed **is** this part's
Vitest work.

## 2. pgTAP — run live, since Docker isn't available for `supabase test db`

`supabase/tests/database/*.sql` follows the standard layout so
`supabase test db` runs them unchanged the moment a local stack exists.
Until then, every one of them was actually **executed** against the
real linked project — a direct `pg` connection, each file wrapped in
its own `begin; ... rollback;` so nothing persists — rather than left
as untested paper:

```
rls.sql:          1..5  — 5/5 passed
idempotency.sql:  1..3  — 3/3 passed (after a fix — see §3)
business_day.sql: 1..2  — 2/2 passed
```

## 3. A real bug, found by actually running the idempotency test

Writing `idempotency.sql` meant calling `place_order()` twice with the
same key and checking only one order resulted — the exact guarantee
Part 09 was built around. The first live run didn't return
`duplicate: true` on the second call; it hit a raw
`duplicate key value violates unique constraint` error instead.

The cause: `place_order()`'s dedup check was
`if v_existing is not null then` on a composite `orders` row. Postgres's
`ROW IS NOT NULL` requires **every** column non-null — and a real order
row always has some that aren't (`table_id` for takeaway, `invoice_no`
before settlement, every `pra_*` column before PRA sync). So the check
silently failed exactly when it mattered: when a row genuinely was
found. Fixed in `0032_idempotency_bugfix.sql` by checking `v_existing.id`
specifically — reproduced broken, then reproduced fixed, both against
the live database, before writing that migration. Full story in that
migration's own comment.

The practical consequence this fixes: retrying a `place_order()` call
after a dropped connection — exactly the case Part 20's offline mode
(`docs/offline-mode.md`) depends on being safe — was hitting a hard,
unrecognised error instead of transparently getting the original order
back. This is the single most important thing this part's testing work
found.

## 4. What pgTAP genuinely can't prove: true concurrency

`idempotency.sql` proves the *sequential* case — call, then call again,
same key, one order. It cannot simulate two terminals hitting
`place_order()` at the literal same instant; pgTAP runs as one session
executing statements one after another. The actual concurrency
guarantee is `unique (outlet_id, idempotency_key)` on the `orders`
table itself (`0001_schema.sql`) — a real database constraint enforced
by Postgres regardless of what any single test session can observe, not
application logic that could itself race. A genuine concurrent-load
check needs real parallel connections:

```sh
# 10 parallel attempts, identical idempotency key — expect exactly 1
# row in `orders` afterward, the other 9 all correctly returning
# duplicate: true (or a very small number briefly retried at the unique
# constraint, per Postgres's own guarantee, never a torn double-insert).
for i in $(seq 1 10); do
  psql "$DB_URL" -c "select place_order('<outlet_id>','dine_in', '[{\"menu_item_id\":\"<id>\",\"qty\":1}]'::jsonb, 'load-test-key')" &
done
wait
psql "$DB_URL" -c "select count(*) from orders where idempotency_key = 'load-test-key';"
```

Not run in this environment — deliberately, to avoid hammering the live
linked project's connection pool without a specific need; this is the
exact command to run it when one exists.

## 5. Playwright — written, not executed here

`e2e/*.spec.ts` cover the brief's own list: the full login → day-open →
order → kitchen path, split payment, manager-PIN void, and (Part 20's
own addition) a real offline/reconnect cycle via Playwright's
`context.setOffline(true)` — genuinely cutting the browser's network,
not a mock standing in for it.

Not run in this session. Two real prerequisites, neither a Docker
problem this time:

1. **Fixture staff.** The live project currently has zero staff rows —
   confirmed while building this part's pgTAP tests. `e2e/global-setup.ts`
   provisions three (`E2E-OWNER`/`E2E-CASHIER`/`E2E-CHEF`, prefixed so
   `global-teardown.ts` can find and remove exactly them afterward), but
   needs `E2E_DATABASE_URL` set to actually run.
2. **A real running dev server + real browser automation**, which is
   meaningfully slower than everything else in this part — after
   finding and fixing the idempotency bug along the way (§3), the
   remaining time went to the offline-mode implementation itself over
   running the E2E suite that exercises it.

Running them is exactly `E2E_DATABASE_URL="..." npm run test:e2e` once
`npm run dev` can reach the linked project — see `e2e/README.md`.

## 6. The rule: no money-code merge without tests

Every PR touching `lib/money.ts`, `lib/settlement.ts`, `lib/orders.ts`,
`lib/business-date.ts`, `lib/business-day.ts`, `lib/purchases.ts`, or
any `supabase/migrations/*.sql` file must include or update a test
covering the change — enforced by CI (`.github/workflows/ci.yml`)
failing the build if `npm test` doesn't pass, and by a `CODEOWNERS`-style
review expectation documented here rather than a bot no one configured
yet: a reviewer should decline to approve a money-path change with no
corresponding test, the same way this session declined to consider
Part 20 done without actually running the idempotency test that found
§3's bug.

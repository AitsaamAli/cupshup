# e2e

Playwright E2E specs — Part 20. Run against a real `next dev` server and
the real linked Supabase project; no mocking layer, since the point is
exercising the real RLS/RPC stack a unit test mocks away.

```
E2E_DATABASE_URL="postgresql://...direct-connection..." npm run test:e2e
```

`E2E_DATABASE_URL` is a direct Postgres connection string (same shape
used throughout `supabase/migrations/README.md`'s live-verification
commands) — `global-setup.ts` uses it to provision real fixture staff
(`FIXTURE_STAFF`, prefixed `E2E-`) before the suite runs, and
`global-teardown.ts` removes exactly those rows afterward, every run,
pass or fail.

- `full-flow.spec.ts` — login → day open → order → kitchen.
- `split-payment.spec.ts` — settlement with cash+card, each at its own tax rate.
- `manager-void.spec.ts` — a cashier's void requiring a manager's own PIN.
- `offline.spec.ts` — `context.setOffline(true)`, take an order, queue,
  reconnect, watch it sync (Part 20's offline design, docs/offline-mode.md).

**Written and ready, not executed in this environment** — see
`docs/testing-strategy.md` §5 for exactly why and what running the full
suite needs. The pgTAP database tests (`supabase/tests/database/`) WERE
run live this part instead — see that directory's own README for what
that proved and, in idempotency testing's case, a real bug it found and
fixed (`supabase/migrations/0032_idempotency_bugfix.sql`).

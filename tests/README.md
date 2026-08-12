# tests

Run with `npm test` (single run) or `npm run test:watch` (Vitest watch mode).

- `business-date.test.ts` — every boundary case for the 3pm–3am trading
  day (Part 06), checked against `lib/business-date.ts`.
- `money.test.ts` — paisa-integer math, the tax rounding rule (round per
  payment split, sum after rounding), and regression tests proving the
  classic `599 * 0.18` float bug can't creep back in.
- `orders.test.ts` — `lib/orders.ts`'s idempotency-key contract (Part 09)
  and the exact shape of every order-engine RPC call, using a mocked
  Supabase client. The database-level guarantees these RPCs enforce
  (day-closed blocking, 86'd-item blocking, true concurrent-call
  deduplication) need a live Postgres to actually exercise — see
  `docs/order-engine.md` §6 for the exact SQL to run once one exists.
- `settlement.test.ts` — the split-payment worked example from Part 10
  (Rs 5,000 bill, 2,000 cash + 3,000 card → tax exactly 560),
  `settleOrder()`'s RPC call shape, and `loadPaymentMethodTaxRates()`'s
  join logic. The live rounding-per-split behaviour and closed-day/
  cashier-void blocks need a real Postgres — see `docs/payment-and-settlement.md` §6.
- `purchases.test.ts` — the weighted-average-cost worked example from
  Part 12 (10kg @ Rs 800 in stock, buy 10kg @ Rs 900 → new average
  exactly Rs 850), plus `recordPurchaseGrn()`/`recordPurchaseReturn()`/
  `upsertSupplier()`'s RPC call shapes.
- `business-day-shifts.test.ts` — Part 13's expected-cash formula
  (`previewExpectedCash()`, mirroring both `close_shift()`'s per-shift
  and `close_business_day()`'s per-day calculations), plus every new
  RPC's call shape (`openBusinessDay`, `closeBusinessDay`, `openShift`,
  `closeShift`, `recordCashMovement`).
- `expenses.test.ts` — Part 14's approval-threshold table
  (`requiredApprovalRole()`), the amortization formula including the
  last-day rounding fix (`previewAmortizedDailyAmount()` — verified
  against both the brief's 30-day round number and the real 31-day case
  that exposed the bug), and the report-summary helpers.

Money math (`lib/money.ts`), business-date logic (`lib/business-date.ts`),
and — once built — the order/payment RPC functions are the
highest-priority coverage in this project: they're where a silent bug
costs real rupees. Broader test runner / CI wiring lands in
**Part 20 — Offline, Testing & Deployment**; these two suites started
early, in Part 06, because that's the part that wrote the functions.

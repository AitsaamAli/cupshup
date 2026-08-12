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
- `tables.test.ts` — Part 16's `deriveTableStatus()`: no open order is
  `empty`, `sent_to_kitchen`/`ready` is `running`, `served` (kitchen
  done, unpaid) is `bill_requested`. The POS table grid's live Realtime
  wiring itself (`useTables()`) needs a real database, same caveat as
  every other hook in this project.
- `kds.test.ts` — Part 17's `ticketAgeLevel()` (the 0-5/5-10/10+ minute
  colour thresholds), `ticketItemsForStation()`/`ticketMatchesStation()`
  (station filtering, including the "no resolvable station shows on
  every screen" fallback), and the ticket-time report's three
  aggregations (`averageTicketMinutes`, `averageMinutesByStation`,
  `averageMinutesByHour`) against fixed timestamps. The live board
  itself (`useKdsTickets()`) and the three new RPCs
  (`advance_order_item_status`/`mark_ticket_items_ready`/`recall_order`)
  are verified live against the real project — see
  `supabase/migrations/README.md`.
- `reports.test.ts` — Part 18: `classifyMenuItems()` (all four Menu
  Engineering Matrix quadrants, aggregation across multiple
  business_date rows for the same item, the zero-revenue edge case),
  every flag function (`flagCashVariance`, `flagStockVariance`,
  `flagVoidValue`, `flagLowMarginItems`, `flagIngredientCostIncrease`,
  `flagNetLoss` — including the exact "a full month's rent posted on one
  day" scenario the old system got wrong every month), `labourCostPercent()`,
  `sumBy()`, and `aggregateHourly()`.
- `date-range.test.ts` — Part 18's `todayIso()`/`daysAgoIso()`/
  `startOfMonthIso()`, specifically proving they read the LOCAL calendar
  date rather than `toISOString()`'s UTC date (which would show
  yesterday for the first five hours after local midnight on a UTC+5
  clock — the same class of bug `business_date_of()`, Part 06, exists to
  prevent, just for a date-picker default instead of an order timestamp).
- `export.test.ts` — Part 18's `toCsv()`: header + row order, comma/quote/
  newline escaping, and null/undefined rendering as an empty field.
- `print-templates.test.ts` — Part 19's three print content builders.
  `buildReceiptDoc()` is checked against the brief's own worked receipt
  example to the exact rupee (items, per-split tax rates, tendered/
  change, the REPRINT marker appearing from the second print onward,
  and the offline case — no QR, "PRA No: pending" — when PRA hasn't
  confirmed yet). `buildKitchenTicketDoc()` confirms station filtering
  (reused from Part 17) and that no price ever appears on a kitchen
  ticket. `buildDayReportDoc()` confirms Part 13's `ClosingSnapshot` is
  printed as-is, never re-derived.
- `pra.test.ts` — Part 19's `nextRetryDelayMs()`, mirroring
  `record_pra_failure()`'s SQL backoff (doubling per attempt, capped at
  60 minutes).
- `print-queue.test.ts` — Part 19's local print-retry queue's pure list
  operations (`withNewJob`/`withoutJob`/`withFailedAttempt`), independent
  of `localStorage`.
- `offline-network.test.ts` — Part 20's `isNetworkError()`: browser
  offline, every browser's fetch-failure wording, and — critically —
  that a real server rejection ("DAY: closed") is never mistaken for a
  connectivity problem.
- `offline-orders.test.ts` — Part 20's `classifySyncAttempt()`: the
  three-way split (synced/offline/rejected) the local order queue's
  sync loop depends on to know when to stop retrying vs. give up
  gracefully vs. keep going.

Database-level tests live in `supabase/tests/database/` (pgTAP) — see
that directory's own README. They found and this session fixed a real
bug in `place_order()`'s idempotency check
(`supabase/migrations/0032_idempotency_bugfix.sql`) that no Vitest
mock could have caught, since it only manifests against a real
Postgres row's actual NULL columns.

- `middleware.test.ts` — Case D of the 2026-08-13 live audit
  (`docs/security-audit-2026-08-13.md`): the middleware's route matcher,
  tested as a real anchored `RegExp` against real pathnames, confirming
  `api/*` (and `sw.js`/`manifest.json`) stay excluded while every real
  protected page still requires a session. This exact regex was silently
  redirecting `/api/auth/pin` to `/login` before the fix, breaking every
  PIN login.
- `auth-otp.test.ts` — Case E of the same audit: `buildVerifyOtpArgs()`
  (`lib/auth-otp.ts`) never includes an `email` key alongside
  `token_hash` — passing both made this project's GoTrue version reject
  the login exchange outright.

Three more findings from that same audit — a critical cross-outlet
write bypass, a `place_order()` concurrency race, and a first-login
provisioning lockout — need either true concurrency or a second real
Auth identity, neither expressible in a mocked-client Vitest test; they
live as permanent, re-runnable scripts in `scripts/live-audit/` instead
(plus a pgTAP version of the cross-outlet case,
`supabase/tests/database/cross_outlet_isolation.sql`, for the parts of
it a single session CAN express). See `docs/security-audit-2026-08-13.md`
for the full incident record.

Money math (`lib/money.ts`), business-date logic (`lib/business-date.ts`),
and — once built — the order/payment RPC functions are the
highest-priority coverage in this project: they're where a silent bug
costs real rupees. Broader test runner / CI wiring lands in
**Part 20 — Offline, Testing & Deployment**; these two suites started
early, in Part 06, because that's the part that wrote the functions.

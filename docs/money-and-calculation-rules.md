# Cup Shup POS — Money & Calculation Rules

**Depends on:** Part 03, Part 05
**Code delivered in this part:** `lib/money.ts`, `lib/business-date.ts`,
`supabase/migrations/0002_business_date_function.sql`, `tests/money.test.ts`,
`tests/business-date.test.ts`

This document is the second and third bugs from the old prototype, fixed —
and the rules that stop them from coming back.

---

## 1. Bug: the business date after midnight was wrong

```js
function businessDateFor(d) {
  const dt = new Date(d);
  if (dt.getHours() < 15) dt.setDate(dt.getDate() - 1);
  return dt.toISOString().slice(0, 10);   // <-- the bug
}
```

`getHours()` reads **local** time (Pakistan, UTC+5). `toISOString()` then
converts back to **UTC**. Mixing the two silently shifts the date backwards.

**Traced through — a 12 Aug, 2:00 AM order:**

| Step | Result |
|---|---|
| Local time | 12 Aug, 02:00 PKT |
| `getHours()` = 2, `< 15` → subtract a day | 11 Aug, 02:00 PKT |
| `.toISOString()` → UTC (−5 hours) | **10 Aug**, 21:00 UTC |
| Date actually saved | `2026-08-10` ❌ |
| Date that should have been saved | `2026-08-11` ❌ (off by one, not the intuitive "still counts as the 11th" either — see below) |

Cup Shup trades 3pm–3am, so **every order between midnight and 3am** — the
cafe's busiest stretch — was landing on the wrong calendar day. Daily P&L,
cash reconciliation, closing reports, and trend charts were all silently
wrong. Worse, the prototype's own "audit check" used the same broken
function on both sides of the comparison, so it always reported "pass."

### The fix: compute it once, in Postgres, from the server clock

```sql
create function business_date_of(ts timestamptz, tz text default 'Asia/Karachi',
                                 start_hour int default 15)
returns date language sql stable as $$
  select ((ts at time zone tz) - make_interval(hours => start_hour))::date;
$$;
```

This is `supabase/migrations/0002_business_date_function.sql`. Every table
with a business date (`business_days.business_date`, and anything computed
from it) derives it from this one function — never from a second
reimplementation, never from client-side date math.

`lib/business-date.ts` exists too, but it is **display-only**: it lets a
screen show "today's business date is..." before the server has weighed in,
and it exists so this document's test cases can be checked in CI without a
database connection. The database function is always the authority for any
value that actually gets stored.

Verified cases (both the SQL function and the TypeScript port agree on all of these — see `tests/business-date.test.ts`):

| Timestamp (PKT) | Business date |
|---|---|
| 11 Aug, 3:00 PM (day opens) | 2026-08-11 |
| 11 Aug, 8:00 PM | 2026-08-11 |
| 11 Aug, 11:59 PM | 2026-08-11 |
| 12 Aug, 12:01 AM | 2026-08-11 |
| **12 Aug, 2:00 AM** (the bug case) | **2026-08-11**, not 2026-08-10 |
| 12 Aug, 2:59 AM | 2026-08-11 |
| 11 Aug, 2:00 PM (before opening) | 2026-08-10 |

---

## 2. A deeper problem: whose clock is it anyway?

If "what business day is it" depends on a tablet's local clock, two things
can go wrong: the tablet's clock can simply be wrong, and — worse — a
dishonest cashier could deliberately change the device time to push a sale
into a day that's already closed (or not yet opened), muddying
reconciliation.

**Rule: every financial timestamp comes from the server.** Every table in
the schema that records when something happened (`orders.created_at`,
`payments.created_at`, `stock_movements.created_at`, and so on) defaults to
Postgres's own `now()` — never a value sent up from the browser or app. This
is already true of every migration written so far (Parts 03–05); nothing in
`place_order`/`settle_order`/`open_business_day`/`close_business_day`
(Parts 09/10/13) should ever accept a client-supplied timestamp for a
financial field either.

---

## 3. Money is always integer paisa

```ts
// lib/money.ts
export type Paisa = number & { readonly __brand: 'Paisa' };
```

`1329 * 0.16` in plain JavaScript is `212.64000000000001`, not `212.64` —
this isn't a hypothetical, it's IEEE-754 floating point doing exactly what
it always does with decimal fractions. After a few thousand orders, a report
built on float math stops matching to the paisa. Restricting every money
value to whole integer paisa (Rs 599.00 = `59900`) and routing every
operation through `lib/money.ts`'s helpers removes the problem entirely,
rather than chasing individual rounding bugs forever.

`Paisa` is a **branded type** — at runtime it's a plain `number`, but
TypeScript won't let a bare `number` (a loop index, a percentage, a Rupee
amount that hasn't been converted yet) be passed somewhere paisa is expected
without going through `rupeesToPaisa()` first. It costs nothing at runtime
and catches a whole category of unit-confusion bugs at compile time.

---

## 4. The rounding rule — decided once here, applied everywhere

```
tax_paisa = round(base_paisa * rate_bp / 10000)
```

Two parts to this rule, and both matter:

1. **Round separately on each payment split, never once on the whole bill.**
   Punjab taxes by payment method (16% cash, 8% digital) — a bill paid
   half-cash/half-card has no single blended rate to round in the first
   place. Each `payments` row needs its own correct rate and its own
   correctly-rounded tax figure, because that's what gets reported per
   payment channel.
2. **Round each split first, then sum the already-rounded amounts** — never
   sum the unrounded fractional amounts and round the total once. These two
   orders of operation can produce different final paisa totals (see the
   worked example in `tests/money.test.ts`), and only the "round-then-sum"
   order matches what each individual `payments` row actually stores.

Simple `round()` (half away from zero, i.e. `Math.round()` in JS /
`round()` in Postgres) is used throughout — not banker's rounding. This is
implemented in `calculateTax()` and exercised by 25 cases in
`tests/money.test.ts`.

---

## 5. The flat 40% profit rate is gone

```js
const PROFIT_RATE = 0.40;   // <-- this never existed correctly
```

A Rs 60 bottle of water and a Rs 1,549 steak cannot share one margin:

| Item | Price | Realistic margin |
|---|---|---|
| Water (Small) | Rs 60 | ~15–20% |
| Karak Chai | Rs 329 | ~80%+ |
| Green Tea Kahwa | Rs 229 | ~90% |
| Tarragon Steak | Rs 1,549 | ~35–45% |

There is no `PROFIT_RATE` constant anywhere in this codebase, and there
must never be one again. Instead, `order_items.unit_cost_paisa` stores the
real recipe cost (via `recipe_cost_paisa()`, Part 09) at the moment of sale,
and gross profit is always
`sum(qty × (unit_price_paisa − unit_cost_paisa))` — a real number, derived
from real ingredient costs, per item. `product_performance` (the reporting
view, Part 18) surfaces this per menu item so margin decisions are made on
fact, not a guess.

---

## 6. Expense timing — rent shouldn't nuke one day's P&L

```js
todaysNetProfit = todaysGrossProfit - todaysExpensesTotal;
```

Rent is a monthly cost. Post the whole month's rent against the day it was
paid, and that one day shows a huge artificial loss while every other day
in the month looks falsely profitable — exactly the kind of number that
makes an owner distrust the whole dashboard.

**The rule:** `expense_categories.accrual_type` (Part 03) is `immediate`,
`monthly`, or `annual`. In any report that shows a **single day's** P&L, a
`monthly`/`annual` expense must be spread evenly across its `period_start`–
`period_end` range (amount ÷ number of days in the period) rather than
dumped entirely on the day it was entered. In a report showing a **whole
month or year**, the full amount is shown as-is — the spreading only
matters when a report's window is narrower than the expense's own period.

This rule is documented and decided here; the actual spreading arithmetic
is implemented where daily P&L is queried — **Part 18 (Reports & Master
P&L)** — since that's the part that owns the reporting views. Nothing about
this rule is still undecided; only its SQL implementation is still ahead.

---

## 7. Acceptance Criteria — This Part

- [x] `business_date_of()` Postgres function built (`0002_business_date_function.sql`)
- [x] `lib/business-date.ts` — same logic, display-only, TypeScript
- [x] Test: 12 Aug 02:00 PKT → `2026-08-11` (not `2026-08-10`)
- [x] Test: 11 Aug 20:00 PKT → `2026-08-11`
- [x] Test: 11 Aug 14:00 PKT → `2026-08-10`
- [x] `lib/money.ts` built, every amount integer paisa
- [x] No float money anywhere in this codebase
- [x] Rounding rule written (Section 4 above) and tested
- [x] No `PROFIT_RATE` constant anywhere in this codebase
- [x] Every financial timestamp is the server's `now()` (true of every migration so far; stays a hard rule for Parts 07+)
- [x] Money tests: 38 cases across `tests/money.test.ts` and `tests/business-date.test.ts`, all passing (`npm test`)

**Next part:** `07-auth-and-staff-login.md`

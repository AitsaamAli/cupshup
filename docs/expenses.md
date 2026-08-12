# Cup Shup POS — Expenses

**Depends on:** Part 13
**Code delivered in this part:** `supabase/migrations/0020_expenses_functions.sql`,
`0021_expense_amortization_view.sql`, `0022_expense_receipt_storage.sql`,
`lib/expenses.ts`, `app/manage/expenses/`

---

## 1. Almost everything the brief asks for already existed

`expense_categories.accrual_type`, and every column this part's brief
names on `expenses` — `payment_method`, `vendor`, `receipt_url`,
`approved_by`, `period_start`/`period_end` — were already in Part 03's
schema, and `expense_categories` was already seeded (Part 03/05,
`0006_seed.sql`) with exactly the categories the brief lists: Rent/
Salaries/Utilities/Marketing as `monthly`, Daily Wages/Supplies/Gas &
Fuel/Maintenance/Other as `immediate`. Even direct insert/update/delete
RLS policies for `expenses` already existed (Part 04's reference file).

**What was actually missing:** those existing RLS policies let any
supervisor+ insert *any* amount with no approval check at all — none of
the threshold table from this part's brief was enforced anywhere. This
part revokes direct writes on `expenses` (the same "financial writes are
RPC-only" pattern used everywhere else — orders, payments, purchases) and
replaces them with functions that actually enforce it.

## 2. The approval threshold, and who can even enter what

| Amount | Who can enter it | Who has to approve it |
|---|---|---|
| < Rs 5,000 | Supervisor+ | nobody — self-approved on entry |
| Rs 5,000 – Rs 25,000 | Supervisor+ | Manager (or Owner) |
| > Rs 25,000 | Manager+ only | Owner |

The two questions — "who's allowed to type this in" and "who has to sign
off on it" — are separate checks in `record_expense()`. If the person
entering an expense already holds the required approval tier themselves
(e.g. a manager entering their own Rs 10,000 expense), their entry *is*
the approval — `approved_by` is set immediately, no separate step. If
not, `approved_by` stays `null` until `approve_expense()` is called by
someone who does qualify.

## 3. Amortization: one view, and a bug it exposed

Part 14's brief explicitly asks for "one view that's correct for both a
daily view and a monthly view." The insight that simplifies this: the
**monthly** case needs no special handling at all — summing
`expenses.amount_paisa` over a date range directly already gives the
correct full-amount total for any period. Only the **daily** case needs
spreading, so `daily_expenses_amortized` is the only view built.

**A real rounding bug, caught by actually testing it against live data
before calling this part done — not a hypothetical:** the first version
of the view rounded each day's share independently
(`round(amount / days)`). Inserting a real Rs 200,000 monthly-rent test
row for August (31 days) and querying the view showed the daily figure
landing on 645161 paisa every day — but 31 × 645161 = 19,999,991, nine
paisa short of the original Rs 200,000. Fixed with the standard "last
period absorbs the remainder" pattern (the same spirit as the tax-split
rounding rule in `docs/money-and-calculation-rules.md`): every day gets
the plain rounded share except the period's last day, which gets
`amount − (days−1) × per_day` instead — guaranteeing the period always
sums back to the original amount exactly. Re-verified live after the fix:
the same 31-day test row now sums to exactly 20,000,000. The test row was
deleted afterward; nothing was left behind in the live database.

`previewAmortizedDailyAmount()` in `lib/expenses.ts` mirrors this exact
formula (including the remainder fix) and is tested directly in
`tests/expenses.test.ts` against both the brief's own round-number
example (30-day month, Rs 6,667/day) and the real 31-day case that
exposed the bug.

## 4. Cash reconciliation never uses the amortized figure

Section 7 of the brief is explicit: "Cash reconciliation mein hamesha
ASAL tareekh aur ASAL amount lage (amortised nahi)." This was already
true by construction before this part existed — `close_shift()` and
`close_business_day()` (Part 13) both sum `expenses.amount_paisa`
directly via `shift_id`/`business_day_id`, never through
`daily_expenses_amortized`. Nothing needed to change for this
requirement; it's documented on the view itself
(`comment on view daily_expenses_amortized ...`) so nobody's tempted to
wire it into the drawer math later.

## 5. Edit/delete rules

`update_expense()` — owner/manager only, only while the expense's
business day is still open, full before/after state in `audit_log`.
`delete_expense()` — owner only, same open-day restriction, and unlike
most other entities in this app, this genuinely is a SQL `DELETE`, not a
soft-deactivation — the brief's own "yeh mat karna" list says "don't
delete *without a record*," not "never delete," and the pre-existing
reference RLS policy for this table was always a real delete policy. The
`audit_log` row (with the complete pre-delete state captured in `before`)
is that record.

## 6. What still needs a live database to fully exercise

`record_expense()`, `approve_expense()`, `update_expense()`, and
`delete_expense()` all need a real staff session this environment
doesn't have yet. What *has* been verified live, beyond the amortization
fix in Section 3: all 4 functions exist, `daily_expenses_amortized` has
`security_invoker = true`, and the Rent category's seeded `accrual_type`
reads back as `monthly` as expected.

---

## 7. Acceptance Criteria — This Part

- [x] `accrual_type` works — already true since Part 03; this part is
      what actually spreads it correctly in daily reporting
- [x] Daily P&L spreads monthly expenses across their period
- [x] Monthly view shows the full amount — true by not needing any
      special handling at all (Section 3)
- [x] Rent no longer produces a false daily loss — verified live against
      a real 31-day test row, sum reconciles exactly to the original
- [x] `payment_method` present — already true since Part 03; only the
      cash portion ever reduces a drawer (Part 13, unchanged)
- [x] Receipt photo upload (private Storage bucket)
- [x] Approval threshold enforced server-side (Section 2)
- [x] Edit only on an open day, audited
- [x] Delete owner-only, open day only, audited
- [x] Vendor and category reports (`/manage/expenses/reports`)
- [x] **Test:** Rs 200,000 monthly rent → ~Rs 6,667/day — verified with
      the brief's own 30-day round number AND with a real 31-day case
      that caught a genuine rounding bug (`tests/expenses.test.ts`)

**Next part:** `15-design-system.md`

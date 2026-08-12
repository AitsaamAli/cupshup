# Cup Shup POS — Business Day, Shifts & Cash Drawer

**Depends on:** Part 06, Part 09, Part 10
**Code delivered in this part:** `supabase/migrations/0019_business_day_functions.sql`,
`lib/business-day.ts`, `app/manage/day/`

---

## 1. This part closes a gap tracked since Part 04

`open_business_day()` and `close_business_day()` are copied verbatim from
the project's full reference `0002_functions.sql`. Their absence was the
very last item in `0005_rls.sql`'s original grant statement (`grant execute
on function place_order, settle_order, void_order, open_business_day,
close_business_day to authenticated`) — `place_order`/`settle_order`/
`void_order` already had their own explicit grants from Parts 09/10, so
this part supplies the final two and closes that thread for good.

Worth being clear about what was **already working** before this part
existed: `place_order()` (Part 09) already checks
`business_days.status = 'open'` and raises an exception otherwise — that
enforcement has been at the database level since Part 09, not something
this part adds. What this part actually supplies is the two functions that
*manage* `business_days.status` in the first place, plus real per-cashier
shifts.

## 2. Per-shift open/close — not in the reference file

The reference `open_business_day()` only ever creates one shift, for
whoever opens the day. Part 13's own brief is explicit that a 3pm–3am
cafe runs at least two cashiers, two drawers — so `open_shift()` and
`close_shift()` are original to this migration, letting a second (or
third) cashier start their own shift within an already-open business day,
and reconciling each one independently.

**One open shift per cashier at a time** (`open_shift()` checks for an
existing unclosed shift and rejects a second one) — this is what makes a
variance traceable to exactly one person, the whole stated point of
tracking shifts at all.

## 3. Why `close_shift()` doesn't subtract cash expenses (yet)

`expenses` only had `business_day_id` until this part — there was no way
to say *which cashier's shift* a given cash expense came out of. This
part adds a nullable `expenses.shift_id` column so that attribution is
possible, but `close_shift()` only uses it when it's actually set:

```sql
select coalesce(sum(amount_paisa),0) into v_cash_expenses
from expenses where shift_id = p_shift_id and payment_method = 'cash';
```

Until Part 14 (Expenses) wires up setting `shift_id` when an expense is
recorded, every expense will have `shift_id = null`, and `close_shift()`
will correctly compute `0` for that shift's cash expenses rather than
guessing which cashier paid it. This is a deliberate choice: attributing
an untagged expense to whichever cashier happens to be closing their
drawer at the time would be exactly the kind of wrong number that makes
staff stop trusting variance alerts (Part 13's own brief calls this out
as the actual failure mode: false alerts train people to ignore real
ones). `close_business_day()` (the reference function, unmodified) is
unaffected — its day-level formula always summed all of that day's cash
expenses regardless of which shift, which was already correct at the day
level.

## 4. The formula, both levels

**Per shift** (`close_shift()`, new):
```
expected = opening_float + cash_sales + paid_in − cash_expenses (shift-tagged only) − drops
```

**Per day** (`close_business_day()`, reference, unmodified):
```
expected = opening_float (all shifts) + cash_sales + paid_in − cash_expenses (all) − drops
```

Both exclude non-cash expenses entirely (`expenses.payment_method <> 'cash'`
never reduces expected cash) — the exact fix for the brief's complaint
that a bank-transferred utility bill used to produce a false Rs 45,000
"shortage" alert.

## 5. Real gross profit, not a flat 40%

Already true of the reference `close_business_day()`, unchanged here:
`gross_profit_paisa = revenue_paisa - cogs_paisa`, where `cogs_paisa` is
the sum of each settled order's own `cogs_paisa` (Part 09's `place_order()`
snapshot, built from `recipe_cost_paisa()`, Part 11's real ingredient
costs) — never a guessed percentage.

## 6. What still needs a live database to fully exercise

Same limitation as every part: `open_business_day()`, `close_business_day()`,
`open_shift()`, `close_shift()`, and `record_cash_movement()` all check
`current_staff()`, which needs a real PIN-authenticated staff session this
environment doesn't have yet. What *has* been verified live: all 5
functions exist, and `expenses.shift_id` was added successfully. The
`previewExpectedCash()` formula (mirroring both server functions) is
tested directly in `tests/business-day-shifts.test.ts`.

---

## 7. Acceptance Criteria — This Part

- [x] `business_days.status` works — already true since Part 03/09;
      this part supplies the functions that manage it
- [x] Day not open → order blocked at the database level — already true
      since Part 09's `place_order()`
- [x] Day closed → order blocked — same
- [x] Closed day never reopens — `open_business_day()` raises if the
      day's status isn't `'open'`
- [x] Shifts exist, each cashier has their own drawer (`open_shift()`,
      one-open-shift-per-cashier rule)
- [x] `cash_movements` — already existed (Part 03); `record_cash_movement()`
      is the new RPC path for it
- [x] `expenses.payment_method` — already existed (Part 03);
      `close_business_day()`/`close_shift()` both only subtract cash-method
      expenses
- [x] Expected-cash formula matches the brief exactly, at both levels
- [x] Closing is one transaction — snapshot + lock together
      (`close_business_day()`, unchanged reference behaviour)
- [x] Closing report shows real gross profit (COGS-based)
- [x] Variance tracked per shift, not just per day (`close_shift()`, new)
- [ ] **Test:** closed day blocks a new order — this is `place_order()`'s
      existing behavior (Part 09), needs a live database to actually
      exercise end-to-end; not re-tested here since nothing about that
      enforcement changed in this part
- [x] **Test:** a bank-paid expense doesn't affect the drawer — true by
      construction (`payment_method <> 'cash'` is filtered out of every
      cash formula), and covered indirectly by `previewExpectedCash()`'s
      tests, which never include non-cash amounts in the formula at all

**Next part:** `14-expenses.md`

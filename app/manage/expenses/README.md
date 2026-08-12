# app/manage/expenses

Expense entry, approval, and reporting — **built in Part 14**. Amount
above Rs 5,000 needs a manager to approve; above Rs 25,000 needs the
owner and must be entered by a manager+ in the first place — enforced
server-side in `record_expense()`/`approve_expense()`
(`supabase/migrations/0020_expenses_functions.sql`), not just hidden in
this UI.

Monthly/annual expenses (rent, salaries, ...) get a `period_start`/
`period_end` and are spread evenly across daily P&L via the
`daily_expenses_amortized` view — but cash reconciliation (Part 13)
always uses the real, un-amortised amount on the real day it was paid.

`reports/` — category-wise, vendor-wise, monthly trend, cash vs. non-cash.

See `docs/expenses.md` for a rounding bug that was actually caught by
querying the amortization view against a real 31-day test row before
calling this part done.

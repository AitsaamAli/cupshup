-- =====================================================================
-- Cup Shup POS — Expense Amortization
-- Part 14: "Ek SQL view banao jo dono soorat sahi de" — one view that's
-- correct for both a daily view (monthly rent spread across its period)
-- and a monthly view (the full amount, once). The trick: the MONTHLY
-- case needs no special handling at all — querying the base `expenses`
-- table directly and summing amount_paisa over a date range already
-- gives the correct full-amount total for any period. Only the DAILY
-- case needs a view, so that's the only one built here.
--
-- security_invoker = true from the start (Part 11's ingredient_stock
-- finding, and Part 12's supplier_payables, established this as the
-- standing rule for every view in this project).
-- =====================================================================

create or replace view daily_expenses_amortized
with (security_invoker = true)
as
with normalized as (
  select
    e.id as expense_id,
    e.outlet_id,
    e.category_id,
    e.payment_method,
    e.vendor,
    e.amount_paisa,
    ec.accrual_type,
    -- Immediate expenses get a 1-day "period" equal to the business day
    -- they were recorded against (falling back to the calendar date of
    -- created_at if, unusually, no business day was open). Monthly/
    -- annual expenses use their own period_start/period_end exactly as
    -- entered. Normalizing both cases to a start/end pair lets one
    -- generate_series below handle both without branching.
    coalesce(e.period_start, bd.business_date, e.created_at::date) as effective_start,
    coalesce(e.period_end,   bd.business_date, e.created_at::date) as effective_end
  from expenses e
  join expense_categories ec on ec.id = e.category_id
  left join business_days bd on bd.id = e.business_day_id
)
select
  n.expense_id,
  n.outlet_id,
  n.category_id,
  n.payment_method,
  n.vendor,
  n.accrual_type,
  n.amount_paisa as original_amount_paisa,
  gs.day::date as expense_date,
  case
    when n.accrual_type = 'immediate' then n.amount_paisa
    -- period_end is EXCLUSIVE (same convention as menu_item_prices/
    -- tax_rates' effective_to elsewhere in this schema), so the day
    -- count is simply effective_end - effective_start.
    --
    -- Rounding each day independently can lose a few paisa over a long
    -- period (Rs 200,000 / 31 days = 645161.29 paisa -> rounds down to
    -- 645161 every day -> the month sums to 19999991, nine paisa short
    -- of 200000.00 — caught by actually querying this view against a
    -- real 31-day test row before calling this part done). The last day
    -- of the period absorbs the remainder instead, so the period always
    -- reconciles exactly to the original amount — same "round per unit,
    -- but make sure it still sums correctly" spirit as the tax-split
    -- rule in docs/money-and-calculation-rules.md.
    when gs.day = (n.effective_end - 1) then
      n.amount_paisa
      - (greatest(n.effective_end - n.effective_start, 1) - 1)
        * round(n.amount_paisa::numeric / greatest(n.effective_end - n.effective_start, 1))
    else round(n.amount_paisa::numeric / greatest(n.effective_end - n.effective_start, 1))
  end as amortized_amount_paisa
from normalized n
cross join lateral generate_series(
  n.effective_start,
  greatest(n.effective_end - 1, n.effective_start),
  interval '1 day'
) as gs(day);

comment on view daily_expenses_amortized is
  'Daily P&L reporting only. Cash reconciliation (close_shift/close_business_day, Part 13) deliberately does NOT use this view — it sums expenses.amount_paisa directly, the real amount on the real day cash actually left the drawer, never the amortised figure.';

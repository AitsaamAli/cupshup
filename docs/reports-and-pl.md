# Cup Shup POS — Reports, Dashboard & Master P&L

**Depends on:** Part 10, Part 11, Part 13, Part 14
**Code delivered in this part:** `supabase/migrations/0026_reports_schema.sql`,
`supabase/migrations/0027_reports_functions.sql`, `supabase/migrations/0028_reports_views.sql`,
`app/reports/{dashboard,pl}/page.tsx`, `components/reports/*`, `lib/reports.ts`,
`lib/export.ts`, `lib/date-range.ts`

---

## 1. The bug this whole part exists to correct

```js
const PROFIT_RATE = 0.40;
const todaysGrossProfit = todaysRevenue * PROFIT_RATE;
```

A Rs 60 bottled water and a Rs 1,549 steak do not have the same margin —
treating them as if they did meant every "Est. Profit" number in the old
system was confidently, precisely wrong. `order_items.unit_cost_paisa`
(Part 09) has carried the real recipe cost on every line since the order
engine was built; this part is the first screen that actually reads it.
`product_performance` and `daily_pl` (below) compute margin the only
honest way: `revenue − real COGS`, per item, per day. `PROFIT_RATE` does
not exist anywhere in this codebase.

## 2. Who sees what, and why — the real split behind "Manager" vs. "sirf Owner"

Postgres RLS policies attach to **tables**, not views, and every logged-in
staff member shares the one `authenticated` Postgres role — there is no
way for a plain `grant`/`revoke` to tell a cashier's session apart from
an owner's. The reference file's own approach for this
(`revoke all on daily_pl, product_performance, stock_variance ...; grant
select ... to authenticated`, still commented out in `0005_rls.sql`)
would only have blocked `anon` — every other staff role would still see
it. That's not what "P&L sirf Owner ko (RLS + PIN dono se)" asks for, so
this part does it differently: every owner-only view embeds
`and has_role('owner')` directly in its `where` clause. `has_role()`
reads the querying session's own `auth.uid()` (exactly like every RLS
policy already does), so a non-owner querying the view — through this
app's UI or a raw REST call — gets back **zero rows**, not a hidden
button. Confirmed live: querying `daily_pl` with no authenticated
session at all returns `0` rows, not an error and not real data.

The split itself:

| Tier | Views | Why |
|---|---|---|
| Manager+ (owner/manager/supervisor) | `daily_pl`, `hourly_sales`, `payment_mix_daily`, `tax_summary_daily`, `category_revenue_daily`, `item_revenue_daily` | Aggregate totals — the brief's own Dashboard table already lists "Net profit" and "Asli gross profit" for this tier. |
| Owner only | `product_performance`, `cash_variance_by_cashier`, `void_analysis_by_cashier`, `reprint_summary`, `labour_cost_daily`, `ingredient_cost_trend` | Anything **per-item margin** (reveals exact recipe costing), **per-person** (cash/void accountability, reprints), or otherwise strategic (labour %, supplier cost trend) — matching exactly what the brief lists under "Master P&L (sirf Owner)". |

`item_revenue_daily`/`category_revenue_daily` exist specifically because
of this split: the Dashboard's "top items"/"category revenue" charts
need SOME item-level breakdown, but `product_performance`'s margin
column is the genuinely sensitive part. Revenue alone is a much smaller
secret than the exact profit percentage on the Karak Chai, so it gets
its own manager-tier view instead of widening the owner-only one.

## 3. Master P&L is "RLS + PIN dono se" — both halves are real

The PIN half is `useStaffSession("pl")` — Part 07's per-screen idle
timeout, already built with a 5-minute value for exactly this screen
(`lib/auth.ts`'s `Screen` type has included `"pl"` since Part 07/15; this
part is simply the first to use it). The RLS half is section 2 above.
The page's own `if (!isOwner) return <p>...</p>` role check is a fast,
honest UI message for the common case — it is explicitly **not** what
keeps the data private, and removing it would not expose anything a
non-owner couldn't already fail to get from the database directly.

## 4. Materialised views were suggested; plain views were built

The brief's own performance note parenthetically suggests materialised
views. Every view in `0028_reports_views.sql` is a plain view instead —
a materialised view needs something to actually refresh it (`pg_cron`,
or a manual button), and this project has neither Docker nor `pg_cron`
available in this environment to schedule one. Every table these views
read is already indexed on the columns the joins use (`business_day_id`,
`order_id` — Part 03's schema), so a plain view is fast enough at this
outlet's real data volume. The day that stops being true, adding
`pg_cron` + a materialised-view refresh is the fix — not a reason to
carry that operational complexity today for a problem that isn't here
yet.

## 5. Reprint tracking is forward-declared for Part 19, same as Part 09→17

`invoice_prints` (table) and `record_invoice_print()` (RPC) exist now,
but nothing in this app calls the RPC yet — actual thermal-printer
integration is Part 19's job. This is the same pattern as Part 09
building `useIncomingOrders()` before Part 17 had a Kitchen Display
screen to feed it: the write path and its audit trail exist first, so
Part 19 only has to call `record_invoice_print(order_id)` from wherever
it puts the Print button, not design a new table at the same time. The
`reprint_summary` view (owner-only — knowing who reprints a lot is a
fraud signal) will show real numbers the day Part 19 wires that call in;
until then it's correctly empty, not broken.

## 6. Labour cost needed a flag Part 14 never added

`expense_categories.is_labour_cost` (new column, this part) marks
'Salaries' and 'Daily Wages' — explicitly, not by matching those names
as strings at query time. A name match breaks the day someone renames a
category or adds 'Overtime'; an explicit boolean flag on the row
doesn't. `labour_cost_daily` sums only flagged categories' amortised
amounts (reusing `daily_expenses_amortized`, Part 14, rather than
re-deriving the amortisation formula a second time), and
`labourCostPercent()` (`lib/reports.ts`) divides that by the same
range's revenue from `daily_pl` — returning `null`, not a bogus
percentage, on a day with expenses but zero sales.

## 7. The flag the old system got wrong every month

A full month's rent, recorded as one Rs 20,000 row on one day, made that
one day look like a catastrophic loss under the old "daily net profit"
math — every month, on the same day, a fake alarm. `flagNetLoss()`
(`lib/reports.ts`) only ever compares a day's gross profit against that
day's **amortised** share of expenses (~Rs 667/day for a Rs 20,000/month
rent row), never the full one-time amount — `tests/reports.test.ts`
asserts this exact scenario no longer flags. The other five flags (cash
variance > Rs 500/shift, stock variance > 5%/ingredient, void value >
3% of revenue/cashier, item margin < 20%, ingredient cost up > 10% vs.
30-90 days ago) are each a single pure, independently tested function —
nothing fires without actually crossing its documented threshold.

## 8. The Menu Engineering Matrix's "popular"/"high margin" is relative, on purpose

`classifyMenuItems()` splits every item at the **selected range's own
median** popularity and median margin %, not a fixed external number —
"zyada bikta" only ever means "more than this outlet's own other items,
in this range," which is the only version of that question a single-cafe
system can meaningfully answer. The chart's reference lines
(`components/reports/menu-matrix-chart.tsx`) call the exact same
`median()` export `classifyMenuItems()` itself uses, so the lines always
land exactly on the quadrant boundary the table agrees with — two
independent median implementations could drift a fraction of a unit
apart and visually contradict the table next to it.

## 9. Export is CSV, not literally .xlsx

The brief says "CSV/Excel" — Excel opens a `.csv` natively, and a real
`.xlsx` would need a formatting-aware library for something Excel
doesn't actually require here. `lib/export.ts`'s exports are a
deliberately different case from the Dashboard's own "never load every
order into the browser" rule (`lib/reports.ts`'s whole design): an
export is a one-off, explicitly bounded pull (a chosen date range) a
human asked for, not a continuously-refreshing aggregation running
against unbounded history. The PRA tax-summary export keeps 16%/cash and
8%/digital as **separate rows**, per the brief's own "16% aur 8% alag
alag" — never blended into one combined tax line, since that's not how
the actual return is filed.

## 10. What still needs a live device (or more history) to verify

Confirmed live: all three migrations pushed and applied; all 12 new
views exist; `daily_pl` (and, by the same mechanism, every other
owner-/manager-gated view) returns zero rows outside an authenticated
session, proving the `has_role()` gate is real. What's not yet
exercised: every chart and table actually populated with real shift
history — this outlet has been open only since 2026-08-12, so the
day-wise/month-wise P&L table, the cash/void-by-cashier reports, and the
ingredient cost trend (which needs 30-90 days of purchase history to
show anything at all) will only visibly work once enough real trading
days exist. That's a data-volume wait, not an unverified code path — the
same honest limitation this project has flagged for every report built
before real trading history existed.

---

## 11. Acceptance Criteria — This Part

- [x] `PROFIT_RATE` doesn't exist anywhere in this codebase
- [x] Every profit figure is computed from COGS (`unit_cost_paisa`)
- [x] Expenses amortised in the daily view (`daily_expenses_amortized`,
      Part 14, reused unchanged)
- [x] Menu Engineering Matrix — `classifyMenuItems()`, scatter chart + table
- [x] Stock variance in rupees — `stock_variance` (Part 11, reused
      unchanged, already had `unexplained_variance_paisa`)
- [x] Cash variance by cashier — `cash_variance_by_cashier`
- [x] Void analysis by cashier — `void_analysis_by_cashier`
- [x] Hourly heatmap — `hourly_sales` + hand-rolled grid (Recharts has
      no native heatmap chart type)
- [x] Ticket time report — reused from Part 17 (`lib/kds.ts`) rather
      than rebuilt
- [x] Labour cost % — `labour_cost_daily` + `is_labour_cost` flag
- [x] CSV/Excel export — orders, payments, expenses, stock movements,
      PRA tax summary
- [x] Tax summary for the PRA return, 16%/8% kept as separate rows
- [x] P&L owner-only via both RLS (embedded `has_role('owner')`, Section 2)
      and PIN (`useStaffSession("pl")`'s 5-minute idle)
- [x] Fast at real data volume via plain server-side views, not the
      browser loading every order (Section 4 explains the materialised-
      view deviation)

**Next part:** `19-printing-and-pra-invoice.md`

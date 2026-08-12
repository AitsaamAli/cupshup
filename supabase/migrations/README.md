# supabase/migrations

Every database change lives here as a numbered SQL file, committed to git.
**No table is ever created by hand in the Supabase dashboard** — that's how
staging and production silently drift apart.

> ✅ **Live-verified 2026-08-12.** All 26 files below have actually been
> pushed to and applied against the real linked project (via
> `supabase db push --db-url ...`), not just reviewed on paper. 29/29
> tables have RLS enabled, all core functions exist, the seeded data
> counts match expectations, `business_date_of()` / `tax_rate_bp()` were
> queried live and returned the correct values, the expense
> amortization view was tested against a real 31-day row (which caught
> and fixed a genuine 9-paisa rounding bug), and all 21 real menu
> categories were confirmed backfilled to a `station` with none left
> null — see "Live verification" below, `docs/expenses.md` §3, and
> `docs/kitchen-display.md` for the details.

- `0001_schema.sql` — **Part 03.** Core schema: 29 tables, 10 enums, and the
  `ingredient_stock` view.
- `0002_auth_functions.sql` — **Part 07.** `current_staff()`, `has_role()`,
  `my_outlet()`, `list_active_staff()`, `verify_staff_pin()`,
  `set_staff_pin()`, `log_staff_logout()`.
- `0003_business_date_function.sql` — **Part 06.** `business_date_of()` —
  the fix for the local/UTC-mixing bug that misfiled 2am orders two
  calendar days in the past.
- `0004_tax_functions.sql` — **Part 05.** `tax_rate_bp()`, `class_of_method()`,
  `next_invoice_no()`.
- `0005_rls.sql` — **Part 04.** Row Level Security on every table; locks
  direct writes on `orders`, `order_items`, `payments`, `order_voids`,
  `business_days`, `shifts`, and both counter tables to RPC-functions-only.
  Two statements are commented out — see "Deferred statements" below.
- `0006_seed.sql` — **Part 03/05.** Outlet, tax rates + payment-method-tax
  mapping, full menu, expense categories, starter ingredient list, and one
  example recipe (Karak Chai).
- `0007_menu_functions.sql` — **Part 08.** `upsert_menu_item()`,
  `change_item_price()`, `toggle_86()`, `reorder_categories()`,
  `set_menu_item_active()` — original to this project, no reference file.
- `0008_menu_modifiers_seed.sql` — **Part 08.** Restructures the 9 seeded
  pizza rows into 3 base items + a shared "Size" modifier group; adds
  Sugar Level / Ice Level / Extra Shot / Add Cheese / No Onions.
- `0009_menu_storage.sql` — **Part 08.** `menu-images` Storage bucket
  (public read, owner/manager write) for menu item photos.
- `0010_order_engine_functions.sql` — **Part 09.** `current_price_paisa()`,
  `recipe_cost_paisa()`, `next_order_no()`, `place_order()`, `void_order()`
  (all from the reference `0002_functions.sql`), plus `advance_order_status()`
  and `add_items_to_order()` (original — not in the reference file, but
  named explicitly in Part 09's own brief).
- `0011_settlement_functions.sql` — **Part 10.** `settle_order()` — split
  payments, each taxed at its own rate, from the reference
  `0002_functions.sql`.
- `0012_inventory_functions.sql` — **Part 11.** `upsert_recipe_line()`,
  `remove_recipe_line()`, `record_purchase()` (weighted-average cost),
  `record_stock_count()` — original to this project.
- `0013_stock_variance_view.sql` — **Part 11.** `stock_variance` (subset
  of the reference file, plus an `unexplained_variance_paisa` column the
  reference didn't have). Also retroactively fixes a real RLS-bypass bug
  on `ingredient_stock` — see "A real bug found in Part 11" below.
- `0014_unit_conversions.sql` — **Part 11.** `unit_conversions` table —
  UI convenience only, not load-bearing (see `docs/inventory-and-recipes.md`).
- `0015_purchases_schema.sql` — **Part 12.** `purchases`, `purchase_lines`,
  `purchase_returns` tables + RLS; `suppliers.active` flag — original to
  this project, no reference file.
- `0016_purchases_functions.sql` — **Part 12.** `upsert_supplier()`,
  `set_supplier_active()`, `record_purchase_grn()` (multi-line goods
  receipt, same weighted-average formula as Part 11's `record_purchase()`),
  `record_purchase_return()`.
- `0017_supplier_payables_view.sql` — **Part 12.** `supplier_payables` —
  `security_invoker = true` from the start this time (see the RLS-bypass
  finding in Part 11).
- `0018_purchase_invoice_storage.sql` — **Part 12.** `purchase-invoices`
  Storage bucket — private (unlike `menu-images`), owner/manager only.
- `0019_business_day_functions.sql` — **Part 13.** `open_business_day()`,
  `close_business_day()` (both from the reference `0002_functions.sql` —
  this closes the last gap in `0005_rls.sql`'s original grant statement,
  tracked since Part 04), plus `open_shift()`, `close_shift()`,
  `record_cash_movement()` (original — per-cashier shifts aren't in the
  reference file, which only ever creates one shift per day). Also adds
  `expenses.shift_id` (nullable) — see `docs/business-day-and-shifts.md`.
- `0020_expenses_functions.sql` — **Part 14.** `record_expense()`
  (enforces the Rs 5,000/Rs 25,000 approval thresholds, sets the
  `shift_id` Part 13 added), `approve_expense()`, `update_expense()`,
  `delete_expense()` — original to this project; revokes the direct
  insert/update/delete grants the reference RLS file left open for this
  table, since none of them actually enforced the approval threshold.
- `0021_expense_amortization_view.sql` — **Part 14.**
  `daily_expenses_amortized` — `security_invoker = true`, and a
  last-day-absorbs-the-remainder rounding fix found by testing it
  against a real 31-day row (see `docs/expenses.md` §3).
- `0022_expense_receipt_storage.sql` — **Part 14.** `expense-receipts`
  Storage bucket — private, supervisor+ (matches who can record an
  expense at all).
- `0023_dining_tables_seed.sql` — **Part 16.** Seeds 10 dining tables
  (T1–T10) for the single outlet. `dining_tables` has existed since
  Part 03 but had zero rows — the POS table grid needed something real
  to show. A dedicated table-management screen (add/rename/remove) is
  out of scope for this part; see `docs/pos-terminal.md` §5.
- `0024_kds_schema.sql` — **Part 17.** `kitchen_station` enum;
  `menu_categories.station` (backfilled against all 21 real seeded
  categories, then set `not null`); `orders.ready_at` and
  `order_items.ready_at` — needed by the ticket-time report, since
  neither table previously recorded *when* a status change happened.
- `0025_kds_functions.sql` — **Part 17.** `advance_order_item_status()`,
  `mark_ticket_items_ready()`, `recall_order()` — original to this
  project. `order_items` has an existing `kds_update_items` RLS policy
  from `0005_rls.sql` that looks like it already permits kitchen roles
  to update item status directly, but that same file's later `revoke
  ... on ... order_items ... from anon, authenticated` blocks the write
  before RLS is ever consulted — these three `SECURITY DEFINER`
  functions are the real write path that policy's intent needed. See
  `docs/kitchen-display.md` §2.

`0001`, `0005`, and `0006` were copied from the project's pre-written
reference SQL at the repo root, per each part's own "reference SQL ready"
instruction. `0002`, `0003`, `0004`, `0010`, and `0011` are subsets
extracted from the project's full reference `0002_functions.sql` — see
below. `0007`–`0009` are original to this project — Part 08 has no
pre-written reference SQL.

## Why the numbering looks like this

Supabase's CLI tracks each migration by the numeric prefix **before the
first underscore** in its filename — that number becomes its primary key
in `supabase_migrations.schema_migrations` on the remote database. The
first real push against a live project (2026-08-12) failed with a
`duplicate key value violates unique constraint` error because three files
all started with `0002_` (auth functions, business-date function, tax
functions) — a naming collision that only surfaces once you actually push,
never during local review. Fixed by giving every file its own unique
prefix, preserving the exact same dependency order that was already
correct (see "Ordering dependency" below) — nothing about *what* runs
before *what* changed, only the numbers.

## ⚠️ Ordering dependency

The reference SQL was written as one coherent set spanning Parts 03–18, and
the full `0002_functions.sql` reference file bundles together: auth helpers
(`current_staff`, `has_role`, `my_outlet` — needed by Part 04's RLS
policies), the tax functions in `0004_tax_functions.sql`, `business_date_of()`
(Part 06), the order engine / settlement / void / business-day functions
(Parts 09, 10, 13), and the `daily_pl` / `product_performance` /
`stock_variance` reporting views (Part 18).

**What's been split out so far:** `current_staff`, `has_role`, `my_outlet`
(Part 07), `tax_rate_bp`, `class_of_method`, `next_invoice_no` (Part 05),
`business_date_of` (Part 06), `current_price_paisa`, `recipe_cost_paisa`,
`next_order_no`, `place_order`, `void_order` (Part 09), `settle_order`
(Part 10), `stock_variance` (Part 11, extended with a rupee column the
reference didn't have), and `open_business_day`/`close_business_day`
(Part 13). None of these call anything beyond what Part 03's schema
already created, so extracting them ahead of the parts that formally
introduce them elsewhere in the guide is safe — confirmed live, not just
in theory.

**What's still missing:** `daily_pl` and `product_performance` (Part 18)
— the only two pieces of the full reference file left.

## A real bug found in Part 11: RLS-bypassing views

A plain `create view` (no `security_invoker`) is owned by whichever role
runs migrations — Supabase's migration runner, which has `BYPASSRLS`.
Postgres then applies RLS using the *view owner's* exemption when the
view is queried, not the querying user's. `ingredient_stock` (Part 03's
reference view, copied byte-for-byte) had exactly this shape, meaning it
was silently showing **every outlet's** ingredient stock to any
authenticated staff member — invisible only because this deployment has a
single outlet. `0013_stock_variance_view.sql` fixes it with `alter view
ingredient_stock set (security_invoker = true);` and applies the same
setting to the new `stock_variance` view. Verified live: `pg_class.
reloptions` shows `security_invoker=true` on both.

## Deferred statements in `0005_rls.sql`

Two statements from the reference file were commented out, because
pushing them against the live project failed on exactly the
forward-dependency gap documented above:

1. `revoke all on daily_pl, product_performance, stock_variance ...` /
   `grant select on daily_pl, ... to authenticated` — **still deferred.**
   These three views don't exist until Part 18. Re-added, uncommented, in
   a small migration once Part 18 lands — not by editing `0005_rls.sql`
   again (it's already been applied to the live database; migrations are
   append-only from here on, same as every other table in this project).
2. The final `grant execute on function place_order, settle_order,
   void_order, open_business_day, close_business_day to authenticated` —
   **fully resolved as of Part 13.** All five functions now have their
   own explicit grants in their own migration files
   (`0010`/`0011`/`0019`), so this specific statement is permanently
   superseded rather than needing to be replayed — nothing left to
   re-add for it.

## Live verification (2026-08-12)

Run against the real linked project via `supabase db query --db-url ...`:

```sql
select (select count(*) from menu_items) as items,                 -- 93
       (select count(*) from menu_items where active) as active,   -- 87 (6 pizza-size duplicates deactivated)
       (select count(*) from tax_rates) as tax_rates,               -- 3
       (select count(*) from modifier_groups) as modifier_groups,   -- 6
       (select count(*) from pg_tables where schemaname='public' and rowsecurity) as tables_with_rls; -- 29

select business_date_of('2026-08-12 02:00:00+05'::timestamptz);  -- 2026-08-11 (not 2026-08-10 — the headline bug)
select tax_rate_bp('cash', current_date);     -- 1600 (16%)
select tax_rate_bp('digital', current_date);  -- 800 (8%)
```

All returned the expected values. What's *not* yet exercised end-to-end:
`place_order()`/`settle_order()`/the auth PIN flow, since those need actual
staff rows, an open business day, and real HTTP calls through the Next.js
app rather than raw SQL — see each part's own doc (`docs/order-engine.md`,
`docs/payment-and-settlement.md`, `docs/auth-design.md`) for what's still
open there.

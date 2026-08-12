# supabase/migrations

Every database change lives here as a numbered SQL file, committed to git.
**No table is ever created by hand in the Supabase dashboard** — that's how
staging and production silently drift apart.

> ✅ **Live-verified, most recently 2026-08-13.** All 35 files below
> have actually been pushed to and applied against the real linked
> project (via `supabase db push --db-url ...`), not just reviewed on
> paper. 29/29 tables have RLS enabled, all core functions exist, the
> seeded data counts match expectations, `business_date_of()` /
> `tax_rate_bp()` were queried live and returned the correct values, the
> expense amortization view was tested against a real 31-day row (which
> caught and fixed a genuine 9-paisa rounding bug), all 21 real menu
> categories were confirmed backfilled to a `station` with none left
> null, every Part 18 owner-only view was confirmed to return zero rows
> outside an authenticated session, `record_invoice_print()` was
> confirmed to return `integer` (not `void`) after Part 19's
> redefinition, and a live adversarial audit on 2026-08-13 found and
> fixed 5 real bugs — including a CRITICAL cross-outlet write bypass —
> by actually attacking the running application (not just reviewing its
> source) — see "Live verification" below, `docs/expenses.md` §3,
> `docs/kitchen-display.md`, `docs/reports-and-pl.md`,
> `docs/security-audit-2026-08-13.md`, and
> `docs/printing-and-pra-invoice.md` for the details.

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
- `0026_reports_schema.sql` — **Part 18.** `expense_categories.
  is_labour_cost` (explicit flag, backfilled for 'Salaries'/'Daily
  Wages' — not a fragile name match at query time); `invoice_prints` —
  a reprint audit trail with nothing to write to it yet, forward-declared
  for Part 19's actual printing feature the same way Part 09 built
  `useIncomingOrders()` before Part 17 existed.
- `0027_reports_functions.sql` — **Part 18.** `record_invoice_print()` —
  original to this project, any staff member may call it (printing a
  bill isn't manager-only), the resulting report is owner-only.
  *(Redefined in Part 19's `0030_printing_functions.sql` to return the
  print's sequence number instead of `void` — see below.)*
- `0028_reports_views.sql` — **Part 18.** Resolves the last forward
  reference tracked in this file: `daily_pl` and `product_performance`
  (the two pieces of the full reference file left since Part 11 — see
  "Ordering dependency" below), plus nine original views
  (`item_revenue_daily`, `category_revenue_daily`, `hourly_sales`,
  `payment_mix_daily`, `tax_summary_daily`, `cash_variance_by_cashier`,
  `void_analysis_by_cashier`, `reprint_summary`, `labour_cost_daily`,
  `ingredient_cost_trend`). Owner-only views embed `and has_role
  ('owner')` directly in their `where` clause rather than relying on
  `grant`/`revoke` alone — see `docs/reports-and-pl.md` §2 for why the
  reference file's own `revoke all ...; grant select ... to
  authenticated` (still commented out below) could never have achieved
  real owner-exclusivity by itself.
- `0029_printing_schema.sql` — **Part 19.** `pra_submission_status` enum;
  `pra_submission_queue` (the offline PRA retry queue); drops the Part
  18 version of `record_invoice_print()` so its return type can change
  (Postgres won't let `create or replace` do that).
- `0030_printing_functions.sql` — **Part 19.** `record_invoice_print()`
  redefined to return the print's own sequence number (needed to render
  "REPRINT #N" immediately, without a second query — the underlying
  `invoice_prints` table from Part 18 is unchanged);
  `enqueue_pra_submission()`, `record_pra_result()`,
  `record_pra_failure()` (exponential backoff computed in SQL, capped at
  60 minutes).
- `0031_pgtap_extension.sql` — **Part 20.** Enables pgTAP
  (`supabase/tests/database/*.sql`), installed into the `extensions`
  schema (Supabase's own convention, alongside `pgcrypto`).
- `0032_idempotency_bugfix.sql` — **Part 20.** A real bug, found by
  actually running `supabase/tests/database/idempotency.sql` live:
  `place_order()`'s duplicate-order guard (`if v_existing is not null`)
  never actually matched a found row, since Postgres's `ROW IS NOT NULL`
  requires every column non-null and a real order always has some that
  aren't. Confirmed broken, then confirmed fixed, both against the live
  database, before writing this migration — full story in its own
  comment and `docs/testing-strategy.md` §3. Also applies the same fix
  to `log_staff_logout()` (0002_auth_functions.sql), the only other
  place the same pattern appeared.
- `0033_pgcrypto_search_path_bugfix.sql` — live-audit finding, 2026-08-13.
  `verify_staff_pin()`/`set_staff_pin()` call `crypt()`/`gen_salt()`, but
  `pgcrypto` lives in Supabase's own `extensions` schema on this
  project (confirmed live), not `public` — every `SECURITY DEFINER`
  function here restricts `search_path` to `public`, so those calls
  were simply unreachable. Every PIN login was broken until this fix.
  Full incident record: `docs/security-audit-2026-08-13.md`.
- `0034_place_order_race_fix.sql` — live-audit finding: firing 20
  genuinely concurrent `place_order()` calls with the same idempotency
  key showed ~1 in 20 callers getting a raw `duplicate key` constraint
  error instead of the graceful `duplicate: true` response (never an
  actual duplicate order — the constraint always held). Fixed by
  catching `unique_violation` around the insert. Regression:
  `scripts/live-audit/concurrency-attack.mjs`.
- `0035_cross_outlet_isolation_fix.sql` — live-audit finding, **CRITICAL**:
  a staff member from a completely different outlet could write real
  orders into this outlet's data by passing/guessing its IDs — every
  write RPC in the order/KDS/printing/business-day path checked WHO the
  caller is but never WHICH OUTLET the row belonged to. Fixed across all
  13 affected functions (`place_order`, `open_business_day`,
  `void_order`, `advance_order_status`, `add_items_to_order`,
  `settle_order`, `advance_order_item_status`,
  `mark_ticket_items_ready`, `recall_order`, `record_invoice_print`,
  `enqueue_pra_submission`, `record_pra_result`, `record_pra_failure`).
  Regression: `scripts/live-audit/cross-outlet-attack.mjs` and
  `supabase/tests/database/cross_outlet_isolation.sql`. Full incident
  record: `docs/security-audit-2026-08-13.md`.

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

**Fully resolved as of Part 18:** `daily_pl` and `product_performance`
now exist (`0028_reports_views.sql`) — nothing left from the full
reference file unextracted.

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
   `grant select on daily_pl, ... to authenticated` — **superseded, not
   replayed.** `stock_variance` got its own explicit handling in Part 11
   (`0013_stock_variance_view.sql`, `security_invoker = true`, no
   special grant needed beyond normal RLS). `daily_pl`/`product_performance`
   arrived in Part 18 (`0028_reports_views.sql`) with a stricter, real
   per-role gate (`has_role('owner')` embedded in the view itself) that
   this commented-out statement could never have achieved on its own —
   see `docs/reports-and-pl.md` §2 for why a `grant`/`revoke` to the one
   shared `authenticated` role can't distinguish an owner from a cashier.
   This line stays commented out permanently; nothing will ever uncomment it.
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

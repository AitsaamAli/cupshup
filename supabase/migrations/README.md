# supabase/migrations

Every database change lives here as a numbered SQL file, committed to git.
**No table is ever created by hand in the Supabase dashboard** — that's how
staging and production silently drift apart.

- `0001_schema.sql` — **Part 03.** Core schema: 29 tables, 10 enums, and the
  `ingredient_stock` view.
- `0002_auth_functions.sql` — **Part 07.** `current_staff()`, `has_role()`,
  `my_outlet()`, `list_active_staff()`, `verify_staff_pin()`,
  `set_staff_pin()`, `log_staff_logout()`. Closes the Part 04 dependency gap
  described below for these three helpers specifically.
- `0002_business_date_function.sql` — **Part 06.** `business_date_of()` —
  the fix for the local/UTC-mixing bug that misfiled 2am orders two
  calendar days in the past. Zero dependencies, safe to land standalone.
- `0002_tax_functions.sql` — **Part 05.** `tax_rate_bp()`, `class_of_method()`,
  `next_invoice_no()`. A deliberate subset of the project's full reference
  `0002_functions.sql` — see the ordering note below.
- `0003_rls.sql` — **Part 04.** Row Level Security on every table; locks
  direct writes on `orders`, `order_items`, `payments`, `order_voids`,
  `business_days`, `shifts`, and both counter tables to RPC-functions-only.
- `0004_seed.sql` — **Part 03/05.** Outlet, tax rates + payment-method-tax
  mapping, full menu, expense categories, starter ingredient list, and one
  example recipe (Karak Chai).
- `0005_menu_functions.sql` — **Part 08.** `upsert_menu_item()`,
  `change_item_price()`, `toggle_86()`, `reorder_categories()`,
  `set_menu_item_active()` — original to this project, no reference file.
- `0006_menu_modifiers_seed.sql` — **Part 08.** Restructures the 9 seeded
  pizza rows into 3 base items + a shared "Size" modifier group; adds
  Sugar Level / Ice Level / Extra Shot / Add Cheese / No Onions.
- `0007_menu_storage.sql` — **Part 08.** `menu-images` Storage bucket
  (public read, owner/manager write) for menu item photos.
- `0008_order_engine_functions.sql` — **Part 09.** `current_price_paisa()`,
  `recipe_cost_paisa()`, `next_order_no()`, `place_order()`, `void_order()`
  (all from the reference `0002_functions.sql`), plus `advance_order_status()`
  and `add_items_to_order()` (original — not in the reference file, but
  named explicitly in Part 09's own brief).
- `0009_settlement_functions.sql` — **Part 10.** `settle_order()` — split
  payments, each taxed at its own rate, from the reference
  `0002_functions.sql`.

`0001`, `0003`, and `0004` were copied from the project's pre-written
reference SQL at the repo root, per each part's own "reference SQL ready"
instruction. The `0002_*` files and `0008` are subsets extracted from the
project's full reference `0002_functions.sql` — see below. `0005`–`0007`
are original to this project — Part 08 has no pre-written reference SQL.

## ⚠️ Ordering dependency — read before running migrations

The reference SQL was written as one coherent set spanning Parts 03–18, and
the full `0002_functions.sql` reference file bundles together: auth helpers
(`current_staff`, `has_role`, `my_outlet` — needed by Part 04's RLS
policies), the tax functions in `0002_tax_functions.sql`, `business_date_of()`
(Part 06), the order engine / settlement / void / business-day functions
(Parts 09, 10, 13), and the `daily_pl` / `product_performance` /
`stock_variance` reporting views (Part 18).

**What's been split out so far:** `current_staff`, `has_role`, `my_outlet`
(Part 07 — this closed the RLS-policy gap), `tax_rate_bp`, `class_of_method`,
`next_invoice_no` (Part 05), `business_date_of` (Part 06),
`current_price_paisa`, `recipe_cost_paisa`, `next_order_no`, `place_order`,
`void_order` (Part 09), and `settle_order` (Part 10). None of these call
anything beyond what Part 03's schema already created, so extracting them
ahead of the parts that formally introduce them elsewhere in the guide is
safe.

**What's still missing:** `open_business_day`, `close_business_day`, and
the three reporting views (`daily_pl`, `product_performance`,
`stock_variance`). Until those land (Parts 13/18), `0003_rls.sql`'s final
`grant execute on function place_order, settle_order, void_order,
open_business_day, close_business_day...` line will still fail as one
statement — but `place_order`, `void_order`, and `settle_order` are all
already directly usable now via the explicit grants added alongside each
in their own migration file, so this no longer blocks any actual
functionality, only that one leftover multi-function grant statement from
Part 04's reference file.

When the remaining functions land, they arrive in their own new migration
file (not by renaming/overwriting anything here) — they `create or replace`
the functions already split out above identically along the way, which is
a harmless no-op.

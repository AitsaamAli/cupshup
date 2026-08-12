# app/manage/inventory

Ingredient stock, viewed as the live sum of the `stock_movements` ledger
(never a stored counter) — **built in Part 11**. Log wastage, record
purchases (updates weighted-average cost), and low-stock warnings via
Realtime.

- `recipes/` — set what each menu item is made of; live cost + margin %.
- `count/` — physical stock count, reconciled against the ledger.
- `variance/` — the variance report: theoretical use vs. declared loss
  vs. what counts actually found, in both quantity and rupees.

Everything here calls the RPCs in
`supabase/migrations/0012_inventory_functions.sql`, except wastage
logging, which is a direct RLS-gated insert (Part 04's `log_wastage`
policy already covers it — see `docs/inventory-and-recipes.md`).

Deliveries are extended further in **Part 12 — Purchases & Suppliers**
(`/manage/purchases`, `/manage/suppliers`) — a full GRN with multiple
lines, invoice tracking, and payment status, on top of this screen's
quick single-ingredient "Record purchase" action.

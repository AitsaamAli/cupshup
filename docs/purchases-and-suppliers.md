# Cup Shup POS — Purchases & Suppliers

**Depends on:** Part 11
**Code delivered in this part:** `supabase/migrations/0015_purchases_schema.sql`,
`0016_purchases_functions.sql`, `0017_supplier_payables_view.sql`,
`0018_purchase_invoice_storage.sql`, `lib/purchases.ts`,
`app/manage/suppliers/`, `app/manage/purchases/`

---

## 1. What was missing

Before this part, the only way stock came *in* was Part 11's single-line
`record_purchase()` — fine for a quick top-up, but with no invoice
reference, no way to represent a delivery with ten different ingredients
on one bill, no payment tracking, and no supplier history. This part adds
the real Goods Receipt Note (GRN) structure the brief asks for:
`purchases` (header) + `purchase_lines` (detail), both new tables — they
weren't in Part 03's schema and aren't in the reference file, since Part 12
has no pre-written reference SQL.

`record_purchase()` (Part 11) still exists, unchanged, for the quick
single-ingredient case. `record_purchase_grn()` (this part) is the proper
multi-line version — same weighted-average formula, applied per line,
inside one transaction that also creates the purchase header and every
line.

## 2. The weighted-average formula, verified against the brief's own example

```
new_avg = (current_stock × current_avg + new_qty × new_cost)
          ÷ (current_stock + new_qty)
```

The brief's worked example — 10kg on hand at Rs 800, buy 10kg at Rs 900,
expect a new average of exactly Rs 850 — is `previewWeightedAvgCost(10,
80000, 10, 90000) === 85000` in `tests/purchases.test.ts`, and matches
`record_purchase_grn()`'s SQL formula exactly (same relationship
`previewSplitTax()` has to `settle_order()`'s tax math from Part 10 —
a client-side preview of the same arithmetic the server actually runs,
not a second implementation that could drift from it).

## 3. Purchase returns are a reversal, never a delete

`record_purchase_return()` never touches the original `purchases`/
`purchase_lines` rows — it inserts a `purchase_returns` row and a
`stock_movements` row taking the returned quantity back out, using
`movement_type = 'transfer'` (the closest existing fit in the enum for
"stock leaving for a reason that's neither a sale nor wastage," rather
than adding a new enum value for one narrow case).

**Deliberate simplification, documented, not an oversight:** a return
does **not** recompute `moving_avg_cost_paisa`. Unwinding a weighted
average precisely requires knowing the exact prior state at the moment of
the original purchase, which isn't reliably reconstructable from the
ledger alone once other purchases/sales have happened since. The average
is left as-is after a return.

## 4. Supplier payables and price alerts

`supplier_payables` (a view, `security_invoker = true` **from the start**
this time — Part 11 found the hard way, on `ingredient_stock`, that a
plain view silently bypasses RLS for every caller) sums
`total_paisa − amount_paid_paisa` across every non-`paid` purchase, per
supplier — "kis supplier ka kitna udhaar hai."

Rate-increase alerts (`findPriceIncreaseAlerts()`) are computed
client-side by comparing each ingredient's two most recent purchase
prices — a simple last-two-points comparison per ingredient, not
something that needed a dedicated SQL view. Flags anything up 10% or more,
exactly the brief's own example ("Cheese ka rate pichle mahine se 18%
barh gaya").

## 5. Invoice photos are private, unlike menu photos

`purchase-invoices` (Part 12) is a **private** Storage bucket, unlike
`menu-images` (Part 08, public read) — a supplier's invoice can reveal
pricing/terms an outlet may not want publicly readable. Both read and
write are restricted to owner/manager.

## 6. What still needs a live database to fully exercise

Same pattern as every part: `record_purchase_grn()`, `record_purchase_return()`,
and `upsert_supplier()` all check `current_staff()`, which needs a real
PIN-authenticated session this environment doesn't have yet. What *has*
been verified live: all 4 new functions exist, `supplier_payables` returns
correctly (0 rows — no suppliers seeded yet, which is itself correct), and
its `security_invoker` setting is confirmed via `pg_class.reloptions`,
matching the fix applied to `ingredient_stock`/`stock_variance` in Part 11.

---

## 7. Acceptance Criteria — This Part

- [x] Supplier CRUD built (`upsert_supplier()`, `set_supplier_active()` —
      "delete" is retire, matching every other entity in this app)
- [x] GRN screen built — supplier, date (implicit via `created_at`),
      lines, auto-computed total
- [x] GRN save creates `purchase` stock movements — one per line
- [x] `moving_avg_cost_paisa` updates correctly — verified against the
      brief's exact example (Section 2)
- [x] Invoice photo upload (private Storage bucket)
- [x] Payment status tracked (paid/credit/partial)
- [x] Supplier payable total shown (`supplier_payables` view)
- [x] Ingredient price history chart (`/manage/purchases/prices`)
- [x] 10%+ rate increase alert
- [x] **Test:** 10kg @ Rs 800 in stock, buy 10kg @ Rs 900 → new average is
      exactly Rs 850 — verified in `tests/purchases.test.ts`

**Next part:** `13-business-day-and-shifts.md`

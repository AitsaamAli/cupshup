# Cup Shup POS — Inventory & Recipes

**Depends on:** Part 03, Part 09, Part 10
**Code delivered in this part:** `supabase/migrations/0012_inventory_functions.sql`,
`0013_stock_variance_view.sql`, `0014_unit_conversions.sql`, `lib/inventory.ts`,
`lib/units.ts`, `app/manage/inventory/`

---

## 1. Most of "inventory ka sales se koi taluq nahi" was already fixed

The prototype's core complaint — selling 40 burgers changed nothing in
inventory — was actually already solved as a side effect of Parts 09 and
10, before this part existed:

- **`settle_order()`** (Part 10) already deducts `recipe_lines.qty × qty
  sold` as a `sale_depletion` stock movement the instant an order is paid
  for.
- **`void_order()`** (Part 09) already reverses that with a `void_return`
  movement if a settled order gets voided.
- **Wastage/staff-meal logging needed no new RPC at all.** Part 04's
  `log_wastage` RLS policy already lets kitchen roles insert directly into
  `stock_movements` for exactly those two movement types — and only those
  — with `purchase`/`count_adjustment` locked to owner/manager. `lib/
  inventory.ts`'s `logWastage()` is a plain, RLS-gated insert, not an RPC.

What this part actually adds: **a way to define recipes**, **a way to
record a purchase** (with the weighted-average cost update), **a way to
reconcile a physical count**, and **the variance report** that ties it all
together.

## 2. The variance report — and a real security finding along the way

`stock_variance` (in `0013_stock_variance_view.sql`) is a subset of the
project's full reference `0002_functions.sql` — same "extracted ahead of
the part that formally introduces it" pattern used for `daily_pl`'s
siblings, because Part 11's own brief names this exact report and gives
its formula. One addition beyond the reference: `unexplained_variance_paisa`,
converting the count-adjustment quantity into rupees via the ingredient's
`moving_avg_cost_paisa`, since the brief explicitly asks for the variance
in rupees, which the reference definition (written with Part 18 in mind)
didn't include.

While building this, I found a **real, live-confirmed security gap** in
`ingredient_stock` — Part 03's reference view, copied byte-for-byte back
then. A plain `create view` is owned by whichever role runs migrations
(Supabase's migration runner, which has `BYPASSRLS`), and Postgres applies
RLS using the *view owner's* exemption in that case — not the querying
user's. That means `ingredient_stock` was silently showing **every
outlet's** stock data to any authenticated staff member, not just their
own, contradicting this project's own outlet-scoping rule
(`docs/architecture.md` rule #5). Currently invisible only because this
deployment has a single outlet. Fixed both views with `security_invoker =
true` (Postgres 15+, confirmed present on the live project) — verified
live: `pg_class.reloptions` shows `security_invoker=true` on both
`ingredient_stock` and `stock_variance` after the push.

## 3. Recipe cost and margin — computed the same way the server does

The recipe editor (`/manage/inventory/recipes`) shows a live cost and
margin % while an owner/manager/chef edits a recipe. That figure is
computed client-side as `sum(qty × ingredient.moving_avg_cost_paisa)` —
the exact same formula `recipe_cost_paisa()` (Part 09) uses server-side —
so what the editor shows an owner while they're working is never a
different number from what `place_order()` actually snapshots onto an
order line later.

## 4. Weighted-average cost

`record_purchase()` blends what's already on the shelf (at its existing
average cost) with what just arrived (at its own cost):

```
new_avg = (current_stock × old_avg + purchased_qty × purchase_cost)
          ÷ (current_stock + purchased_qty)
```

If there's nothing on hand yet, the new cost simply becomes the purchase
cost. This is the number every `recipe_cost_paisa()` call, every order's
`cogs_paisa`, and eventually every margin figure in Master P&L (Part 18)
ultimately traces back to — get it right here or every report downstream
inherits the error.

## 5. Unit conversions — solved twice, deliberately

The schema already sidesteps the "buy in kg, use in grams" problem without
any conversion table: `recipe_lines.qty` and `stock_movements.qty` are
both `numeric(12,4)` **in the ingredient's own unit**, so 150ml of a
Litre-tracked ingredient is simply the decimal `0.150` (already how the
seeded Karak Chai recipe works). `unit_conversions` (`0014`) is added
anyway, since the brief names it explicitly, but it's a **UI convenience
only** — letting a future input form accept "50g" and convert it — not
something the ledger math depends on. `lib/units.ts`'s `convertQty()`
wraps it; nothing in this part's screens currently calls it, since none of
today's forms needed unit-typing convenience yet.

## 6. What still needs a live database to fully exercise

Consistent with every part so far: `record_purchase()`, `record_stock_count()`,
`upsert_recipe_line()` all need a real, PIN-authenticated staff session to
call (they check `current_staff()`), which needs actual seeded staff and
`auth.users` rows this environment doesn't have yet. What *has* been
verified live: all 4 new functions exist, `stock_variance` returns 12 rows
(matching the 12 seeded ingredients) with correct `security_invoker`
settings on both views, and `unit_conversions` seeded its 4 rows correctly
— all confirmed via `supabase db query` against the real project.

---

## 7. Acceptance Criteria — This Part

- [x] No `current_stock` column on `ingredients` (true since Part 03;
      unchanged here)
- [x] Current stock comes from `ingredient_stock`'s `sum()` — now
      correctly outlet-scoped via `security_invoker`
- [x] Recipe table existed since Part 03; this part adds the editor UI —
      only Karak Chai has a recipe seeded so far (0004/0006's example);
      filling in the other ~90 items is real, ongoing menu-costing work
      for the owner/chef to do through the new screen, not something a
      migration can responsibly invent
- [x] Stock auto-deducts on settlement — already true since Part 10
- [x] Stock returns on void — already true since Part 09
- [x] Wastage recorded separately, with a reason code
- [x] Physical count screen built, shows variance
- [x] Variance report built and live-verified
- [x] Unit conversion table exists (`kg↔g`, `L↔ml`)
- [x] Low-stock surfaces via Realtime (`useIngredientStock()`, same
      pattern as Part 08/09's live hooks)
- [x] Stock movements are never updated/deleted — no UPDATE/DELETE
      policy exists on `stock_movements` (Part 04), and nothing built
      since has added one
- [ ] **Test:** sell 10 Karak Chai → 1.5L milk consumed — the arithmetic
      is already correct by construction (`0.150L × 10 = 1.5L`, exactly
      `settle_order()`'s existing loop), but running it as a real
      end-to-end test needs a staff session and an open business day —
      see Section 6

**Next part:** `12-purchases-and-suppliers.md`

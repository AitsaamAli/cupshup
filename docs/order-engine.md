# Cup Shup POS — Order Engine

**Depends on:** Part 03, Part 04, Part 06, Part 08
**Code delivered in this part:** `supabase/migrations/0008_order_engine_functions.sql`,
`lib/orders.ts`, `tests/orders.test.ts`

---

## 1. The one rule everything here protects

**The browser never sends a price.**

```
✗ Wrong:  client → "this order is Rs 5,240" → server just saves it
✓ Right:  client → "these items, please"    → server looks up every price itself
```

In the old prototype, subtotal/tax/total were all computed in the browser.
Anyone with DevTools open could rewrite a Rs 5,000 bill down to Rs 50 before
it ever reached the server. `place_order()` never reads a price, a subtotal,
or a total from its input — `p_items` carries only `menu_item_id`, `qty`,
`modifiers`, and `note`. Every rupee is looked up from
`menu_item_prices`/`recipe_lines` inside the same transaction that creates
the order.

## 2. What's copied from the reference file vs. original to this part

`current_price_paisa()`, `recipe_cost_paisa()`, `next_order_no()`,
`place_order()`, and `void_order()` are copied verbatim from the project's
full reference `0002_functions.sql` — the same file Parts 05/06/07 already
pulled pieces from (see `supabase/migrations/README.md` for the running
account of what's been split out and why).

`advance_order_status()` and `add_items_to_order()` are **not** in that
reference file. Part 09's own brief asks for both by name — a function that
moves `orders.status` forward with transition validation, and a way to add
items to an order that hasn't paid yet — but the reference file doesn't
contain either, so they're original to this migration. Both follow the same
shape as everything else here: `SECURITY DEFINER`, internal role/state
checks, and an `audit_log` entry.

## 3. Why order creation and payment are separate

```
open → sent_to_kitchen → ready → served → settled
                                              ↓
                                          (voided)
```

The old system only had "place order." That's not enough for dine-in: a
customer orders, eats, and pays *afterward* — sometimes adding a dessert
order in between. `place_order()` never asks for a payment method.
Settlement is Part 10's job (`settle_order()`), called separately once the
customer is actually ready to pay.

`advance_order_status()` only allows `sent_to_kitchen → ready` and
`ready → served` — it deliberately rejects `settled` and `voided` as
targets, since those carry real financial/reversal logic that only
`settle_order()` (Part 10) and `void_order()` (above) are allowed to
perform. There is no way to "advance" an order into being paid for.

## 4. The duplicate-order bug

```js
const order = { id: "order:" + Date.now(), ... };
```

Two terminals creating an order in the same millisecond collided on this
key — one order silently vanished. A double-tap on a laggy tablet created
two real bills. `place_order()`'s idempotency key fixes both: the client
generates a UUID once per order attempt
(`crypto.randomUUID()` in `lib/orders.ts`), and
`unique (outlet_id, idempotency_key)` on the `orders` table means a second
call with the same key returns the **original** order (`duplicate: true`
in the response) instead of creating a new one. `lib/orders.ts`'s
`OrderError` carries that exact key back to the caller, so a retry after a
network failure reuses it — never generates a fresh one, which is what
would turn a safe retry into a real duplicate.

## 5. Day control is enforced in the database, not just the UI

The old system showed a "day not opened" banner, but the order still got
created anyway — and still could be, after the day closed. `place_order()`
and `add_items_to_order()` both check `business_days.status = 'open'`
inside the transaction and `raise exception` otherwise; there is no code
path that reaches an `orders` insert while the day is closed, regardless of
what any client believes about the day's state.

## 6. What still needs a live database to actually verify

Consistent with every part since Part 03 — no Docker, no linked Supabase
project in this environment — the following acceptance-criteria items are
genuine integration tests that need a real Postgres connection and haven't
been run. They're recorded here as the exact manual check to run once one
exists (or to automate in Part 20):

```sql
-- 1. Client-supplied price is ignored
select place_order(
  '<outlet_id>', 'dine_in',
  '[{"menu_item_id": "<item_id>", "qty": 1, "total": 1}]'::jsonb,
  gen_random_uuid()::text
);
-- Expect: order.subtotal_paisa equals the item's REAL current price, not 1.

-- 2. Same idempotency key never creates a second order
-- Run this exact call twice with the same key (simulate from two sessions
-- for a true concurrency test — e.g. `pgbench` or 10 parallel psql calls):
select place_order('<outlet_id>', 'dine_in', '[...]'::jsonb, 'fixed-test-key');
select place_order('<outlet_id>', 'dine_in', '[...]'::jsonb, 'fixed-test-key');
-- Expect: second call returns duplicate: true, and
-- select count(*) from orders where idempotency_key = 'fixed-test-key' = 1.

-- 3. Closed day blocks order creation
-- (after calling close_business_day() from Part 13, once it exists)
select place_order('<outlet_id>', 'dine_in', '[...]'::jsonb, gen_random_uuid()::text);
-- Expect: exception 'DAY: ... is closed — orders are blocked'.

-- 4. An 86'd item can't be ordered
update menu_items set is_86 = true where id = '<item_id>';
select place_order('<outlet_id>', 'dine_in',
  ('[{"menu_item_id":"' || '<item_id>' || '","qty":1}]')::jsonb,
  gen_random_uuid()::text);
-- Expect: exception 'ITEM: menu item unavailable'.

-- 5. Empty / zero-value order is rejected
select place_order('<outlet_id>', 'dine_in', '[]'::jsonb, gen_random_uuid()::text);
-- Expect: exception 'ORDER: empty or zero-value order'.
```

What **has** been verified without a database: `lib/orders.ts`'s
idempotency-key contract (fresh key generated when none is given, provided
key reused exactly on retry, never silently replaced) and the exact shape
of every RPC call — via mocked-client tests in `tests/orders.test.ts` (10
cases, all passing). Realtime delivery to KDS (`useIncomingOrders()`) is
built and ready to consume once Part 17 has a screen to render it on, but
like everything Realtime, needs a live project to actually observe firing.

---

## 7. Acceptance Criteria — This Part

- [x] `place_order()` RPC built
- [x] Any client-sent price is ignored — the function never reads one
- [x] Same idempotency key → same order, never a new one (mechanism in
      place; concurrency behavior needs a live DB — Section 6, item 2)
- [x] Day not open → order blocked (mechanism in place; Section 6, item 3)
- [x] Day closed → order blocked (same)
- [x] 86'd item can't be ordered (mechanism in place; Section 6, item 4)
- [x] `unit_cost_paisa` saved on every line (`recipe_cost_paisa()` snapshot)
- [x] Empty/zero-value order rejected (Section 6, item 5)
- [x] Order reaches KDS via Realtime — `useIncomingOrders()` built, wiring
      to an actual KDS screen is Part 17
- [ ] **Test:** client sends `total: 1`, server computes the real total —
      SQL written above (Section 6, item 1), not yet run against a live DB
- [ ] **Test:** 10 concurrent calls, same key, only 1 order — SQL written
      above (Section 6, item 2), needs real concurrency against a live DB

**Next part:** `10-payment-and-settlement.md`

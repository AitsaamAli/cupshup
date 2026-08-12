# Cup Shup POS — Payment & Settlement

**Depends on:** Part 05, Part 06, Part 09
**Code delivered in this part:** `supabase/migrations/0009_settlement_functions.sql`,
`lib/settlement.ts`, `app/pos/settle/[orderId]/page.tsx`,
`components/pos/manager-auth-dialog.tsx`

---

## 1. The design flaw this part fixes

```js
const taxRate = taxRateFor(payment);   // chosen while building the cart
const tax = subtotal * taxRate;
```

The old system asked the cashier to pick Cash/Card **before** the order
existed. Real dine-in doesn't work that way: the customer orders, eats,
*then* asks for the bill — and often splits it (Rs 2,000 cash + Rs 3,500
card). Since Punjab taxes by payment method, a split bill genuinely has
**two different tax rates on one bill**, something a single `payment`
string on the order could never express. `settle_order()` (copied verbatim
from the project's reference `0002_functions.sql`) is what Part 09's
`place_order()` was always missing: order creation and payment are two
separate steps, and payment can be split any way the customer wants, each
split taxed at its own rate.

## 2. The worked example, actually tested

Bill base Rs 5,000, split Rs 2,000 cash + Rs 3,000 card:

| Split | Base | Rate | Tax | Total |
|---|---|---|---|---|
| Cash | 2,000 | 16% | 320 | 2,320 |
| Card | 3,000 | 8% | 240 | 3,240 |
| **Sum** | **5,000** | — | **560** | **5,560** |

This exact scenario is `tests/settlement.test.ts`'s first test:
`previewSplitTax(200000, 1600) === 32000` (Rs 320) and
`previewSplitTax(300000, 800) === 24000` (Rs 240), summing to 56000 paisa
— Rs 560, matching the brief's own table precisely.

## 3. What was already in the schema, unchanged

`discount_paisa`, `service_charge_paisa`, `delivery_fee_paisa` on `orders`,
and `tendered_paisa`/`change_paisa` on `payments` were all already part of
Part 03's schema — nothing new needed there. This part is the first to
actually *use* them: `settle_order()` writes all three order-level columns,
and computes `change_paisa` per split as
`greatest(tendered_paisa - amount_paisa, 0)`.

## 4. Void was already built in Part 09

`void_order()` — manager authorisation, mandatory reason code, stock
returned to the ledger on a full-order void, blocked once the day is
closed — was copied into `0008_order_engine_functions.sql` back in Part 09,
because 0003_rls.sql's grant statement had been waiting on it since Part 04
and it reads more as an order-lifecycle concern than a payment one. Nothing
new for it here; the settlement screen just gives it a UI (the "Void
order" button on `/pos/settle/[orderId]`).

## 5. Manager approval — how it actually works given Part 07's design

Both the discount check inside `settle_order()` and the role check inside
`void_order()` read the **current session's** role via `current_staff()` —
there's no separate "manager override" parameter either function accepts.
Combined with Part 07's design (a PIN doesn't sit on top of a shared device
session — it directly becomes that staff member's own real session, see
`docs/auth-design.md`), that means "manager approval" on this screen is
implemented as: `components/pos/manager-auth-dialog.tsx` runs the exact
same PIN → magic-link → `verifyOtp()` exchange as the login screen. When a
cashier needs a discount or a void approved, the approving manager enters
*their own* PIN, which genuinely swaps the browser's active session to
them — the resulting `void_order()`/`settle_order()` call is then
correctly attributed to the real manager who approved it, not the cashier.
The manager's session then simply stays active on that device until the
next idle-timeout or staff switch, same as anywhere else in the app —
nothing device-specific was invented for this screen.

## 6. What still needs a live database to verify

Same limitation as every part since Part 03. What's been verified without
one: `previewSplitTax()`'s formula, `settleOrder()`'s exact RPC call shape
(never sending a tax or total, only each split's pre-tax base),
`loadPaymentMethodTaxRates()`'s join logic, and the error path when splits
don't sum to the bill — 9 new tests in `tests/settlement.test.ts`, all
passing. Not yet run against a real Postgres: the actual rounding-per-split
behaviour inside `settle_order()` itself, the closed-day void/settle block,
and the cashier-cannot-void-alone enforcement. Once a project is linked,
these are direct SQL checks:

```sql
-- Split sum must exactly equal the bill, or settle_order() rejects it
select settle_order('<order_id>',
  '[{"method":"cash","base_paisa":200000},{"method":"card","base_paisa":250000}]'::jsonb);
-- if the order's net base is 500000, expect:
-- exception 'PAY: split payments (450000) do not sum to bill (500000)'

-- Cashier alone cannot void
-- (run as a session whose current_staff().role = 'cashier')
select void_order('<order_id>', 'customer_cancel');
-- Expect: exception 'PERM: voids require manager authorisation'
```

---

## 7. Acceptance Criteria — This Part

- [x] Payment is separate from order creation — settlement happens at the end
- [x] Split payment works, each split at its own rate
- [x] Splits must sum exactly to the bill, or `settle_order()` rejects it
- [x] Tax rounds per split, never once on the whole bill
- [x] Discount, service charge, delivery fee all present (schema already
      had them; `settle_order()` now writes them)
- [x] Change due is calculated (`greatest(tendered - amount, 0)`, per split)
- [x] Invoice number assigned at settlement, sequential (`next_invoice_no()`,
      Part 05)
- [x] `void_order()` exists, with manager authorisation — built in Part 09
- [x] Void reason code mandatory
- [x] Void blocked once the day is closed
- [x] Void returns stock to the ledger (`void_return` movement)
- [ ] **Test:** Rs 5,000 bill, 2,000 cash + 3,000 card → tax exactly 560 —
      formula verified in `tests/settlement.test.ts`; the live `settle_order()`
      execution itself needs a real database (Section 6)
- [ ] **Test:** mismatched splits → error — formula/error-path verified
      via mocked RPC; live rejection needs a real database (Section 6)

**Next part:** `11-inventory-and-recipes.md`

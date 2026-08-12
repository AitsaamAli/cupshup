# Cup Shup POS — POS Terminal

**Depends on:** Part 09, Part 10, Part 15
**Code delivered in this part:** `app/pos/page.tsx`, `components/pos/*`,
`lib/customers.ts`, `lib/tables.ts`, `supabase/migrations/0023_dining_tables_seed.sql`

---

## 1. The metric this part is built around

"Raat 9 baje, 6 log line mein" — at 20+ seconds a mid-size order, staff
go back to a paper pad; the whole system becomes theatre. Every design
choice below is in service of a ~20-second order, not screen aesthetics:

- Nothing here calculates a price. `place_order()`/`add_items_to_order()`
  (Part 09) re-derive the real total from `menu_item_prices` server-side
  regardless of what this screen shows — the same rule as every other
  screen in this app, restated here because it's the one rule speed
  pressure most tempts a screen into breaking.
- Every add-to-cart is instant, client-side React state — no network
  round-trip per item. The one place a real request happens mid-build is
  adding items to an *already-sent* table order (`addItemsToOrder()`),
  which is genuinely optimistic: the button shows "Sending…" immediately,
  and a failure leaves the cart intact for retry rather than silently
  losing it.

## 2. Keyboard map, and what each one actually does

| Key | Action |
|---|---|
| `/` | Focus search (built into `SearchInput`, Part 15) |
| `1`–`9` | Add the Nth currently-visible item (search results, or the active category if not searching) |
| `*` then a digit | Set the quantity for the *next* item you pick (`*6` then `3` = 6× item #3) |
| `Enter` | Send the cart to the kitchen (fires even while the search box has focus — see Section 3) |
| `F2` | Send, then jump straight to Settlement — the fast-checkout path for a counter sale paid on the spot |
| `F4` | Void the current order (manager approval if you're not already owner/manager/supervisor) |
| `Esc` | Clear the draft cart |
| `Ctrl+R` | Repeat the last order you sent, as new cart lines |
| `?` | Shortcuts overlay (Part 15's registry) |

Search matches item name (from the first letters, "kar" → Karak Chai)
**and `sku`** — that second part is the entire "barcode scanner support"
requirement. A scanner is just a very fast typist that ends with Enter;
matching on `sku` means no scanner-specific integration code was needed
at all.

## 3. Why shortcuts fire even while the search box has focus

The generic shortcut registry (Part 15) normally suppresses every
shortcut while any input has focus, so a screen with a text field
doesn't accidentally intercept normal typing. On POS, the search box is
focused for most of the order-building process — if `Enter`/`F2`/`F4`/
`Esc` only worked with nothing focused, they'd rarely work at all. Part
15's registry gained an `allowWhileTyping` flag specifically for this
part; POS is the first (and so far only) screen that sets it.

Digit keys (`1`–`9`) and `*` couldn't use the same registry entry,
though — they're not five independent shortcuts, they're one small
stateful machine (is `*` mode active? which digit comes next?). That
logic lives directly in `app/pos/page.tsx`'s own `keydown` listener
instead of going through `useShortcut()`, and is intentionally scoped to
apply only while a cart is actually being built (not on the order-type/
table picker screens, where 1–9 would be ambiguous).

**Known browser caveat, not fixed here:** `Ctrl+R` is reserved by most
browsers for "reload page," and `preventDefault()` cannot reliably
override that in every browser. It's implemented exactly as the brief
specifies; a kiosk/PWA-installed deployment (Part 20) would sidestep
this, a plain browser tab might not.

## 4. Quantity prefix — scoped to a single digit, deliberately

The brief's own example is `*6` = quantity 6. Rather than build an
ambiguous multi-digit parser (where does the quantity number end and
item-selection begin, when both use the same 1–9 keys?), `*` consumes
**exactly the next one digit** as the full quantity, then exits
prefix-mode automatically. This covers every realistic single-order
quantity a cafe needs; anything larger is a two-tap adjustment on the
cart line's own +/− stepper, which was going to exist anyway.

## 5. Table status has no column of its own

`dining_tables` never had a status field, in Part 03 or since — status
is derived live (`lib/tables.ts`'s `deriveTableStatus()`, unit-tested in
`tests/tables.test.ts`) from whether the table has an order that isn't
settled/voided yet:

```
no open order                        -> empty
sent_to_kitchen or ready             -> running (being served)
served (kitchen done, unpaid)        -> bill_requested
```

Picking an occupied table resumes its order — new items go through
`add_items_to_order()`, not a second `place_order()` call, so the whole
table stays one order with one bill.

`dining_tables` also had zero seed rows until this part
(`0023_dining_tables_seed.sql`) — the table grid needed something to
show. A dedicated table-management screen (add/rename/remove tables)
isn't part of this part's brief; more can be added the same way a
future part builds that screen, without any code change here.

## 6. Cart lines are keyed by a random ID, never the menu item

This is explicit in the brief and easy to get wrong: two cart entries
for the same `menu_item_id` with different modifiers (e.g. two Cappuccinos,
one with oat milk) must stay two separate lines. `CartLine.lineId` is a
fresh `crypto.randomUUID()` per add-to-cart call — never derived from
`menu_item_id` — so this is structurally impossible to collapse by
accident.

## 7. Delivery — the fee lives at settlement, not here

`place_order()` has no delivery-fee parameter; `settle_order()`
(Part 10) does, and Part 10's settlement screen already has that input
field. So this part's delivery flow only needs to resolve *who* the
order is for (`lib/customers.ts`'s phone lookup, creating a new customer
record if none matches) and capture the address for the kitchen/rider's
reference (stored as the order's `note`) — the fee itself is entered
once, at the point it's actually being collected.

## 8. What's explicitly out of scope for this part

The brief's Section 5 narrative mentions bill splitting (per-person or
per-item) and table transfer/merge as things dine-in "needs" — but
neither appears in the part's actual acceptance-criteria checklist, and
both are real schema/RPC work, not UI-only additions:

- **Bill split** would need `settle_order()` to accept a *subset* of an
  order's lines rather than always settling the whole order — a
  genuine change to Part 10's function signature.
- **Table transfer/merge** would need a way to reassign or combine
  `orders.table_id` after the fact, with its own audit trail.

Neither was built here. Flagging this now rather than silently
shipping a "Split bill" button that doesn't actually work.

## 9. What still needs a live database (and a real device) to verify

Same limitation as every part since Part 03 for the RPC calls
themselves (`place_order`, `add_items_to_order`, `void_order` all need a
real staff session). Additionally specific to this part: the actual
20-second speed target, and whether `Ctrl+R` behaves acceptably across
real browsers, both need a live device in a real cashier's hands to
measure — not something a build step can confirm.

---

## 10. Acceptance Criteria — This Part

- [ ] Mid-size order in ~20 seconds — needs a live device + a real
      cashier to actually time (Section 9)
- [x] Fully keyboard-operable order entry (Section 2)
- [x] Search matches from the first letter, plus SKU (barcode)
- [x] Modifiers work, enforcing each group's min/max_select
- [x] Table selection + resuming an open tab
- [x] Void: F4 → manager PIN (if needed) → reason code
- [x] Discount: unchanged, already lives at settlement with manager
      approval (Part 10) — this part deliberately doesn't duplicate it
- [x] Delivery: phone lookup, new-customer creation, address captured
- [x] Idempotency key on every `place_order()` call (`usePlaceOrder()`,
      Part 09, reused unchanged)
- [x] Double-tap protection — the Send button disables while `sending`
      is true, and a retry reuses the same idempotency key rather than
      minting a new one
- [x] 86'd items disappear via Realtime (`useMenu()`, Part 08, filtered
      by `ItemGrid`)
- [x] Day closed → POS blocked with a short, direct message ("Day not
      open" — Part 15's copy rule, not the old chatty banner text)
- [x] Optimistic UI with rollback (Section 1)
- [ ] Tablet + desktop — responsive layout (flex, no fixed pixel
      widths beyond touch targets), not device-tested
- [x] No emoji; numbers `tabular-nums` throughout (`Money`, cart qty,
      table labels — all Part 15 components)

**Next part:** `17-kitchen-display.md`

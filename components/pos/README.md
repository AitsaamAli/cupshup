# components/pos

POS-specific components that compose the primitives in `components/ui`.
Fully retrofitted onto the "Pakistani Portal, Dual Density" system (all
of Terminal density) — see `docs/design-system.md` §5.

- `manager-auth-dialog.tsx` — built in Part 10, rebuilt on the shared
  `Modal`/`NumericKeypad`/`KeypadDots`/`Button` components in Part 15.
- `order-type-picker.tsx` — **Part 16.** Dine-in / Takeaway / Delivery,
  the first screen of a new order.
- `table-picker.tsx` — **Part 16.** Live table grid backed by
  `lib/tables.ts`'s `useTables()`; picking an occupied table resumes its
  open order instead of starting a new one.
- `delivery-form.tsx` — **Part 16.** Phone lookup via `lib/customers.ts`,
  inline new-customer creation, address capture. No delivery-fee field —
  that's collected at settlement (Part 10), not here.
- `item-grid.tsx` — **Part 16.** Category rail + search (name or `sku` —
  the `sku` match is what makes a barcode scanner work with zero extra
  integration code) + a grid with 1–9 digit badges on the first nine
  visible items, for `app/pos/page.tsx`'s keyboard shortcuts.
- `modifier-sheet.tsx` — **Part 16.** Renders an item's modifier groups
  as radios (`max_select = 1`) or checkboxes, enforcing each group's
  `min_select` before Confirm is enabled.
- `cart-panel.tsx` — **Part 16.** Draft cart (new, unsent lines) shown
  separately from already-sent lines on a resumed table order; exports
  `CartLine`/`ExistingLine`, both keyed by a random `lineId`, never by
  `menu_item_id`, so two differently-modified lines of the same item
  never collapse into one.
- `void-order-dialog.tsx` — **Part 16.** `ManagerAuthDialog` (skipped if
  the current staff member is already owner/manager/supervisor) then a
  reason-code select, calling `voidOrder()` (Part 09).

See `docs/pos-terminal.md` for the keyboard map and the scoping
decisions (bill split and table transfer/merge are explicitly **not**
built — see that doc §8).

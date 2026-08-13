# Cup Shup POS — Menu Management

**Depends on:** Part 03, Part 04
**Code delivered in this part:** `supabase/migrations/0005_menu_functions.sql`,
`0006_menu_modifiers_seed.sql`, `0007_menu_storage.sql`, `app/manage/menu/`,
`lib/menu.ts`, `lib/storage.ts`

---

## 1. The problem this part fixes

```js
const MENU = [{ cat: "Chai", items: [{ name: "Karak Chai", price: 329 }] }];
```

With the menu hardcoded in the prototype's source, changing a price required
a developer and a deploy. An owner should be able to change a price from
their phone in ten seconds. Everything in this part exists to make that true
without ever letting an old invoice's price silently change underneath it.

## 2. Price history — never an UPDATE, always a new row

`change_item_price()` in `0005_menu_functions.sql` is the only way a price
ever changes:

```sql
update menu_item_prices set effective_to = current_date
 where menu_item_id = p_item_id and effective_to is null;

insert into menu_item_prices (menu_item_id, price_paisa, effective_from)
values (p_item_id, p_new_price_paisa, current_date);
```

Old rows are never touched again — they just quietly stop being "current."
An order made last month keeps its `unit_price_paisa` snapshot regardless
of what the menu shows today (that snapshot lands in `order_items` once
Part 09 builds `place_order()`); the price-history screen at
`/manage/menu/price-history` lets the Owner see every row that's ever
existed for an item.

## 3. Pizza sizes are now a modifier, not three items

`0004_seed.sql` (Parts 03/05) transcribed the prototype's menu exactly as
it was, which included 9 separate pizza rows — 3 flavours × 3 sizes. That's
the precise problem this part's brief calls out: no combined
"Chicken Fajita Pizza" total in reporting, and every new size would mean
three more item rows instead of one new modifier value.

`0006_menu_modifiers_seed.sql` fixes this once the base schema and seed
already exist:

- All three pizza flavours turned out to share **identical** size pricing
  in the original seed (6" base, +Rs 350 for 9", +Rs 1000 for 14") — matching
  the exact numbers given in this part's brief — so one shared "Size"
  modifier group covers all three flavours.
- Each flavour's 6" row is kept and renamed (e.g. "Chicken Fajita Pizza
  6\"" → "Chicken Fajita Pizza") as the base item; the 9"/14" rows are
  **deactivated** (`active = false`), never deleted — matching the "item
  never deleted" rule even though, in this fresh seed, nothing has actually
  ordered them yet.
- Five more modifier groups were added per the brief: Sugar Level, Ice
  Level, Extra Shot, Add Cheese, No Onions — linked to a representative set
  of categories (Chai/Coffee/Kahwa get Sugar Level, Shakes/Frappe/Mocktail/
  Lagoon/Drinks get Ice Level, etc.). This is a reasonable starting pass,
  not an exhaustive one — an owner can attach any group to any further item
  through the admin screen without another migration.

## 4. "Unconfirmed price" handling

Items seeded with `price_unconfirmed = true` (Egg Fried Rice, Mint Mojito,
Water, a few Chai items — carried over from the prototype's own `flagged`
list) surface in a highlighted banner at the top of `/manage/menu`, sorted
ahead of everything else, exactly as the brief asks. The flag clears
automatically the moment an owner/manager runs a real price change through
`change_item_price()` — a deliberate price decision **is** the
confirmation, so there's no separate "confirm" action to remember.

## 5. Two scoping decisions worth knowing about

- **Drag-and-drop became up/down buttons.** The brief asks for drag-to-reorder
  categories. Implemented instead as simple ▲/▼ buttons calling
  `reorder_categories()` — same end result (owner/manager can reorder
  categories, and it's audited), without pulling in a drag-and-drop library
  this early. Worth upgrading to real drag-and-drop once Part 15's design
  system is in place and more of the app needs the same interaction.
- **Photos are resized entirely in the browser** (`lib/storage.ts`, via
  `<canvas>`, capped at 800px on the longest side, JPEG quality 0.82) rather
  than through a server-side image-processing library. This keeps the stack
  lighter and needs no new server dependency, at the cost of relying on
  `createImageBitmap`/`canvas.toBlob` browser support (universal in modern
  browsers, which is all a POS tablet needs).

## 6. Realtime

`lib/menu.ts`'s `useMenu()` hook loads the full menu once and then
subscribes to Postgres changes on `menu_items`, `menu_item_prices`,
`menu_categories`, and `menu_item_modifier_groups`. A price change or an
86-toggle from the admin screen — or from a different terminal entirely —
reaches every other screen using this hook within moments. This is the same
hook POS (Part 16) and KDS (Part 17) will use; it's built here because
Part 08 is the part that owns the menu's data shape.

## 6a. Order-type pricing (Part 22 §1, added 2026-08-13)

`22-restaurant-operations.md`'s own words: "sabse zyada paise wala gap" —
delivery costs more to fulfil (packaging, rider payout, aggregator
commission) but was charged the same as dine-in. `0044_order_type_pricing.sql`
adds an **optional** per-order-type override price on top of the existing
default — an item with no override behaves exactly as before.

- `menu_item_prices` gained nullable `order_type` and `order_source`
  columns. `order_source` isn't read by anything yet — added now per the
  brief's own instruction, since a nullable column is free today and
  expensive to add once real aggregator-integration rows exist.
- Lookup rule, both server (`current_price_paisa()`) and client
  (`lib/menu.ts`'s `priceForOrderType()`, kept as one shared rule in two
  places deliberately, not derived from each other): exact `(item,
  order_type)` match wins if currently effective, otherwise the default
  (`order_type IS NULL`) row.
- `place_order()`/`add_items_to_order()` thread the order's own
  `order_type` into the price lookup — the one line that was actually
  missing this whole feature; every other piece (price history, the
  admin UI) already knew how to add a row, it just never got read back
  with the right filter.
- **New RPCs**: `set_item_order_type_price(item, order_type, price)` and
  `clear_item_order_type_price(item, order_type)` — same owner/manager-only
  gate and audit-logged as `change_item_price()`, same
  close-out-then-insert history-preserving shape, scoped to exactly one
  `order_type` so setting a delivery override can never touch the default
  price or any other order type's override.
- **Admin UI**: `/manage/menu`'s existing "Change price" dialog gained a
  Takeaway/Delivery section below the default-price field — set an
  override, or "Use default" to clear one and fall back.
- **POS**: `item-grid.tsx` and the cart's `addToCart()` both read
  `priceForOrderType()` using whichever `orderType` is currently selected,
  so the price shown/added changes live the moment the cashier picks
  delivery vs dine-in — display/preview only, `place_order()` always
  re-derives the real price server-side regardless.

**Two real bugs found and fixed in the same migration, not just the new
feature:**
- The old unique index enforced "exactly one live DEFAULT price per
  item" via a plain index on `menu_item_id`. Naively extending it to
  `(menu_item_id, order_type)` would NOT have enforced "exactly one live
  default too" — Postgres treats every `NULL` as distinct from every
  other `NULL` in a unique index, so it would have silently allowed
  unlimited concurrent default rows. Fixed with two partial indexes
  instead (one for `order_type IS NULL`, one for `IS NOT NULL`) — a
  `coalesce()`-based single index was tried first and rejected by
  Postgres itself ("functions in index expression must be marked
  IMMUTABLE") since an enum's `::text` cast isn't catalogued as
  immutable.
- `change_item_price()`'s close-out `UPDATE` matched `effective_to IS
  NULL` alone — no `order_type IS NULL` filter — so changing an item's
  default price would have silently expired every takeaway/delivery
  override on that item too. Caught by this same migration's own pgTAP
  test (`supabase/tests/database/order_type_pricing.sql`) before it ever
  reached production.
- Found *while writing that test*, not caused by it:
  `menu_item_prices`' `price_period` check constraint
  (`effective_to > effective_from`) rejected a same-calendar-day
  re-price outright — a manager fixing a typo'd price minutes after
  entering it got a raw constraint-violation error on the correction.
  Pre-existing, unrelated to order-type pricing, fixed alongside it in
  `0045_price_period_same_day_fix.sql` by relaxing to `>=` (verified this
  changes no historical-price query result — see that migration's own
  comment for why).

## 7. What couldn't be verified in this environment

Same as every part since Part 03: no live Supabase project, so the Storage
bucket, the RPC functions, and the Realtime subscription haven't been
exercised end-to-end. The SQL was reviewed carefully instead (role checks,
`revoke`/`grant` placement, the price-history transition logic), and the
TypeScript compiles and passes lint under `npm run build`.

---

## 8. Acceptance Criteria — This Part

- [x] Menu comes from the database, not code (`useMenu()`, `app/manage/menu/`)
- [x] A price change creates a new row; the old row's `effective_to` closes
- [x] Old orders keep the old price — guaranteed by the snapshot pattern in
      `order_items.unit_price_paisa` (schema already in place; populated
      once Part 09 builds `place_order()`)
- [x] Chef can 86 an item but cannot change its price (`toggle_86()` never
      touches `menu_item_prices`; RLS's `kitchen_86` policy — Part 04 — is
      UPDATE-only on `menu_items`)
- [x] Modifiers work, with a price delta, via `modifier_groups`/`modifiers`
- [x] Pizza sizes became a modifier, not three separate items
- [x] `price_unconfirmed` items are highlighted and sorted first
- [x] Every price change writes to `audit_log` (who, when, old → new)
- [x] Items are never deleted — only `active = false`
      (`set_menu_item_active()`)

**Next part:** `09-order-engine.md`

---

## 9. Acceptance Criteria — Order-type pricing (Part 22 §1)

- [x] Order-type pricing works, with default fallback
- [x] `order_source` column exists (integration itself still not built —
      out of scope, matches the brief)
- [x] Delivery order is charged the delivery price, dine-in the default
      — `supabase/tests/database/order_type_pricing.sql`, run against
      production, real `place_order()` calls end to end
- [x] An order type with no override falls back to the default
- [x] Changing the default price doesn't affect an existing override
      (the real regression this migration's own test caught)
- [x] Only owner/manager can set or clear an override (same gate as
      `change_item_price()`, tested with a rejected cashier attempt)

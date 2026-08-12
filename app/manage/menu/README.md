# app/manage/menu

Menu management — **built in Part 08**. Categories (reorderable),
items (add/edit/hide, never deleted), price changes (always a new
`menu_item_prices` row, never an overwrite), the 86 flag (Chef/Kitchen
can toggle it without Manager approval), and photo upload to Supabase
Storage. Everything here calls the RPCs in
`supabase/migrations/0005_menu_functions.sql` — nothing writes to
`menu_items`/`menu_item_prices` directly from the client.

`price-history/` is the owner-only screen showing every price a menu
item has ever had.

See `docs/menu-management.md` for the modifier-group restructuring
(pizza sizes are now one item + a "Size" modifier, not three items) and
other Part 08 decisions.

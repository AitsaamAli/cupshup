-- =====================================================================
-- Cup Shup POS — Part 17: Kitchen Display System — schema
-- Not in the reference file; original to this project. Two additions:
--   1. Station routing — menu_categories needs to say which kitchen
--      station makes each category, so a Tea Maker's screen can stop
--      showing steak tickets.
--   2. ready_at timestamps — needed for the ticket-time report
--      (average time per item/station/hour). Neither orders nor
--      order_items previously recorded WHEN a ticket/item became ready,
--      only that it eventually did (via .status).
-- =====================================================================

create type kitchen_station as enum ('hot_kitchen', 'cold_bar', 'chai_coffee', 'bakery');

alter table menu_categories add column station kitchen_station;

-- Backfill against the outlet's real 21 seeded categories (0006_seed.sql)
-- — every one of them maps cleanly onto exactly one of the brief's four
-- stations, no leftover category needed a judgment call.
update menu_categories set station = 'hot_kitchen'
 where name in ('Appetizers', 'Fries', 'Salad & Soup', 'Sandwiches', 'Burgers',
                'Pasta', 'Wraps', 'Stuffed Chicken', 'Steaks', 'Chinese', 'Pizza');
update menu_categories set station = 'cold_bar'
 where name in ('Shakes', 'Frappe', 'Mocktail', 'Lagoon', 'Drinks', 'Icecream');
update menu_categories set station = 'chai_coffee'
 where name in ('Chai', 'Kahwa', 'Coffee');
update menu_categories set station = 'bakery'
 where name in ('Desserts');

-- Not null from here on — any category created from now on (owner/manager,
-- direct table access per manage_categories RLS, Part 04) must say which
-- station makes it. There's no category-creation UI yet (Part 08 only
-- edits items within existing categories), so this can't break anything
-- that exists today.
alter table menu_categories alter column station set not null;

-- Ticket-level and item-level "became ready" timestamps. Both nullable —
-- null until the relevant advance happens, same convention as
-- orders.settled_at. Kept separate (not just one column) because a
-- multi-station order's items finish at different times; the per-item
-- one is what the "which station is slow" report actually needs, the
-- per-order one is what "average ticket time" needs.
alter table orders      add column ready_at timestamptz;
alter table order_items add column ready_at timestamptz;

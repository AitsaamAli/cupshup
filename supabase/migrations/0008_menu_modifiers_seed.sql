-- =====================================================================
-- Cup Shup POS — Menu Modifiers: restructure pizza sizes, add core groups
-- Part 08.
--
-- 0004_seed.sql (Part 03/05) transcribed the prototype's menu as-is,
-- which included 9 separate pizza rows — 3 flavours x 3 sizes — as 9
-- unrelated menu_items. That's exactly the "size 6/9/14 = three
-- different items" problem Part 08 exists to fix: it breaks reporting
-- (no single "Chicken Fajita Pizza" total) and means every new size adds
-- N new item rows instead of one new modifier.
--
-- This migration turns each pizza flavour into ONE base item + a shared
-- "Size" modifier group, and adds the other core modifier groups the
-- menu needs (Sugar Level, Ice Level, Extra Shot, Add Cheese, No Onions).
-- =====================================================================

-- ---------------------------------------------------------------------
-- MODIFIER GROUPS
-- ---------------------------------------------------------------------
insert into modifier_groups (outlet_id, name, min_select, max_select) values
  ('00000000-0000-0000-0000-000000000001', 'Size',        1, 1),
  ('00000000-0000-0000-0000-000000000001', 'Sugar Level', 0, 1),
  ('00000000-0000-0000-0000-000000000001', 'Ice Level',   0, 1),
  ('00000000-0000-0000-0000-000000000001', 'Extra Shot',  0, 1),
  ('00000000-0000-0000-0000-000000000001', 'Add Cheese',  0, 1),
  ('00000000-0000-0000-0000-000000000001', 'No Onions',   0, 1);

-- ---------------------------------------------------------------------
-- MODIFIERS
-- All three pizza flavours in 0004_seed.sql happen to share the exact
-- same size pricing (6" base, 9" +Rs350, 14" +Rs1000) — confirmed against
-- the seeded prices below — so one shared Size group covers all of them.
-- ---------------------------------------------------------------------
insert into modifiers (group_id, name, price_delta_paisa)
select g.id, m.name, m.delta
from modifier_groups g
join (values ('6"', 0), ('9"', 35000), ('14"', 100000)) as m(name, delta) on true
where g.name = 'Size' and g.outlet_id = '00000000-0000-0000-0000-000000000001';

insert into modifiers (group_id, name, price_delta_paisa)
select g.id, m.name, 0
from modifier_groups g
join (values ('Normal Sugar'), ('Less Sugar'), ('No Sugar')) as m(name) on true
where g.name = 'Sugar Level' and g.outlet_id = '00000000-0000-0000-0000-000000000001';

insert into modifiers (group_id, name, price_delta_paisa)
select g.id, m.name, 0
from modifier_groups g
join (values ('Normal Ice'), ('Less Ice'), ('No Ice')) as m(name) on true
where g.name = 'Ice Level' and g.outlet_id = '00000000-0000-0000-0000-000000000001';

insert into modifiers (group_id, name, price_delta_paisa)
select g.id, 'Add Extra Shot', 10000  -- Rs 100
from modifier_groups g
where g.name = 'Extra Shot' and g.outlet_id = '00000000-0000-0000-0000-000000000001';

insert into modifiers (group_id, name, price_delta_paisa)
select g.id, 'Add Cheese', 5000  -- Rs 50
from modifier_groups g
where g.name = 'Add Cheese' and g.outlet_id = '00000000-0000-0000-0000-000000000001';

insert into modifiers (group_id, name, price_delta_paisa)
select g.id, 'No Onions', 0
from modifier_groups g
where g.name = 'No Onions' and g.outlet_id = '00000000-0000-0000-0000-000000000001';

-- ---------------------------------------------------------------------
-- PIZZA RESTRUCTURING
-- Keep the 6" row as the base item (rename to drop the size suffix —
-- it now represents the whole pizza, with size chosen via modifier).
-- Deactivate the 9"/14" rows rather than delete them — they were seeded
-- moments ago in this same environment and have no real orders against
-- them yet, but "never delete a menu item" is the rule regardless of
-- age, so they're hidden (active = false), not dropped.
-- ---------------------------------------------------------------------
update menu_items set name = 'Chicken Fajita Pizza' where name = 'Chicken Fajita Pizza 6"';
update menu_items set name = 'Super Supreme Pizza'   where name = 'Super Supreme Pizza 6"';
update menu_items set name = 'Malai Boti Pizza'       where name = 'Malai Boti Pizza 6"';

update menu_items set active = false
 where name in (
   'Chicken Fajita Pizza 9"', 'Chicken Fajita Pizza 14"',
   'Super Supreme Pizza 9"',  'Super Supreme Pizza 14"',
   'Malai Boti Pizza 9"',     'Malai Boti Pizza 14"'
 );

insert into menu_item_modifier_groups (menu_item_id, group_id)
select mi.id, g.id
from menu_items mi
join modifier_groups g on g.name = 'Size' and g.outlet_id = '00000000-0000-0000-0000-000000000001'
where mi.name in ('Chicken Fajita Pizza', 'Super Supreme Pizza', 'Malai Boti Pizza');

-- ---------------------------------------------------------------------
-- LINK THE REMAINING GROUPS TO SENSIBLE CATEGORIES
-- (a representative, not exhaustive, pass — an owner can attach any
-- group to any further item later through the Part 08 admin screen)
-- ---------------------------------------------------------------------
insert into menu_item_modifier_groups (menu_item_id, group_id)
select mi.id, g.id
from menu_items mi
join menu_categories c on c.id = mi.category_id
join modifier_groups g on g.name = 'Sugar Level' and g.outlet_id = c.outlet_id
where c.name in ('Chai', 'Coffee', 'Kahwa');

insert into menu_item_modifier_groups (menu_item_id, group_id)
select mi.id, g.id
from menu_items mi
join menu_categories c on c.id = mi.category_id
join modifier_groups g on g.name = 'Ice Level' and g.outlet_id = c.outlet_id
where c.name in ('Shakes', 'Frappe', 'Mocktail', 'Lagoon', 'Drinks');

insert into menu_item_modifier_groups (menu_item_id, group_id)
select mi.id, g.id
from menu_items mi
join menu_categories c on c.id = mi.category_id
join modifier_groups g on g.name = 'Extra Shot' and g.outlet_id = c.outlet_id
where c.name = 'Coffee';

insert into menu_item_modifier_groups (menu_item_id, group_id)
select mi.id, g.id
from menu_items mi
join menu_categories c on c.id = mi.category_id
join modifier_groups g on g.name = 'Add Cheese' and g.outlet_id = c.outlet_id
where c.name in ('Burgers', 'Sandwiches', 'Fries');

insert into menu_item_modifier_groups (menu_item_id, group_id)
select mi.id, g.id
from menu_items mi
join menu_categories c on c.id = mi.category_id
join modifier_groups g on g.name = 'No Onions' and g.outlet_id = c.outlet_id
where c.name in ('Burgers', 'Sandwiches', 'Wraps');

-- =====================================================================
-- Cup Shup POS — Second-wave audit: RLS-layer sibling fixes
-- =====================================================================
-- 0036 fixed the RPC functions. But several of the same tables ALSO have
-- an "all"/"select" RLS policy that only checks the caller's ROLE and
-- never the row's outlet — which means fixing the RPC is not enough:
-- a direct PostgREST call (`supabase.from('menu_items').update(...)`,
-- no RPC involved at all) sails straight through RLS on role alone.
-- This is the same vulnerability class surfacing at a different layer,
-- exactly the "don't trust RLS alone, don't trust the RPC alone" case
-- the second-wave audit was told to assume. Fixed here:
--
--   - menu_items (manage_items, kitchen_86) — write, any outlet
--   - menu_item_prices (manage_prices) — write, any outlet
--   - menu_item_prices (read_prices) — READ leak, every outlet's price
--     history visible to every logged-in staff member anywhere
--   - recipe_lines (manage_recipes) — write, any outlet
--   - recipe_lines (read_recipes) — READ leak, every outlet's recipes
--     (a direct COGS/trade-secret input) visible to everyone
--   - cash_movements (cash_moves) — write, any outlet's shift
--   - modifiers (read_mods) — READ leak, every outlet's modifiers/prices
--   - menu_item_modifier_groups (read_item_mods) — READ leak, same shape
--
-- Postgres has no `create or replace policy` — each is dropped and
-- recreated. Same join pattern already used by this file's own
-- `read_items` policy (menu_items -> menu_categories.outlet_id), so nothing
-- new is introduced, just applied consistently everywhere a foreign id
-- crosses an outlet boundary.
-- =====================================================================

drop policy manage_items on menu_items;
create policy manage_items on menu_items for all
  using (has_role('owner','manager') and exists (
    select 1 from menu_categories c where c.id = category_id and c.outlet_id = my_outlet()
  ))
  with check (has_role('owner','manager') and exists (
    select 1 from menu_categories c where c.id = category_id and c.outlet_id = my_outlet()
  ));

drop policy kitchen_86 on menu_items;
create policy kitchen_86 on menu_items for update
  using (has_role('chef','kitchen','supervisor') and exists (
    select 1 from menu_categories c where c.id = category_id and c.outlet_id = my_outlet()
  ))
  with check (has_role('chef','kitchen','supervisor') and exists (
    select 1 from menu_categories c where c.id = category_id and c.outlet_id = my_outlet()
  ));

drop policy manage_prices on menu_item_prices;
create policy manage_prices on menu_item_prices for all
  using (has_role('owner','manager') and exists (
    select 1 from menu_items mi join menu_categories mc on mc.id = mi.category_id
     where mi.id = menu_item_id and mc.outlet_id = my_outlet()
  ))
  with check (has_role('owner','manager') and exists (
    select 1 from menu_items mi join menu_categories mc on mc.id = mi.category_id
     where mi.id = menu_item_id and mc.outlet_id = my_outlet()
  ));

drop policy read_prices on menu_item_prices;
create policy read_prices on menu_item_prices for select
  using (exists (
    select 1 from menu_items mi join menu_categories mc on mc.id = mi.category_id
     where mi.id = menu_item_id and mc.outlet_id = my_outlet()
  ));

drop policy manage_recipes on recipe_lines;
create policy manage_recipes on recipe_lines for all
  using (has_role('owner','manager','chef')
    and exists (select 1 from menu_items mi join menu_categories mc on mc.id = mi.category_id
                 where mi.id = menu_item_id and mc.outlet_id = my_outlet())
    and exists (select 1 from ingredients i where i.id = ingredient_id and i.outlet_id = my_outlet()))
  with check (has_role('owner','manager','chef')
    and exists (select 1 from menu_items mi join menu_categories mc on mc.id = mi.category_id
                 where mi.id = menu_item_id and mc.outlet_id = my_outlet())
    and exists (select 1 from ingredients i where i.id = ingredient_id and i.outlet_id = my_outlet()));

drop policy read_recipes on recipe_lines;
create policy read_recipes on recipe_lines for select
  using (exists (
    select 1 from menu_items mi join menu_categories mc on mc.id = mi.category_id
     where mi.id = menu_item_id and mc.outlet_id = my_outlet()
  ));

drop policy cash_moves on cash_movements;
create policy cash_moves on cash_movements for all
  using (has_role('owner','manager','supervisor') and exists (
    select 1 from shifts s join business_days d on d.id = s.business_day_id
     where s.id = shift_id and d.outlet_id = my_outlet()
  ))
  with check (has_role('owner','manager','supervisor') and exists (
    select 1 from shifts s join business_days d on d.id = s.business_day_id
     where s.id = shift_id and d.outlet_id = my_outlet()
  ));

drop policy read_mods on modifiers;
create policy read_mods on modifiers for select
  using (exists (select 1 from modifier_groups g where g.id = group_id and g.outlet_id = my_outlet()));

drop policy read_item_mods on menu_item_modifier_groups;
create policy read_item_mods on menu_item_modifier_groups for select
  using (exists (select 1 from modifier_groups g where g.id = group_id and g.outlet_id = my_outlet()));

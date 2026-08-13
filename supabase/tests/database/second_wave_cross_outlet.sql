-- =====================================================================
-- Cup Shup POS — pgTAP: second-wave cross-outlet sibling-bug regression
--
-- 0035/cross_outlet_isolation.sql covered Finding A's own attack surface
-- (order/KDS/printing/business-day). The user's second-wave directive
-- demanded every OTHER function taking a foreign resource id be
-- independently attacked the same way, not assumed safe by association.
-- This file is that attack, for every sibling gap actually found and
-- fixed in 0036/0037/0038: business-day/shift close+cash-movement,
-- menu edit/price/86/activate, recipe lines, and purchase/stock-count
-- inventory writes — PLUS three direct-table attacks (bypassing the RPC
-- entirely) proving the 0037 RLS-policy fix holds even when a call never
-- goes through a SECURITY DEFINER function at all.
--
-- Same technique as cross_outlet_isolation.sql: one throwaway outlet B
-- with its own real owner identity, identity-switched via set_config
-- within one rolled-back transaction. Everything created here — outlet
-- B, both owners, a throwaway category/item/ingredient/supplier/
-- purchase/business-day/shift for outlet A — is thrown away by the
-- final rollback.
-- =====================================================================

begin;
select plan(16);

do $$
declare
  v_outlet_a uuid; v_outlet_b uuid;
  v_owner_a_user uuid := gen_random_uuid();
  v_owner_b_user uuid := gen_random_uuid();
  v_owner_a_staff uuid;
  v_category uuid; v_item uuid; v_ingredient uuid; v_supplier uuid;
  v_foreign_table uuid; v_foreign_customer uuid;
  v_day business_days; v_shift shifts; v_purchase purchases;
  v_tz text; v_hour int; v_today date;
begin
  select id, timezone, day_start_hour into v_outlet_a, v_tz, v_hour from outlets limit 1;
  v_today := business_date_of(now(), v_tz, v_hour);

  insert into auth.users (id) values (v_owner_a_user);
  insert into staff (user_id, outlet_id, code, name, role)
  values (v_owner_a_user, v_outlet_a, 'PGTAP-SW-A', 'pgTAP SecondWave Outlet A Owner', 'owner')
  returning id into v_owner_a_staff;

  insert into outlets (name, timezone, day_start_hour) values ('PGTAP-SW-OTHER', 'Asia/Karachi', 15)
  returning id into v_outlet_b;
  insert into auth.users (id) values (v_owner_b_user);
  insert into staff (user_id, outlet_id, code, name, role)
  values (v_owner_b_user, v_outlet_b, 'PGTAP-SW-B', 'pgTAP SecondWave Outlet B Owner', 'owner');

  -- Throwaway menu category + item + ingredient + supplier, all owned by
  -- outlet A — self-contained rather than depending on seed content.
  insert into menu_categories (outlet_id, name) values (v_outlet_a, 'PGTAP-SW-Category')
  returning id into v_category;
  insert into menu_items (category_id, name) values (v_category, 'PGTAP-SW-Item')
  returning id into v_item;
  insert into ingredients (outlet_id, name, unit) values (v_outlet_a, 'PGTAP-SW-Ingredient', 'kg')
  returning id into v_ingredient;
  insert into suppliers (outlet_id, name) values (v_outlet_a, 'PGTAP-SW-Supplier')
  returning id into v_supplier;

  insert into business_days (outlet_id, business_date, status, opened_by)
  values (v_outlet_a, v_today, 'open', v_owner_a_staff)
  on conflict (outlet_id, business_date) do update set status = 'open'
  returning * into v_day;

  insert into shifts (business_day_id, cashier_id, opening_float_paisa)
  values (v_day.id, v_owner_a_staff, 0)
  returning * into v_shift;

  insert into purchases (outlet_id, supplier_id, business_day_id, received_by)
  values (v_outlet_a, v_supplier, v_day.id, v_owner_a_staff)
  returning * into v_purchase;
  insert into purchase_lines (purchase_id, ingredient_id, qty, unit_cost_paisa, line_total_paisa)
  values (v_purchase.id, v_ingredient, 1, 10000, 10000);

  -- A throwaway dining table + customer owned by OUTLET B — used below to
  -- prove place_order() rejects a foreign table_id/customer_id even when
  -- p_outlet itself is the caller's own, legitimate outlet (0040).
  insert into dining_tables (outlet_id, label, seats) values (v_outlet_b, 'PGTAP-SW-Table', 2)
  returning id into v_foreign_table;
  insert into customers (outlet_id, phone, name) values (v_outlet_b, '03000000000', 'PGTAP-SW-Customer')
  returning id into v_foreign_customer;
  perform set_config('pgtap.foreign_table', v_foreign_table::text, true);
  perform set_config('pgtap.foreign_customer', v_foreign_customer::text, true);

  perform set_config('pgtap.outlet_a', v_outlet_a::text, true);
  perform set_config('pgtap.outlet_b', v_outlet_b::text, true);
  perform set_config('pgtap.owner_a_user', v_owner_a_user::text, true);
  perform set_config('pgtap.owner_b_user', v_owner_b_user::text, true);
  perform set_config('pgtap.category', v_category::text, true);
  perform set_config('pgtap.item', v_item::text, true);
  perform set_config('pgtap.ingredient', v_ingredient::text, true);
  perform set_config('pgtap.day', v_day.id::text, true);
  perform set_config('pgtap.shift', v_shift.id::text, true);
  perform set_config('pgtap.purchase', v_purchase.id::text, true);
end $$;

-- Still acting as OUTLET A's OWN owner here — a fully legitimate caller
-- for p_outlet, attacking only the table_id/customer_id parameters
-- (finding S1, docs/security-audit-2026-08-14-third-wave.md).
select set_config('request.jwt.claim.sub', current_setting('pgtap.owner_a_user'), true);
set local role authenticated;

do $$
declare v_code text := 'none';
begin
  begin
    perform place_order(
      current_setting('pgtap.outlet_a')::uuid, 'dine_in',
      jsonb_build_array(jsonb_build_object('menu_item_id', current_setting('pgtap.item'), 'qty', 1)),
      'pgtap-sw-table-attack-' || clock_timestamp()::text,
      current_setting('pgtap.foreign_table')::uuid
    );
  exception when others then
    get stacked diagnostics v_code = message_text;
  end;
  perform set_config('pgtap.a12', v_code, true);
end $$;
select ok(current_setting('pgtap.a12') = 'TABLE: not found',
  'place_order with own outlet but a FOREIGN table_id is rejected (0040)');

do $$
declare v_code text := 'none';
begin
  begin
    perform place_order(
      current_setting('pgtap.outlet_a')::uuid, 'dine_in',
      jsonb_build_array(jsonb_build_object('menu_item_id', current_setting('pgtap.item'), 'qty', 1)),
      'pgtap-sw-customer-attack-' || clock_timestamp()::text,
      null, current_setting('pgtap.foreign_customer')::uuid
    );
  exception when others then
    get stacked diagnostics v_code = message_text;
  end;
  perform set_config('pgtap.a13', v_code, true);
end $$;
select ok(current_setting('pgtap.a13') = 'CUSTOMER: not found',
  'place_order with own outlet but a FOREIGN customer_id is rejected (0040)');

-- Switch identity to OUTLET B's owner — everything below is an attack
-- against outlet A's rows.
select set_config('request.jwt.claim.sub', current_setting('pgtap.owner_b_user'), true);
set local role authenticated;

-- ---------------------------------------------------------------------
-- Business day / shift (0036)
-- ---------------------------------------------------------------------
do $$
declare v_code text := 'none';
begin
  begin perform close_business_day(current_setting('pgtap.day')::uuid, 0);
  exception when others then get stacked diagnostics v_code = message_text; end;
  perform set_config('pgtap.a1', v_code, true);
end $$;
select ok(current_setting('pgtap.a1') like 'DAY:%', 'close_business_day against outlet A''s day is rejected');

do $$
declare v_code text := 'none';
begin
  begin perform close_shift(current_setting('pgtap.shift')::uuid, 0);
  exception when others then get stacked diagnostics v_code = message_text; end;
  perform set_config('pgtap.a2', v_code, true);
end $$;
select ok(current_setting('pgtap.a2') like 'SHIFT:%', 'close_shift against outlet A''s shift is rejected');

do $$
declare v_code text := 'none';
begin
  begin perform record_cash_movement(current_setting('pgtap.shift')::uuid, 'paid_in', 100, 'attack');
  exception when others then get stacked diagnostics v_code = message_text; end;
  perform set_config('pgtap.a3', v_code, true);
end $$;
select ok(current_setting('pgtap.a3') like 'SHIFT:%', 'record_cash_movement against outlet A''s shift is rejected');

-- ---------------------------------------------------------------------
-- Menu (0036 RPCs)
-- ---------------------------------------------------------------------
do $$
declare v_code text := 'none';
begin
  begin perform upsert_menu_item(current_setting('pgtap.item')::uuid, current_setting('pgtap.category')::uuid, 'Hijacked');
  exception when others then get stacked diagnostics v_code = message_text; end;
  perform set_config('pgtap.a4', v_code, true);
end $$;
select ok(current_setting('pgtap.a4') like 'ITEM:%' or current_setting('pgtap.a4') like 'CATEGORY:%',
  'upsert_menu_item against outlet A''s item/category is rejected');

do $$
declare v_code text := 'none';
begin
  begin perform change_item_price(current_setting('pgtap.item')::uuid, 999999);
  exception when others then get stacked diagnostics v_code = message_text; end;
  perform set_config('pgtap.a5', v_code, true);
end $$;
select ok(current_setting('pgtap.a5') like 'ITEM:%', 'change_item_price against outlet A''s item is rejected');

do $$
declare v_code text := 'none';
begin
  begin perform toggle_86(current_setting('pgtap.item')::uuid, true);
  exception when others then get stacked diagnostics v_code = message_text; end;
  perform set_config('pgtap.a6', v_code, true);
end $$;
select ok(current_setting('pgtap.a6') like 'ITEM:%', 'toggle_86 against outlet A''s item is rejected');

do $$
declare v_code text := 'none';
begin
  begin perform set_menu_item_active(current_setting('pgtap.item')::uuid, false);
  exception when others then get stacked diagnostics v_code = message_text; end;
  perform set_config('pgtap.a7', v_code, true);
end $$;
select ok(current_setting('pgtap.a7') like 'ITEM:%', 'set_menu_item_active against outlet A''s item is rejected');

-- ---------------------------------------------------------------------
-- Recipes (0036)
-- ---------------------------------------------------------------------
do $$
declare v_code text := 'none';
begin
  begin perform upsert_recipe_line(current_setting('pgtap.item')::uuid, current_setting('pgtap.ingredient')::uuid, 1);
  exception when others then get stacked diagnostics v_code = message_text; end;
  perform set_config('pgtap.a8', v_code, true);
end $$;
select ok(current_setting('pgtap.a8') like 'ITEM:%' or current_setting('pgtap.a8') like 'INGREDIENT:%',
  'upsert_recipe_line against outlet A''s item/ingredient is rejected');

-- ---------------------------------------------------------------------
-- Inventory (0036) — the two most severe: these previously wrote real
-- stock movements + moving-average cost changes into outlet A's ledger.
-- ---------------------------------------------------------------------
do $$
declare v_code text := 'none';
begin
  begin perform record_purchase(current_setting('pgtap.ingredient')::uuid, 10, 500);
  exception when others then get stacked diagnostics v_code = message_text; end;
  perform set_config('pgtap.a9', v_code, true);
end $$;
select ok(current_setting('pgtap.a9') like 'INGREDIENT:%', 'record_purchase against outlet A''s ingredient is rejected');

do $$
declare v_code text := 'none';
begin
  begin perform record_stock_count(current_setting('pgtap.ingredient')::uuid, 999);
  exception when others then get stacked diagnostics v_code = message_text; end;
  perform set_config('pgtap.a10', v_code, true);
end $$;
select ok(current_setting('pgtap.a10') like 'INGREDIENT:%', 'record_stock_count against outlet A''s ingredient is rejected');

do $$
declare v_code text := 'none';
begin
  begin perform record_purchase_return(current_setting('pgtap.purchase')::uuid, current_setting('pgtap.ingredient')::uuid, 1, 'attack');
  exception when others then get stacked diagnostics v_code = message_text; end;
  perform set_config('pgtap.a11', v_code, true);
end $$;
select ok(current_setting('pgtap.a11') like 'PURCHASE:%', 'record_purchase_return against outlet A''s purchase is rejected');

-- ---------------------------------------------------------------------
-- Direct-table RLS attacks (0037) — bypassing the RPC entirely, exactly
-- as a raw supabase.from(table).update(...) client call would. These
-- prove the fix isn't just "the RPC checks now" but "the underlying
-- table can't be written cross-outlet even without any RPC involved."
-- Outlet B's owner genuinely holds 'owner' role, so has_role() alone
-- would have passed before 0037 — only the outlet-ownership join added
-- in 0037 can be what blocks these.
-- ---------------------------------------------------------------------
update menu_items set name = 'RLS-bypass-attempt' where id = current_setting('pgtap.item')::uuid;
select ok(
  (select name from menu_items where id = current_setting('pgtap.item')::uuid) <> 'RLS-bypass-attempt',
  'direct UPDATE on menu_items against outlet A''s item matches zero rows under RLS'
);

insert into cash_movements (shift_id, type, amount_paisa, reason, performed_by)
select current_setting('pgtap.shift')::uuid, 'paid_in', 100, 'RLS-bypass-attempt', id
from staff where user_id::text = current_setting('pgtap.owner_b_user')
on conflict do nothing;
select ok(
  not exists (select 1 from cash_movements where shift_id = current_setting('pgtap.shift')::uuid and reason = 'RLS-bypass-attempt'),
  'direct INSERT on cash_movements against outlet A''s shift is rejected by RLS'
);

insert into recipe_lines (menu_item_id, ingredient_id, qty)
values (current_setting('pgtap.item')::uuid, current_setting('pgtap.ingredient')::uuid, 5)
on conflict (menu_item_id, ingredient_id) do nothing;
select ok(
  not exists (select 1 from recipe_lines where menu_item_id = current_setting('pgtap.item')::uuid),
  'direct INSERT on recipe_lines against outlet A''s item/ingredient is rejected by RLS'
);

select * from finish();
rollback;

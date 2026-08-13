-- =====================================================================
-- Cup Shup POS — Second-wave adversarial audit, 2026-08-13/14
-- =====================================================================
-- 0035 fixed the missing-outlet-ownership-check pattern in the 13
-- order/KDS/printing/business-day functions Finding A actually attacked.
-- The user explicitly rejected treating that as the full picture and
-- demanded every function accepting a foreign resource id be
-- independently re-checked for the SAME class of gap, not just the ones
-- already proven exploitable. This migration is that sweep's result —
-- every function below was read function-by-function against "does this
-- verify the target resource belongs to the caller's own outlet, or does
-- it just check the caller's ROLE and trust the id?" Fourteen more did
-- not. Full writeup: docs/security-audit-2026-08-14-second-wave.md.
--
-- Same fix shape as 0035 throughout: fetch the target row (or its
-- outlet-owning ancestor via a join, when the table has no outlet_id of
-- its own), then compare its outlet_id against the caller's before doing
-- anything else. The error message is always the generic "not found" —
-- never a distinct "wrong outlet" message — so a cross-outlet probe
-- can't use the error text itself to confirm a row exists elsewhere.
-- =====================================================================

-- ---------------------------------------------------------------------
-- close_business_day — 0019/Part 13. Fetched the target business day by
-- id alone and never checked it belonged to the caller's outlet. Any
-- manager/supervisor+ from ANY outlet could close, snapshot, and lock a
-- completely different outlet's business day.
-- ---------------------------------------------------------------------
create or replace function close_business_day(
  p_business_day_id uuid,
  p_counted_cash_paisa bigint
) returns json language plpgsql security definer set search_path = public as $$
declare
  v_staff staff; v_day business_days; v_shift shifts;
  v_orders int; v_revenue bigint; v_tax bigint; v_collected bigint;
  v_cogs bigint; v_gross bigint; v_cash_sales bigint;
  v_cash_expenses bigint; v_all_expenses bigint;
  v_drops bigint; v_paid_in bigint; v_float bigint;
  v_expected bigint; v_snap jsonb;
begin
  select * into v_staff from current_staff();
  if v_staff is null or v_staff.role not in ('owner','manager','supervisor') then
    raise exception 'PERM: only manager or above can close the day';
  end if;

  select * into v_day from business_days where id = p_business_day_id for update;
  if v_day is null or v_day.outlet_id <> v_staff.outlet_id then
    raise exception 'DAY: not found';
  end if;
  if v_day.status <> 'open' then raise exception 'DAY: already closed'; end if;

  select count(*), coalesce(sum(subtotal_paisa - discount_paisa + service_charge_paisa + delivery_fee_paisa),0),
         coalesce(sum(tax_paisa),0), coalesce(sum(total_paisa),0), coalesce(sum(cogs_paisa),0)
    into v_orders, v_revenue, v_tax, v_collected, v_cogs
  from orders where business_day_id = p_business_day_id and status = 'settled';

  v_gross := v_revenue - v_cogs;

  select coalesce(sum(p.amount_paisa),0) into v_cash_sales
  from payments p join orders o on o.id = p.order_id
  where o.business_day_id = p_business_day_id and o.status = 'settled' and p.method = 'cash';

  select coalesce(sum(amount_paisa) filter (where payment_method = 'cash'),0),
         coalesce(sum(amount_paisa),0)
    into v_cash_expenses, v_all_expenses
  from expenses where business_day_id = p_business_day_id;

  select coalesce(sum(opening_float_paisa),0) into v_float
  from shifts where business_day_id = p_business_day_id;

  select coalesce(sum(amount_paisa) filter (where type in ('drop','pickup','paid_out')),0),
         coalesce(sum(amount_paisa) filter (where type = 'paid_in'),0)
    into v_drops, v_paid_in
  from cash_movements cm join shifts s on s.id = cm.shift_id
  where s.business_day_id = p_business_day_id;

  v_expected := v_float + v_cash_sales + v_paid_in - v_cash_expenses - v_drops;

  v_snap := jsonb_build_object(
    'orders', v_orders, 'revenue_paisa', v_revenue, 'tax_paisa', v_tax,
    'collected_paisa', v_collected, 'cogs_paisa', v_cogs, 'gross_profit_paisa', v_gross,
    'expenses_paisa', v_all_expenses, 'net_profit_paisa', v_gross - v_all_expenses,
    'cash_sales_paisa', v_cash_sales, 'opening_float_paisa', v_float,
    'cash_drops_paisa', v_drops, 'expected_cash_paisa', v_expected,
    'counted_cash_paisa', p_counted_cash_paisa,
    'variance_paisa', p_counted_cash_paisa - v_expected
  );

  update business_days set status = 'closed', closed_by = v_staff.id,
         closed_at = now(), closing_snapshot = v_snap
   where id = p_business_day_id returning * into v_day;

  update shifts set closed_at = coalesce(closed_at, now()),
         expected_cash_paisa = v_expected,
         counted_cash_paisa = coalesce(counted_cash_paisa, p_counted_cash_paisa),
         variance_paisa = p_counted_cash_paisa - v_expected
   where business_day_id = p_business_day_id and closed_at is null;

  insert into audit_log (outlet_id, actor_id, action, entity_type, entity_id, after)
  values (v_day.outlet_id, v_staff.id, 'close_day', 'business_days', v_day.id, v_snap);

  return v_snap;
end $$;
revoke all on function close_business_day(uuid, bigint) from public;
grant execute on function close_business_day(uuid, bigint) to authenticated;

-- ---------------------------------------------------------------------
-- close_shift — 0019/Part 13. `shifts` has no outlet_id column of its
-- own (only business_day_id); the function fetched the shift by id and
-- only ever compared `cashier_id <> v_staff.id`. Any manager/supervisor+
-- — from ANY outlet, since the role check alone let them past the
-- cashier-mismatch branch — could close and reconcile a different
-- outlet's shift, reading and overwriting its real cash variance.
-- ---------------------------------------------------------------------
create or replace function close_shift(p_shift_id uuid, p_counted_cash_paisa bigint)
returns json language plpgsql security definer set search_path = public as $$
declare
  v_staff staff; v_shift shifts;
  v_cash_sales bigint; v_cash_expenses bigint;
  v_drops bigint; v_paid_in bigint; v_expected bigint;
begin
  select * into v_staff from current_staff();
  if v_staff is null then raise exception 'AUTH: not a staff member'; end if;

  select * into v_shift from shifts where id = p_shift_id for update;
  if v_shift is null or not exists (
    select 1 from business_days d where d.id = v_shift.business_day_id and d.outlet_id = v_staff.outlet_id
  ) then
    raise exception 'SHIFT: not found';
  end if;
  if v_shift.closed_at is not null then raise exception 'SHIFT: already closed'; end if;
  if v_shift.cashier_id <> v_staff.id and v_staff.role not in ('owner','manager','supervisor') then
    raise exception 'PERM: only this shift''s cashier or a manager can close it';
  end if;

  select coalesce(sum(p.amount_paisa),0) into v_cash_sales
  from payments p join orders o on o.id = p.order_id
  where o.shift_id = p_shift_id and o.status = 'settled' and p.method = 'cash';

  select coalesce(sum(amount_paisa),0) into v_cash_expenses
  from expenses where shift_id = p_shift_id and payment_method = 'cash';

  select coalesce(sum(amount_paisa) filter (where type in ('drop','pickup','paid_out')),0),
         coalesce(sum(amount_paisa) filter (where type = 'paid_in'),0)
    into v_drops, v_paid_in
  from cash_movements where shift_id = p_shift_id;

  v_expected := v_shift.opening_float_paisa + v_cash_sales + v_paid_in - v_cash_expenses - v_drops;

  update shifts set closed_at = now(), counted_cash_paisa = p_counted_cash_paisa,
         expected_cash_paisa = v_expected, variance_paisa = p_counted_cash_paisa - v_expected
   where id = p_shift_id returning * into v_shift;

  insert into audit_log (outlet_id, actor_id, action, entity_type, entity_id, after)
  values (v_staff.outlet_id, v_staff.id, 'close_shift', 'shifts', p_shift_id, to_jsonb(v_shift));

  return to_jsonb(v_shift);
end $$;
revoke all on function close_shift(uuid, bigint) from public;
grant execute on function close_shift(uuid, bigint) to authenticated;

-- ---------------------------------------------------------------------
-- record_cash_movement — 0019/Part 13. Identical gap to close_shift:
-- fetched the shift by id only, so any manager/supervisor+ from another
-- outlet could post a fabricated drop/pickup/paid-in/paid-out against a
-- different outlet's shift and corrupt its cash reconciliation.
-- ---------------------------------------------------------------------
create or replace function record_cash_movement(
  p_shift_id uuid,
  p_type cash_movement_type,
  p_amount_paisa bigint,
  p_reason text default null
) returns json language plpgsql security definer set search_path = public as $$
declare v_staff staff; v_shift shifts; v_movement cash_movements;
begin
  select * into v_staff from current_staff();
  if v_staff is null then raise exception 'AUTH: not a staff member'; end if;

  select * into v_shift from shifts where id = p_shift_id;
  if v_shift is null or not exists (
    select 1 from business_days d where d.id = v_shift.business_day_id and d.outlet_id = v_staff.outlet_id
  ) then
    raise exception 'SHIFT: not found';
  end if;
  if v_shift.closed_at is not null then raise exception 'SHIFT: already closed'; end if;
  if v_shift.cashier_id <> v_staff.id and v_staff.role not in ('owner','manager','supervisor') then
    raise exception 'PERM: only this shift''s cashier or a manager can record cash movements on it';
  end if;
  if p_amount_paisa <= 0 then raise exception 'CASH: amount must be > 0'; end if;

  insert into cash_movements (shift_id, type, amount_paisa, reason, performed_by)
  values (p_shift_id, p_type, p_amount_paisa, p_reason, v_staff.id)
  returning * into v_movement;

  insert into audit_log (outlet_id, actor_id, action, entity_type, entity_id, after)
  values (v_staff.outlet_id, v_staff.id, 'cash_movement', 'cash_movements', v_movement.id,
          to_jsonb(v_movement));

  return to_jsonb(v_movement);
end $$;
revoke all on function record_cash_movement(uuid, cash_movement_type, bigint, text) from public;
grant execute on function record_cash_movement(uuid, cash_movement_type, bigint, text) to authenticated;

-- ---------------------------------------------------------------------
-- open_shift — p_terminal_id was never checked against the caller's
-- outlet. Lower severity (the shift itself is still created correctly
-- scoped to the caller's own outlet/business day — this can't be used to
-- write into another outlet), but it let a shift silently link to
-- another outlet's terminal/printer config, which is a real data
-- integrity gap given "does this operation enforce ownership of the
-- target resource" applies to every foreign id, not just the exploitable
-- ones.
-- ---------------------------------------------------------------------
create or replace function open_shift(p_terminal_id uuid, p_opening_float_paisa bigint)
returns json language plpgsql security definer set search_path = public as $$
declare v_staff staff; v_day business_days; v_shift shifts;
begin
  select * into v_staff from current_staff();
  if v_staff is null then raise exception 'AUTH: not a staff member'; end if;

  select * into v_day from business_days
   where outlet_id = v_staff.outlet_id and status = 'open'
   order by opened_at desc limit 1;
  if v_day is null then
    raise exception 'DAY: no open business day — ask a manager to open it first';
  end if;

  if p_terminal_id is not null and not exists (
    select 1 from terminals where id = p_terminal_id and outlet_id = v_staff.outlet_id
  ) then
    raise exception 'TERMINAL: not found';
  end if;

  if exists (select 1 from shifts where cashier_id = v_staff.id and closed_at is null) then
    raise exception 'SHIFT: you already have an open shift';
  end if;

  insert into shifts (business_day_id, cashier_id, terminal_id, opening_float_paisa)
  values (v_day.id, v_staff.id, p_terminal_id, p_opening_float_paisa)
  returning * into v_shift;

  insert into audit_log (outlet_id, actor_id, action, entity_type, entity_id, after)
  values (v_staff.outlet_id, v_staff.id, 'open_shift', 'shifts', v_shift.id, to_jsonb(v_shift));

  return to_jsonb(v_shift);
end $$;
revoke all on function open_shift(uuid, bigint) from public;
grant execute on function open_shift(uuid, bigint) to authenticated;

-- =====================================================================
-- MENU — menu_items has no outlet_id of its own (scoped only through
-- category_id -> menu_categories.outlet_id), and every one of these four
-- functions updated it by id alone with nothing but a role check. Any
-- owner/manager (upsert_menu_item/change_item_price/set_menu_item_active)
-- or any owner/manager/supervisor/chef/kitchen (toggle_86) from ANY
-- outlet could edit, reprice, hide, or 86 a different outlet's menu.
-- =====================================================================

create or replace function upsert_menu_item(
  p_id uuid,
  p_category_id uuid,
  p_name text,
  p_sku text default null,
  p_sort_order int default 0,
  p_image_url text default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_actor staff;
  v_id uuid;
  v_before jsonb;
  v_after jsonb;
  v_category_outlet uuid;
  v_item_outlet uuid;
begin
  select * into v_actor from current_staff();
  if v_actor is null or v_actor.role not in ('owner','manager') then
    raise exception 'PERM: only owner or manager can edit the menu';
  end if;

  select outlet_id into v_category_outlet from menu_categories where id = p_category_id;
  if v_category_outlet is null or v_category_outlet <> v_actor.outlet_id then
    raise exception 'CATEGORY: not found';
  end if;

  if p_id is null then
    insert into menu_items (category_id, name, sku, sort_order, image_url)
    values (p_category_id, p_name, p_sku, p_sort_order, p_image_url)
    returning id into v_id;

    select to_jsonb(mi) into v_after from menu_items mi where mi.id = v_id;
    insert into audit_log (outlet_id, actor_id, action, entity_type, entity_id, after)
    values (v_actor.outlet_id, v_actor.id, 'menu_item_created', 'menu_items', v_id, v_after);
  else
    select mc.outlet_id into v_item_outlet
      from menu_items mi join menu_categories mc on mc.id = mi.category_id
     where mi.id = p_id;
    if v_item_outlet is null or v_item_outlet <> v_actor.outlet_id then
      raise exception 'ITEM: not found';
    end if;

    select to_jsonb(mi) into v_before from menu_items mi where mi.id = p_id;

    update menu_items set
      category_id = p_category_id,
      name        = p_name,
      sku         = p_sku,
      sort_order  = p_sort_order,
      image_url   = coalesce(p_image_url, image_url)
    where id = p_id
    returning id into v_id;

    select to_jsonb(mi) into v_after from menu_items mi where mi.id = v_id;
    insert into audit_log (outlet_id, actor_id, action, entity_type, entity_id, before, after)
    values (v_actor.outlet_id, v_actor.id, 'menu_item_updated', 'menu_items', v_id, v_before, v_after);
  end if;

  return v_id;
end $$;
revoke all on function upsert_menu_item(uuid, uuid, text, text, int, text) from public;
grant execute on function upsert_menu_item(uuid, uuid, text, text, int, text) to authenticated;

create or replace function change_item_price(p_item_id uuid, p_new_price_paisa bigint)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_actor staff;
  v_old_price bigint;
begin
  select * into v_actor from current_staff();
  if v_actor is null or v_actor.role not in ('owner','manager') then
    raise exception 'PERM: only owner or manager can change prices';
  end if;

  if p_new_price_paisa < 0 then
    raise exception 'PRICE: cannot be negative';
  end if;

  if not exists (
    select 1 from menu_items mi join menu_categories mc on mc.id = mi.category_id
     where mi.id = p_item_id and mc.outlet_id = v_actor.outlet_id
  ) then
    raise exception 'ITEM: not found';
  end if;

  select price_paisa into v_old_price from menu_item_prices
   where menu_item_id = p_item_id and effective_to is null;

  if v_old_price is not null and v_old_price = p_new_price_paisa then
    update menu_items set price_unconfirmed = false where id = p_item_id;
    return;
  end if;

  update menu_item_prices set effective_to = current_date
   where menu_item_id = p_item_id and effective_to is null;

  insert into menu_item_prices (menu_item_id, price_paisa, effective_from)
  values (p_item_id, p_new_price_paisa, current_date);

  update menu_items set price_unconfirmed = false where id = p_item_id;

  insert into audit_log (outlet_id, actor_id, action, entity_type, entity_id, before, after)
  values (v_actor.outlet_id, v_actor.id, 'price_changed', 'menu_items', p_item_id,
          jsonb_build_object('price_paisa', v_old_price),
          jsonb_build_object('price_paisa', p_new_price_paisa));
end $$;
revoke all on function change_item_price(uuid, bigint) from public;
grant execute on function change_item_price(uuid, bigint) to authenticated;

create or replace function toggle_86(p_item_id uuid, p_is_86 boolean)
returns void language plpgsql security definer set search_path = public as $$
declare v_actor staff;
begin
  select * into v_actor from current_staff();
  if v_actor is null or v_actor.role not in
     ('owner','manager','supervisor','chef','kitchen') then
    raise exception 'PERM: not authorised to 86 an item';
  end if;

  if not exists (
    select 1 from menu_items mi join menu_categories mc on mc.id = mi.category_id
     where mi.id = p_item_id and mc.outlet_id = v_actor.outlet_id
  ) then
    raise exception 'ITEM: not found';
  end if;

  update menu_items set is_86 = p_is_86 where id = p_item_id;

  insert into audit_log (outlet_id, actor_id, action, entity_type, entity_id, after)
  values (v_actor.outlet_id, v_actor.id, case when p_is_86 then '86_on' else '86_off' end,
          'menu_items', p_item_id, jsonb_build_object('is_86', p_is_86));
end $$;
revoke all on function toggle_86(uuid, boolean) from public;
grant execute on function toggle_86(uuid, boolean) to authenticated;

create or replace function set_menu_item_active(p_item_id uuid, p_active boolean)
returns void language plpgsql security definer set search_path = public as $$
declare v_actor staff;
begin
  select * into v_actor from current_staff();
  if v_actor is null or v_actor.role not in ('owner','manager') then
    raise exception 'PERM: only owner or manager can hide a menu item';
  end if;

  if not exists (
    select 1 from menu_items mi join menu_categories mc on mc.id = mi.category_id
     where mi.id = p_item_id and mc.outlet_id = v_actor.outlet_id
  ) then
    raise exception 'ITEM: not found';
  end if;

  update menu_items set active = p_active where id = p_item_id;

  insert into audit_log (outlet_id, actor_id, action, entity_type, entity_id, after)
  values (v_actor.outlet_id, v_actor.id,
          case when p_active then 'menu_item_activated' else 'menu_item_deactivated' end,
          'menu_items', p_item_id, jsonb_build_object('active', p_active));
end $$;
revoke all on function set_menu_item_active(uuid, boolean) from public;
grant execute on function set_menu_item_active(uuid, boolean) to authenticated;

-- =====================================================================
-- RECIPES — upsert_recipe_line/remove_recipe_line took a menu_item_id
-- and an ingredient_id and checked neither's outlet. A chef/manager from
-- outlet B could rewrite outlet A's recipe (a direct COGS input) by id,
-- or splice an outlet-B ingredient into an outlet-A item's recipe.
-- =====================================================================

create or replace function upsert_recipe_line(
  p_menu_item_id uuid,
  p_ingredient_id uuid,
  p_qty numeric
) returns void language plpgsql security definer set search_path = public as $$
declare v_actor staff; v_before numeric;
begin
  select * into v_actor from current_staff();
  if v_actor is null or v_actor.role not in ('owner','manager','chef') then
    raise exception 'PERM: only owner, manager, or chef can edit recipes';
  end if;
  if p_qty <= 0 then raise exception 'RECIPE: qty must be > 0'; end if;

  if not exists (
    select 1 from menu_items mi join menu_categories mc on mc.id = mi.category_id
     where mi.id = p_menu_item_id and mc.outlet_id = v_actor.outlet_id
  ) then
    raise exception 'ITEM: not found';
  end if;
  if not exists (select 1 from ingredients where id = p_ingredient_id and outlet_id = v_actor.outlet_id) then
    raise exception 'INGREDIENT: not found';
  end if;

  select qty into v_before from recipe_lines
   where menu_item_id = p_menu_item_id and ingredient_id = p_ingredient_id;

  insert into recipe_lines (menu_item_id, ingredient_id, qty)
  values (p_menu_item_id, p_ingredient_id, p_qty)
  on conflict (menu_item_id, ingredient_id) do update set qty = p_qty;

  insert into audit_log (outlet_id, actor_id, action, entity_type, entity_id, before, after)
  values (v_actor.outlet_id, v_actor.id, 'recipe_line_set', 'recipe_lines', p_menu_item_id,
          jsonb_build_object('ingredient_id', p_ingredient_id, 'qty', v_before),
          jsonb_build_object('ingredient_id', p_ingredient_id, 'qty', p_qty));
end $$;
revoke all on function upsert_recipe_line(uuid, uuid, numeric) from public;
grant execute on function upsert_recipe_line(uuid, uuid, numeric) to authenticated;

create or replace function remove_recipe_line(p_menu_item_id uuid, p_ingredient_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_actor staff;
begin
  select * into v_actor from current_staff();
  if v_actor is null or v_actor.role not in ('owner','manager','chef') then
    raise exception 'PERM: only owner, manager, or chef can edit recipes';
  end if;

  if not exists (
    select 1 from menu_items mi join menu_categories mc on mc.id = mi.category_id
     where mi.id = p_menu_item_id and mc.outlet_id = v_actor.outlet_id
  ) then
    raise exception 'ITEM: not found';
  end if;
  if not exists (select 1 from ingredients where id = p_ingredient_id and outlet_id = v_actor.outlet_id) then
    raise exception 'INGREDIENT: not found';
  end if;

  delete from recipe_lines where menu_item_id = p_menu_item_id and ingredient_id = p_ingredient_id;
  if not found then raise exception 'RECIPE: line not found'; end if;

  insert into audit_log (outlet_id, actor_id, action, entity_type, entity_id, after)
  values (v_actor.outlet_id, v_actor.id, 'recipe_line_removed', 'recipe_lines', p_menu_item_id,
          jsonb_build_object('ingredient_id', p_ingredient_id));
end $$;
revoke all on function remove_recipe_line(uuid, uuid) from public;
grant execute on function remove_recipe_line(uuid, uuid) to authenticated;

-- =====================================================================
-- INVENTORY — record_purchase/record_stock_count fetched the ingredient
-- by id with NO outlet filter, then wrote the stock_movement/cost-update
-- using THAT ingredient's real outlet_id (not the caller's) — meaning an
-- owner/manager from outlet B, given (or guessing) an outlet-A
-- ingredient id, could successfully record a purchase or a stock count
-- directly against outlet A's real inventory ledger and moving-average
-- cost. This is the same class as Finding A: a write RPC that trusted
-- role alone and derived the id's own outlet instead of checking it
-- against the caller's outlet — CRITICAL, since inventory cost feeds
-- every COGS/margin figure in the app.
-- =====================================================================

create or replace function record_purchase(
  p_ingredient_id uuid,
  p_qty numeric,
  p_unit_cost_paisa bigint,
  p_supplier_id uuid default null,
  p_note text default null
) returns json language plpgsql security definer set search_path = public as $$
declare
  v_actor staff;
  v_ingredient ingredients;
  v_current_stock numeric;
  v_new_avg_cost bigint;
begin
  select * into v_actor from current_staff();
  if v_actor is null or v_actor.role not in ('owner','manager') then
    raise exception 'PERM: only owner or manager can record a purchase';
  end if;
  if p_qty <= 0 then raise exception 'PURCHASE: qty must be > 0'; end if;
  if p_unit_cost_paisa < 0 then raise exception 'PURCHASE: unit cost cannot be negative'; end if;

  select * into v_ingredient from ingredients where id = p_ingredient_id and outlet_id = v_actor.outlet_id;
  if v_ingredient is null then raise exception 'INGREDIENT: not found'; end if;

  select coalesce(sum(qty), 0) into v_current_stock
  from stock_movements where ingredient_id = p_ingredient_id;

  if v_current_stock > 0 then
    v_new_avg_cost := round(
      (v_current_stock * v_ingredient.moving_avg_cost_paisa + p_qty * p_unit_cost_paisa)
      / (v_current_stock + p_qty)
    );
  else
    v_new_avg_cost := p_unit_cost_paisa;
  end if;

  insert into stock_movements (outlet_id, ingredient_id, movement_type, qty,
                               unit_cost_paisa, reference_type, reference_id,
                               reason, performed_by)
  values (v_ingredient.outlet_id, p_ingredient_id, 'purchase', p_qty,
          p_unit_cost_paisa, 'suppliers', p_supplier_id, p_note, v_actor.id);

  update ingredients set moving_avg_cost_paisa = v_new_avg_cost where id = p_ingredient_id;

  insert into audit_log (outlet_id, actor_id, action, entity_type, entity_id, after)
  values (v_ingredient.outlet_id, v_actor.id, 'purchase_recorded', 'ingredients', p_ingredient_id,
          jsonb_build_object('qty', p_qty, 'unit_cost_paisa', p_unit_cost_paisa,
                             'new_avg_cost_paisa', v_new_avg_cost));

  return json_build_object(
    'new_stock', v_current_stock + p_qty,
    'new_avg_cost_paisa', v_new_avg_cost
  );
end $$;
revoke all on function record_purchase(uuid, numeric, bigint, uuid, text) from public;
grant execute on function record_purchase(uuid, numeric, bigint, uuid, text) to authenticated;

create or replace function record_stock_count(
  p_ingredient_id uuid,
  p_counted_qty numeric,
  p_note text default null
) returns json language plpgsql security definer set search_path = public as $$
declare
  v_actor staff;
  v_ingredient ingredients;
  v_theoretical numeric;
  v_delta numeric;
begin
  select * into v_actor from current_staff();
  if v_actor is null or v_actor.role not in ('owner','manager') then
    raise exception 'PERM: only owner or manager can record a stock count';
  end if;
  if p_counted_qty < 0 then raise exception 'COUNT: cannot be negative'; end if;

  select * into v_ingredient from ingredients where id = p_ingredient_id and outlet_id = v_actor.outlet_id;
  if v_ingredient is null then raise exception 'INGREDIENT: not found'; end if;

  select coalesce(sum(qty), 0) into v_theoretical
  from stock_movements where ingredient_id = p_ingredient_id;

  v_delta := p_counted_qty - v_theoretical;

  if v_delta <> 0 then
    insert into stock_movements (outlet_id, ingredient_id, movement_type, qty,
                                 reference_type, reason, performed_by)
    values (v_ingredient.outlet_id, p_ingredient_id, 'count_adjustment', v_delta,
            'stock_count', coalesce(p_note, 'physical count'), v_actor.id);
  end if;

  insert into audit_log (outlet_id, actor_id, action, entity_type, entity_id, after)
  values (v_ingredient.outlet_id, v_actor.id, 'stock_count', 'ingredients', p_ingredient_id,
          jsonb_build_object('theoretical', v_theoretical, 'counted', p_counted_qty, 'variance', v_delta));

  return json_build_object('theoretical', v_theoretical, 'counted', p_counted_qty, 'variance', v_delta);
end $$;
revoke all on function record_stock_count(uuid, numeric, text) from public;
grant execute on function record_stock_count(uuid, numeric, text) to authenticated;

-- ---------------------------------------------------------------------
-- record_purchase_return — the purchase itself WAS correctly checked
-- against the caller's outlet, but the ingredient id was fetched with no
-- outlet filter at all, and never checked against the purchase's own
-- outlet either. Left uncaught, a purchase return could write a
-- stock_movement scoped to outlet A's purchase but referencing outlet
-- B's ingredient row, corrupting both outlets' stock ledgers and
-- COGS/variance reporting.
-- ---------------------------------------------------------------------
create or replace function record_purchase_return(
  p_purchase_id uuid,
  p_ingredient_id uuid,
  p_qty numeric,
  p_reason text default null
) returns json language plpgsql security definer set search_path = public as $$
declare
  v_actor staff;
  v_purchase purchases;
  v_ingredient ingredients;
begin
  select * into v_actor from current_staff();
  if v_actor is null or v_actor.role not in ('owner','manager') then
    raise exception 'PERM: only owner or manager can record a purchase return';
  end if;
  if p_qty <= 0 then raise exception 'RETURN: qty must be > 0'; end if;

  select * into v_purchase from purchases where id = p_purchase_id and outlet_id = v_actor.outlet_id;
  if v_purchase is null then raise exception 'PURCHASE: not found'; end if;

  select * into v_ingredient from ingredients where id = p_ingredient_id and outlet_id = v_purchase.outlet_id;
  if v_ingredient is null then raise exception 'INGREDIENT: not found'; end if;

  insert into purchase_returns (purchase_id, ingredient_id, qty, unit_cost_paisa, reason, performed_by)
  values (p_purchase_id, p_ingredient_id, p_qty, v_ingredient.moving_avg_cost_paisa, p_reason, v_actor.id);

  insert into stock_movements (outlet_id, ingredient_id, movement_type, qty,
                               unit_cost_paisa, reference_type, reference_id, reason, performed_by)
  values (v_purchase.outlet_id, p_ingredient_id, 'transfer', -p_qty,
          v_ingredient.moving_avg_cost_paisa, 'purchase_returns', p_purchase_id, p_reason, v_actor.id);

  insert into audit_log (outlet_id, actor_id, action, entity_type, entity_id, after)
  values (v_purchase.outlet_id, v_actor.id, 'purchase_return', 'purchases', p_purchase_id,
          jsonb_build_object('ingredient_id', p_ingredient_id, 'qty', p_qty, 'reason', p_reason));

  return json_build_object('purchase_id', p_purchase_id, 'ingredient_id', p_ingredient_id, 'qty', p_qty);
end $$;
revoke all on function record_purchase_return(uuid, uuid, numeric, text) from public;
grant execute on function record_purchase_return(uuid, uuid, numeric, text) to authenticated;

-- ---------------------------------------------------------------------
-- next_invoice_no — SECURITY DEFINER with no revoke/grant statement at
-- all in 0004_tax_functions.sql, meaning Postgres's PUBLIC-execute
-- default left it callable directly by anon AND authenticated, with zero
-- identity or role check inside it. It's meant to be called only from
-- inside settle_order() (already outlet-checked) — called directly, it
-- let anyone burn/advance ANY outlet's "gapless" invoice sequence, which
-- is a PRA compliance integrity issue (the whole point of this function,
-- per its own header, is that the sequence has no gaps). Revoking public
-- execute does not break settle_order()'s internal call: a SECURITY
-- DEFINER function executes with ITS OWNER's privileges, not the
-- calling session's, so settle_order -> next_invoice_no still works
-- regardless of what's granted to authenticated/anon.
-- ---------------------------------------------------------------------
revoke all on function next_invoice_no(uuid, date) from public, anon, authenticated;

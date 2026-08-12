-- =====================================================================
-- Cup Shup POS — Order Engine
-- Part 09. The single most important rule in this file: the browser
-- never sends a price. It sends "these menu_item_ids, these quantities,
-- these modifiers" — every price and cost is looked up here, inside the
-- transaction, from menu_item_prices / recipe_lines. A client sending
-- { total: 1 } changes nothing.
--
-- current_price_paisa(), recipe_cost_paisa(), next_order_no(), and
-- place_order() are copied verbatim from the project's full reference
-- 0002_functions.sql (the same file Parts 05/06/07 already pulled
-- current_staff()/has_role()/my_outlet()/tax_rate_bp()/business_date_of()
-- from). void_order() is included here too — Part 09's own "order
-- lifecycle" section explicitly names voided as a status branch, and
-- 0003_rls.sql's grant statement has been waiting on it since Part 04.
--
-- advance_order_status() and add_items_to_order() are NOT in the
-- reference file — Part 09's own brief asks for both by name, but they
-- don't exist anywhere else, so they're original to this migration.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Current unit price + current recipe cost of a menu item. Not security
-- definer — RLS's read_prices/read_recipes policies (Part 04) already
-- let any authenticated staff member read these, so no bypass is needed.
-- ---------------------------------------------------------------------
create or replace function current_price_paisa(p_item uuid, p_on date default current_date)
returns bigint language sql stable as $$
  select price_paisa from menu_item_prices
  where menu_item_id = p_item
    and effective_from <= p_on
    and (effective_to is null or effective_to > p_on)
  order by effective_from desc limit 1;
$$;

create or replace function recipe_cost_paisa(p_item uuid)
returns bigint language sql stable as $$
  select coalesce(sum(round(rl.qty * i.moving_avg_cost_paisa)), 0)::bigint
  from recipe_lines rl join ingredients i on i.id = rl.ingredient_id
  where rl.menu_item_id = p_item;
$$;

-- ---------------------------------------------------------------------
-- Per-outlet sequential order number. Replaces the prototype's
-- "order:" + Date.now(), which let two terminals collide on the same
-- millisecond and silently overwrite each other's order.
-- ---------------------------------------------------------------------
create or replace function next_order_no(p_outlet uuid)
returns bigint language plpgsql security definer set search_path = public as $$
declare n bigint;
begin
  insert into order_counters (outlet_id, last_no) values (p_outlet, 1)
  on conflict (outlet_id) do update set last_no = order_counters.last_no + 1
  returning last_no into n;
  return n;
end $$;

-- ---------------------------------------------------------------------
-- PLACE ORDER
--   Client sends: [{ menu_item_id, qty, modifiers, note }]
--   Server decides every price. Idempotency key prevents double-tap
--   duplicates and lets a client safely retry after a network error —
--   the same key always returns the SAME order, never a second one.
-- ---------------------------------------------------------------------
create or replace function place_order(
  p_outlet uuid,
  p_order_type order_type,
  p_items jsonb,
  p_idempotency_key text,
  p_table_id uuid default null,
  p_customer_id uuid default null,
  p_note text default null
) returns json language plpgsql security definer set search_path = public as $$
declare
  v_staff staff; v_day business_days; v_shift shifts; v_order orders;
  v_item jsonb; v_price bigint; v_cost bigint; v_qty numeric; v_name text;
  v_mod_delta bigint; v_subtotal bigint := 0; v_cogs bigint := 0;
  v_tz text; v_hour int; v_date date; v_existing orders;
begin
  select * into v_staff from current_staff();
  if v_staff is null then raise exception 'AUTH: not a staff member'; end if;

  -- Idempotency: same key -> return the original order, do not create a second one
  select * into v_existing from orders
   where outlet_id = p_outlet and idempotency_key = p_idempotency_key;
  if v_existing is not null then
    return json_build_object('order', to_jsonb(v_existing), 'duplicate', true);
  end if;

  select timezone, day_start_hour into v_tz, v_hour from outlets where id = p_outlet;
  v_date := business_date_of(now(), v_tz, v_hour);

  select * into v_day from business_days
   where outlet_id = p_outlet and business_date = v_date;
  if v_day is null then raise exception 'DAY: business day % is not open', v_date; end if;
  if v_day.status <> 'open' then raise exception 'DAY: % is closed — orders are blocked', v_date; end if;

  select * into v_shift from shifts
   where business_day_id = v_day.id and closed_at is null
   order by opened_at desc limit 1;

  insert into orders (outlet_id, business_day_id, shift_id, table_id, customer_id,
                      order_no, order_type, status, idempotency_key, note, created_by)
  values (p_outlet, v_day.id, v_shift.id, p_table_id, p_customer_id,
          next_order_no(p_outlet), p_order_type, 'sent_to_kitchen',
          p_idempotency_key, p_note, v_staff.id)
  returning * into v_order;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_qty := (v_item->>'qty')::numeric;
    if v_qty is null or v_qty <= 0 then raise exception 'ITEM: qty must be > 0'; end if;

    select name into v_name from menu_items
     where id = (v_item->>'menu_item_id')::uuid and active and not is_86;
    if v_name is null then raise exception 'ITEM: menu item unavailable'; end if;

    v_price := current_price_paisa((v_item->>'menu_item_id')::uuid, v_date);
    if v_price is null then raise exception 'ITEM: no active price for %', v_name; end if;

    v_cost := recipe_cost_paisa((v_item->>'menu_item_id')::uuid);

    select coalesce(sum((m->>'price_delta_paisa')::bigint), 0) into v_mod_delta
      from jsonb_array_elements(coalesce(v_item->'modifiers', '[]'::jsonb)) m;

    insert into order_items (order_id, menu_item_id, name_snapshot, qty,
                             unit_price_paisa, unit_cost_paisa, modifiers,
                             line_total_paisa, note)
    values (v_order.id, (v_item->>'menu_item_id')::uuid, v_name, v_qty,
            v_price + v_mod_delta, v_cost,
            coalesce(v_item->'modifiers','[]'::jsonb),
            round((v_price + v_mod_delta) * v_qty), v_item->>'note');

    v_subtotal := v_subtotal + round((v_price + v_mod_delta) * v_qty);
    v_cogs     := v_cogs + round(v_cost * v_qty);
  end loop;

  if v_subtotal <= 0 then raise exception 'ORDER: empty or zero-value order'; end if;

  update orders set subtotal_paisa = v_subtotal, cogs_paisa = v_cogs
   where id = v_order.id returning * into v_order;

  insert into audit_log (outlet_id, actor_id, action, entity_type, entity_id, after)
  values (p_outlet, v_staff.id, 'place_order', 'orders', v_order.id, to_jsonb(v_order));

  return json_build_object('order', to_jsonb(v_order), 'duplicate', false);
end $$;
revoke all on function place_order(uuid, order_type, jsonb, text, uuid, uuid, text) from public;
grant execute on function place_order(uuid, order_type, jsonb, text, uuid, uuid, text) to authenticated;

-- ---------------------------------------------------------------------
-- VOID  (never delete — write a reversal, manager authorisation required)
-- ---------------------------------------------------------------------
create or replace function void_order(
  p_order_id uuid,
  p_reason_code text,
  p_reason_note text default null,
  p_order_item_id uuid default null
) returns json language plpgsql security definer set search_path = public as $$
declare v_staff staff; v_order orders; v_day business_days; v_rl record;
begin
  select * into v_staff from current_staff();
  if v_staff is null or v_staff.role not in ('owner','manager','supervisor') then
    raise exception 'PERM: voids require manager authorisation';
  end if;

  select * into v_order from orders where id = p_order_id for update;
  if v_order is null then raise exception 'ORDER: not found'; end if;

  select * into v_day from business_days where id = v_order.business_day_id;
  if v_day.status <> 'open' then
    raise exception 'DAY: closed — issue a next-day credit note instead';
  end if;

  insert into order_voids (order_id, order_item_id, reason_code, reason_note, authorised_by)
  values (p_order_id, p_order_item_id, p_reason_code, p_reason_note, v_staff.id);

  if p_order_item_id is null then
    update orders set status = 'voided' where id = p_order_id returning * into v_order;
    update order_items set status = 'voided' where order_id = p_order_id;

    -- return depleted stock if the order had already been settled
    for v_rl in
      select ingredient_id, -sum(qty) as give_back from stock_movements
      where reference_type = 'orders' and reference_id = p_order_id
        and movement_type = 'sale_depletion'
      group by ingredient_id
    loop
      insert into stock_movements (outlet_id, ingredient_id, movement_type, qty,
                                   reference_type, reference_id, reason, performed_by)
      values (v_order.outlet_id, v_rl.ingredient_id, 'void_return', v_rl.give_back,
              'orders', p_order_id, 'order voided', v_staff.id);
    end loop;
  else
    update order_items set status = 'voided' where id = p_order_item_id;
  end if;

  insert into audit_log (outlet_id, actor_id, action, entity_type, entity_id, after)
  values (v_order.outlet_id, v_staff.id, 'void_order', 'orders', p_order_id,
          jsonb_build_object('reason', p_reason_code, 'note', p_reason_note,
                             'item', p_order_item_id));

  return to_jsonb(v_order);
end $$;
revoke all on function void_order(uuid, text, text, uuid) from public;
grant execute on function void_order(uuid, text, text, uuid) to authenticated;

-- ---------------------------------------------------------------------
-- ADVANCE ORDER STATUS — original to this migration, not in the
-- reference file. orders has NO update policy at all (Part 04) and its
-- direct writes are revoked (0003_rls.sql), so sent_to_kitchen -> ready
-- -> served has to move through some RPC — this is it. Deliberately
-- does NOT accept 'settled' or 'voided': those only ever happen through
-- settle_order() (Part 10) and void_order() above, which carry their
-- own payment/reversal logic. Any other transition is rejected.
-- ---------------------------------------------------------------------
create or replace function advance_order_status(p_order_id uuid, p_new_status order_status)
returns json language plpgsql security definer set search_path = public as $$
declare
  v_staff staff;
  v_order orders;
  v_allowed boolean;
begin
  select * into v_staff from current_staff();
  if v_staff is null then raise exception 'AUTH: not a staff member'; end if;

  select * into v_order from orders where id = p_order_id for update;
  if v_order is null then raise exception 'ORDER: not found'; end if;

  v_allowed := case v_order.status
    when 'sent_to_kitchen' then p_new_status = 'ready'
    when 'ready'           then p_new_status = 'served'
    else false
  end;
  if not v_allowed then
    raise exception 'ORDER: cannot move from % to %', v_order.status, p_new_status;
  end if;

  update orders set status = p_new_status where id = p_order_id returning * into v_order;

  insert into audit_log (outlet_id, actor_id, action, entity_type, entity_id, after)
  values (v_order.outlet_id, v_staff.id, 'order_status_advanced', 'orders', p_order_id,
          jsonb_build_object('status', p_new_status));

  return to_jsonb(v_order);
end $$;
revoke all on function advance_order_status(uuid, order_status) from public;
grant execute on function advance_order_status(uuid, order_status) to authenticated;

-- ---------------------------------------------------------------------
-- ADD ITEMS TO AN EXISTING ORDER — original to this migration. Dine-in
-- customers routinely order more after the first round (dessert, another
-- round of chai) before ever paying. Reuses place_order()'s exact
-- server-side pricing logic; blocked once the order is settled or
-- voided. If the order had already reached 'served', adding items pulls
-- it back to 'sent_to_kitchen' — the new items genuinely need kitchen
-- attention again; this is a deliberate, order-specific re-open, not a
-- bypass of advance_order_status()'s forward-only rule above.
-- ---------------------------------------------------------------------
create or replace function add_items_to_order(p_order_id uuid, p_items jsonb)
returns json language plpgsql security definer set search_path = public as $$
declare
  v_staff staff; v_order orders; v_day business_days;
  v_item jsonb; v_price bigint; v_cost bigint; v_qty numeric; v_name text;
  v_mod_delta bigint; v_added_subtotal bigint := 0; v_added_cogs bigint := 0;
begin
  select * into v_staff from current_staff();
  if v_staff is null then raise exception 'AUTH: not a staff member'; end if;

  select * into v_order from orders where id = p_order_id for update;
  if v_order is null then raise exception 'ORDER: not found'; end if;
  if v_order.status = 'settled' then
    raise exception 'ORDER: already settled — start a new order instead';
  end if;
  if v_order.status = 'voided' then raise exception 'ORDER: voided'; end if;

  select * into v_day from business_days where id = v_order.business_day_id;
  if v_day.status <> 'open' then raise exception 'DAY: closed — cannot add items'; end if;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_qty := (v_item->>'qty')::numeric;
    if v_qty is null or v_qty <= 0 then raise exception 'ITEM: qty must be > 0'; end if;

    select name into v_name from menu_items
     where id = (v_item->>'menu_item_id')::uuid and active and not is_86;
    if v_name is null then raise exception 'ITEM: menu item unavailable'; end if;

    v_price := current_price_paisa((v_item->>'menu_item_id')::uuid, v_day.business_date);
    if v_price is null then raise exception 'ITEM: no active price for %', v_name; end if;

    v_cost := recipe_cost_paisa((v_item->>'menu_item_id')::uuid);

    select coalesce(sum((m->>'price_delta_paisa')::bigint), 0) into v_mod_delta
      from jsonb_array_elements(coalesce(v_item->'modifiers', '[]'::jsonb)) m;

    insert into order_items (order_id, menu_item_id, name_snapshot, qty,
                             unit_price_paisa, unit_cost_paisa, modifiers,
                             line_total_paisa, note)
    values (p_order_id, (v_item->>'menu_item_id')::uuid, v_name, v_qty,
            v_price + v_mod_delta, v_cost,
            coalesce(v_item->'modifiers','[]'::jsonb),
            round((v_price + v_mod_delta) * v_qty), v_item->>'note');

    v_added_subtotal := v_added_subtotal + round((v_price + v_mod_delta) * v_qty);
    v_added_cogs     := v_added_cogs + round(v_cost * v_qty);
  end loop;

  if v_added_subtotal <= 0 then raise exception 'ORDER: no items added'; end if;

  update orders set
    subtotal_paisa = subtotal_paisa + v_added_subtotal,
    cogs_paisa      = cogs_paisa + v_added_cogs,
    status          = case when status = 'served' then 'sent_to_kitchen' else status end
  where id = p_order_id
  returning * into v_order;

  insert into audit_log (outlet_id, actor_id, action, entity_type, entity_id, after)
  values (v_order.outlet_id, v_staff.id, 'items_added', 'orders', p_order_id,
          jsonb_build_object('added_subtotal_paisa', v_added_subtotal));

  return json_build_object('order', to_jsonb(v_order));
end $$;
revoke all on function add_items_to_order(uuid, jsonb) from public;
grant execute on function add_items_to_order(uuid, jsonb) to authenticated;

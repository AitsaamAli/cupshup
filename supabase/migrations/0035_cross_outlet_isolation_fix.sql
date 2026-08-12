-- =====================================================================
-- Cup Shup POS — CRITICAL, found by an actual live cross-outlet attack
-- during this session's audit, not a theoretical review finding.
--
-- Reproduced live: created a second, completely unrelated outlet with
-- its own owner-role staff member, minted that staff member a REAL
-- session, and called place_order(p_outlet = <the real outlet's id>).
-- It succeeded — a genuine order was written into the real outlet's
-- data by a staff member who has never had any relationship to that
-- outlet at all. RLS's SELECT-side outlet scoping (`outlet_id =
-- my_outlet()`, Part 04) is real and was independently confirmed still
-- correct in the same test run (that staff member saw zero rows from
-- the real outlet via ordinary queries) — the gap is specifically that
-- every SECURITY DEFINER RPC in the order/KDS/printing/business-day
-- write path only ever checked WHO the caller is (current_staff(), a
-- role check) and never WHICH OUTLET the thing they're operating on
-- actually belongs to. A SECURITY DEFINER function runs with the
-- function owner's privileges precisely so it can bypass RLS for its
-- own legitimate purpose — which means it is ALSO the one place RLS's
-- protection doesn't apply for free, and has to be re-asserted by hand.
--
-- Two call shapes were affected, fixed the same way in both:
--   1. Functions taking p_outlet directly (place_order,
--      open_business_day) — check it against current_staff().outlet_id
--      before doing anything else.
--   2. Functions taking an id (p_order_id, p_order_item_id, p_queue_id)
--      that reference a row already carrying its own outlet_id —
--      check the ROW's outlet_id against current_staff().outlet_id
--      right after fetching it, before any mutation.
--
-- Contrast: expense functions (0020_expenses_functions.sql) and shift
-- functions (0019_business_day_functions.sql) already did this
-- correctly from the start (`where id = p_expense_id and outlet_id =
-- v_staff.outlet_id`) — this migration brings every order/KDS/printing/
-- day-opening function up to that same standard, nothing more.
--
-- Every exception below uses the SAME message and SQLSTATE shape as
-- this project's other AUTH/PERM failures, deliberately generic
-- ("not found" rather than "belongs to a different outlet") — an
-- attacker probing with a guessed/leaked id from another outlet should
-- learn nothing more than they would from a genuinely bad id.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) place_order — direct p_outlet parameter.
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
  if v_staff.outlet_id <> p_outlet then raise exception 'AUTH: not a staff member'; end if;

  select * into v_existing from orders
   where outlet_id = p_outlet and idempotency_key = p_idempotency_key;
  if v_existing.id is not null then
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

  begin
    insert into orders (outlet_id, business_day_id, shift_id, table_id, customer_id,
                        order_no, order_type, status, idempotency_key, note, created_by)
    values (p_outlet, v_day.id, v_shift.id, p_table_id, p_customer_id,
            next_order_no(p_outlet), p_order_type, 'sent_to_kitchen',
            p_idempotency_key, p_note, v_staff.id)
    returning * into v_order;
  exception when unique_violation then
    select * into v_existing from orders
     where outlet_id = p_outlet and idempotency_key = p_idempotency_key;
    return json_build_object('order', to_jsonb(v_existing), 'duplicate', true);
  end;

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
-- 2) open_business_day — direct p_outlet parameter.
-- ---------------------------------------------------------------------
create or replace function open_business_day(
  p_outlet uuid,
  p_opening_float_paisa bigint
) returns json language plpgsql security definer set search_path = public as $$
declare
  v_staff staff; v_day business_days; v_shift shifts; v_tz text; v_hour int; v_date date;
begin
  select * into v_staff from current_staff();
  if v_staff is null then raise exception 'AUTH: not a staff member'; end if;
  if v_staff.outlet_id <> p_outlet then raise exception 'AUTH: not a staff member'; end if;
  if v_staff.role not in ('owner','manager','supervisor') then
    raise exception 'PERM: only manager or above can open the day';
  end if;

  select timezone, day_start_hour into v_tz, v_hour from outlets where id = p_outlet;
  v_date := business_date_of(now(), v_tz, v_hour);

  insert into business_days (outlet_id, business_date, opened_by)
  values (p_outlet, v_date, v_staff.id)
  on conflict (outlet_id, business_date) do nothing
  returning * into v_day;

  if v_day is null then
    select * into v_day from business_days where outlet_id = p_outlet and business_date = v_date;
    if v_day.status <> 'open' then raise exception 'DAY: % is already closed', v_date; end if;
  end if;

  insert into shifts (business_day_id, cashier_id, opening_float_paisa)
  values (v_day.id, v_staff.id, p_opening_float_paisa)
  returning * into v_shift;

  insert into audit_log (outlet_id, actor_id, action, entity_type, entity_id, after)
  values (p_outlet, v_staff.id, 'open_day', 'business_days', v_day.id, to_jsonb(v_day));

  return json_build_object('business_day', to_jsonb(v_day), 'shift', to_jsonb(v_shift));
end $$;
revoke all on function open_business_day(uuid, bigint) from public;
grant execute on function open_business_day(uuid, bigint) to authenticated;

-- ---------------------------------------------------------------------
-- 3) void_order — id-based, order fetched then checked.
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
  if v_order.outlet_id <> v_staff.outlet_id then raise exception 'ORDER: not found'; end if;

  select * into v_day from business_days where id = v_order.business_day_id;
  if v_day.status <> 'open' then
    raise exception 'DAY: closed — issue a next-day credit note instead';
  end if;

  insert into order_voids (order_id, order_item_id, reason_code, reason_note, authorised_by)
  values (p_order_id, p_order_item_id, p_reason_code, p_reason_note, v_staff.id);

  if p_order_item_id is null then
    update orders set status = 'voided' where id = p_order_id returning * into v_order;
    update order_items set status = 'voided' where order_id = p_order_id;

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
-- 4) advance_order_status — id-based.
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
  if v_order.outlet_id <> v_staff.outlet_id then raise exception 'ORDER: not found'; end if;

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
-- 5) add_items_to_order — id-based.
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
  if v_order.outlet_id <> v_staff.outlet_id then raise exception 'ORDER: not found'; end if;
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

-- ---------------------------------------------------------------------
-- 6) settle_order — id-based.
-- ---------------------------------------------------------------------
create or replace function settle_order(
  p_order_id uuid,
  p_payments jsonb,
  p_discount_paisa bigint default 0,
  p_service_charge_paisa bigint default 0,
  p_delivery_fee_paisa bigint default 0
) returns json language plpgsql security definer set search_path = public as $$
declare
  v_staff staff; v_order orders; v_day business_days;
  v_p jsonb; v_method payment_method; v_class tax_class;
  v_rate int; v_base bigint; v_tax bigint;
  v_base_total bigint := 0; v_tax_total bigint := 0; v_net_base bigint;
  v_inv text; v_rl record;
begin
  select * into v_staff from current_staff();
  if v_staff is null then raise exception 'AUTH: not a staff member'; end if;

  select * into v_order from orders where id = p_order_id for update;
  if v_order is null then raise exception 'ORDER: not found'; end if;
  if v_order.outlet_id <> v_staff.outlet_id then raise exception 'ORDER: not found'; end if;
  if v_order.status = 'settled' then raise exception 'ORDER: already settled'; end if;
  if v_order.status = 'voided'  then raise exception 'ORDER: voided'; end if;

  select * into v_day from business_days where id = v_order.business_day_id;
  if v_day.status <> 'open' then raise exception 'DAY: closed — cannot settle'; end if;

  if p_discount_paisa > 0 and v_staff.role not in ('owner','manager','supervisor') then
    raise exception 'PERM: discounts need manager authorisation';
  end if;

  v_net_base := v_order.subtotal_paisa - p_discount_paisa
                + p_service_charge_paisa + p_delivery_fee_paisa;
  if v_net_base < 0 then raise exception 'ORDER: discount exceeds bill'; end if;

  for v_p in select * from jsonb_array_elements(p_payments) loop
    v_method := (v_p->>'method')::payment_method;
    v_class  := class_of_method(v_method);
    v_rate   := tax_rate_bp(v_class, v_day.business_date);
    if v_rate is null then raise exception 'TAX: no rate configured for %', v_class; end if;

    v_base := (v_p->>'base_paisa')::bigint;
    v_tax  := round(v_base * v_rate / 10000.0);

    insert into payments (order_id, method, class, base_paisa, tax_rate_bp,
                          tax_paisa, amount_paisa, tendered_paisa, change_paisa, processor_ref)
    values (p_order_id, v_method, v_class, v_base, v_rate, v_tax, v_base + v_tax,
            (v_p->>'tendered_paisa')::bigint,
            greatest(coalesce((v_p->>'tendered_paisa')::bigint, 0) - (v_base + v_tax), 0),
            v_p->>'processor_ref');

    v_base_total := v_base_total + v_base;
    v_tax_total  := v_tax_total + v_tax;
  end loop;

  if v_base_total <> v_net_base then
    raise exception 'PAY: split payments (%) do not sum to bill (%)', v_base_total, v_net_base;
  end if;

  v_inv := next_invoice_no(v_order.outlet_id, v_day.business_date);

  update orders set
    discount_paisa       = p_discount_paisa,
    service_charge_paisa = p_service_charge_paisa,
    delivery_fee_paisa   = p_delivery_fee_paisa,
    tax_paisa            = v_tax_total,
    total_paisa          = v_net_base + v_tax_total,
    invoice_no            = v_inv,
    status               = 'settled',
    settled_at           = now()
  where id = p_order_id returning * into v_order;

  for v_rl in
    select rl.ingredient_id, sum(rl.qty * oi.qty) as total_qty
    from order_items oi
    join recipe_lines rl on rl.menu_item_id = oi.menu_item_id
    where oi.order_id = p_order_id and oi.status <> 'voided'
    group by rl.ingredient_id
  loop
    insert into stock_movements (outlet_id, ingredient_id, movement_type, qty,
                                 reference_type, reference_id, performed_by)
    values (v_order.outlet_id, v_rl.ingredient_id, 'sale_depletion', -v_rl.total_qty,
            'orders', p_order_id, v_staff.id);
  end loop;

  insert into audit_log (outlet_id, actor_id, action, entity_type, entity_id, after)
  values (v_order.outlet_id, v_staff.id, 'settle_order', 'orders', p_order_id, to_jsonb(v_order));

  return to_jsonb(v_order);
end $$;
revoke all on function settle_order(uuid, jsonb, bigint, bigint, bigint) from public;
grant execute on function settle_order(uuid, jsonb, bigint, bigint, bigint) to authenticated;

-- ---------------------------------------------------------------------
-- 7) advance_order_item_status — item-based; resolve to its order first.
-- ---------------------------------------------------------------------
create or replace function advance_order_item_status(p_order_item_id uuid, p_new_status order_item_status)
returns json language plpgsql security definer set search_path = public as $$
declare
  v_staff staff; v_item order_items; v_order orders; v_allowed boolean; v_remaining int;
begin
  select * into v_staff from current_staff();
  if v_staff is null or v_staff.role not in
     ('owner', 'manager', 'supervisor', 'chef', 'kitchen', 'barista') then
    raise exception 'PERM: kitchen role required';
  end if;

  select * into v_item from order_items where id = p_order_item_id for update;
  if v_item is null then raise exception 'ITEM: not found'; end if;

  select * into v_order from orders where id = v_item.order_id for update;
  if v_order.outlet_id <> v_staff.outlet_id then raise exception 'ITEM: not found'; end if;

  v_allowed := case v_item.status
    when 'pending'   then p_new_status = 'preparing'
    when 'preparing' then p_new_status = 'ready'
    else false
  end;
  if not v_allowed then
    raise exception 'ITEM: cannot move from % to %', v_item.status, p_new_status;
  end if;

  update order_items
     set status = p_new_status,
         ready_at = case when p_new_status = 'ready' then now() else ready_at end
   where id = p_order_item_id
   returning * into v_item;

  if v_order.status = 'sent_to_kitchen' then
    select count(*) into v_remaining from order_items
     where order_id = v_item.order_id and status in ('pending', 'preparing');
    if v_remaining = 0 then
      update orders set status = 'ready', ready_at = now()
       where id = v_item.order_id returning * into v_order;
    end if;
  end if;

  insert into audit_log (outlet_id, actor_id, action, entity_type, entity_id, after)
  values (v_order.outlet_id, v_staff.id, 'order_item_status_advanced', 'order_items', p_order_item_id,
          jsonb_build_object('status', p_new_status));

  return to_jsonb(v_item);
end $$;
revoke all on function advance_order_item_status(uuid, order_item_status) from public;
grant execute on function advance_order_item_status(uuid, order_item_status) to authenticated;

-- ---------------------------------------------------------------------
-- 8) mark_ticket_items_ready — id-based.
-- ---------------------------------------------------------------------
create or replace function mark_ticket_items_ready(p_order_id uuid, p_station kitchen_station default null)
returns json language plpgsql security definer set search_path = public as $$
declare v_staff staff; v_order orders; v_remaining int;
begin
  select * into v_staff from current_staff();
  if v_staff is null or v_staff.role not in
     ('owner', 'manager', 'supervisor', 'chef', 'kitchen', 'barista') then
    raise exception 'PERM: kitchen role required';
  end if;

  select * into v_order from orders where id = p_order_id for update;
  if v_order is null then raise exception 'ORDER: not found'; end if;
  if v_order.outlet_id <> v_staff.outlet_id then raise exception 'ORDER: not found'; end if;
  if v_order.status <> 'sent_to_kitchen' then
    raise exception 'ORDER: cannot mark ready from %', v_order.status;
  end if;

  update order_items oi
     set status = 'ready', ready_at = now()
   where oi.order_id = p_order_id
     and oi.status in ('pending', 'preparing')
     and (
       p_station is null
       or exists (
         select 1 from menu_items mi
         join menu_categories c on c.id = mi.category_id
         where mi.id = oi.menu_item_id and c.station = p_station
       )
     );

  select count(*) into v_remaining from order_items
   where order_id = p_order_id and status in ('pending', 'preparing');

  if v_remaining = 0 then
    update orders set status = 'ready', ready_at = now()
     where id = p_order_id returning * into v_order;
  end if;

  insert into audit_log (outlet_id, actor_id, action, entity_type, entity_id, after)
  values (v_order.outlet_id, v_staff.id, 'ticket_items_marked_ready', 'orders', p_order_id,
          jsonb_build_object('station', p_station, 'order_status', v_order.status));

  return to_jsonb(v_order);
end $$;
revoke all on function mark_ticket_items_ready(uuid, kitchen_station) from public;
grant execute on function mark_ticket_items_ready(uuid, kitchen_station) to authenticated;

-- ---------------------------------------------------------------------
-- 9) recall_order — id-based.
-- ---------------------------------------------------------------------
create or replace function recall_order(p_order_id uuid)
returns json language plpgsql security definer set search_path = public as $$
declare v_staff staff; v_order orders;
begin
  select * into v_staff from current_staff();
  if v_staff is null or v_staff.role not in
     ('owner', 'manager', 'supervisor', 'chef', 'kitchen', 'barista') then
    raise exception 'PERM: kitchen role required';
  end if;

  select * into v_order from orders where id = p_order_id for update;
  if v_order is null then raise exception 'ORDER: not found'; end if;
  if v_order.outlet_id <> v_staff.outlet_id then raise exception 'ORDER: not found'; end if;
  if v_order.status <> 'ready' then
    raise exception 'ORDER: only a ready ticket can be recalled (currently %)', v_order.status;
  end if;

  update order_items set status = 'preparing', ready_at = null
   where order_id = p_order_id and status = 'ready';

  update orders set status = 'sent_to_kitchen', ready_at = null
   where id = p_order_id returning * into v_order;

  insert into audit_log (outlet_id, actor_id, action, entity_type, entity_id, after)
  values (v_order.outlet_id, v_staff.id, 'order_recalled', 'orders', p_order_id, to_jsonb(v_order));

  return to_jsonb(v_order);
end $$;
revoke all on function recall_order(uuid) from public;
grant execute on function recall_order(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 10) record_invoice_print — id-based.
-- ---------------------------------------------------------------------
create or replace function record_invoice_print(p_order_id uuid)
returns int language plpgsql security definer set search_path = public as $$
declare v_staff staff; v_order orders; v_prior_count int;
begin
  select * into v_staff from current_staff();
  if v_staff is null then raise exception 'AUTH: not a staff member'; end if;

  select * into v_order from orders where id = p_order_id;
  if v_order is null then raise exception 'ORDER: not found'; end if;
  if v_order.outlet_id <> v_staff.outlet_id then raise exception 'ORDER: not found'; end if;

  select count(*) into v_prior_count from invoice_prints where order_id = p_order_id;

  insert into invoice_prints (order_id, printed_by, is_reprint)
  values (p_order_id, v_staff.id, v_prior_count > 0);

  insert into audit_log (outlet_id, actor_id, action, entity_type, entity_id, after)
  values (v_order.outlet_id, v_staff.id,
          case when v_prior_count > 0 then 'invoice_reprint' else 'invoice_print' end,
          'orders', p_order_id, jsonb_build_object('print_number', v_prior_count + 1));

  return v_prior_count + 1;
end $$;
revoke all on function record_invoice_print(uuid) from public;
grant execute on function record_invoice_print(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 11) enqueue_pra_submission — id-based.
-- ---------------------------------------------------------------------
create or replace function enqueue_pra_submission(p_order_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_staff staff; v_order orders; v_id uuid;
begin
  select * into v_staff from current_staff();
  if v_staff is null then raise exception 'AUTH: not a staff member'; end if;

  select * into v_order from orders where id = p_order_id;
  if v_order is null then raise exception 'ORDER: not found'; end if;
  if v_order.outlet_id <> v_staff.outlet_id then raise exception 'ORDER: not found'; end if;

  select id into v_id from pra_submission_queue
   where order_id = p_order_id and status in ('pending', 'failed')
   order by created_at desc limit 1;

  if v_id is not null then return v_id; end if;

  insert into pra_submission_queue (order_id) values (p_order_id) returning id into v_id;
  return v_id;
end $$;
revoke all on function enqueue_pra_submission(uuid) from public;
grant execute on function enqueue_pra_submission(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 12) record_pra_result — id-based; now checks BEFORE writing, not
--     after (the original checked `if v_order is null` only via the
--     UPDATE's own RETURNING, which can't express "found, but wrong
--     outlet" at all).
-- ---------------------------------------------------------------------
create or replace function record_pra_result(p_order_id uuid, p_pra_invoice_no text, p_qr_payload text)
returns void language plpgsql security definer set search_path = public as $$
declare v_staff staff; v_order orders;
begin
  select * into v_staff from current_staff();
  if v_staff is null then raise exception 'AUTH: not a staff member'; end if;

  select * into v_order from orders where id = p_order_id for update;
  if v_order is null then raise exception 'ORDER: not found'; end if;
  if v_order.outlet_id <> v_staff.outlet_id then raise exception 'ORDER: not found'; end if;

  update orders set
    pra_invoice_no = p_pra_invoice_no,
    pra_qr_payload = p_qr_payload,
    pra_synced_at  = now()
  where id = p_order_id
  returning * into v_order;

  update pra_submission_queue set status = 'submitted', submitted_at = now()
   where order_id = p_order_id and status in ('pending', 'failed');

  insert into audit_log (outlet_id, actor_id, action, entity_type, entity_id, after)
  values (v_order.outlet_id, v_staff.id, 'pra_submitted', 'orders', p_order_id,
          jsonb_build_object('pra_invoice_no', p_pra_invoice_no));
end $$;
revoke all on function record_pra_result(uuid, text, text) from public;
grant execute on function record_pra_result(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------
-- 13) record_pra_failure — queue-id-based; resolve to its order first.
-- ---------------------------------------------------------------------
create or replace function record_pra_failure(p_queue_id uuid, p_error text)
returns void language plpgsql security definer set search_path = public as $$
declare v_staff staff; v_queue pra_submission_queue; v_order orders; v_attempts int;
begin
  select * into v_staff from current_staff();
  if v_staff is null then raise exception 'AUTH: not a staff member'; end if;

  select * into v_queue from pra_submission_queue where id = p_queue_id for update;
  if v_queue is null then raise exception 'QUEUE: not found'; end if;

  select * into v_order from orders where id = v_queue.order_id;
  if v_order.outlet_id <> v_staff.outlet_id then raise exception 'QUEUE: not found'; end if;

  v_attempts := v_queue.attempts + 1;

  update pra_submission_queue set
    status = 'failed',
    attempts = v_attempts,
    last_error = p_error,
    next_attempt_at = now() + (least(power(2, v_attempts), 60) * interval '1 minute')
  where id = p_queue_id;

  insert into audit_log (outlet_id, actor_id, action, entity_type, entity_id, after)
  values (v_order.outlet_id, v_staff.id, 'pra_submission_failed', 'orders', v_queue.order_id,
          jsonb_build_object('attempts', v_attempts, 'error', p_error));
end $$;
revoke all on function record_pra_failure(uuid, text) from public;
grant execute on function record_pra_failure(uuid, text) to authenticated;

-- =====================================================================
-- Cup Shup POS — Part 22 §1: order-type pricing
-- =====================================================================
-- "Sabse zyada paise wala gap" per 22-restaurant-operations.md: today
-- one item has exactly one price, so a delivery order is charged the
-- same as a dine-in one even though packaging, rider payout, and
-- aggregator commission all make delivery genuinely more expensive to
-- fulfil. This migration adds an OPTIONAL per-order-type override price
-- on top of the existing default price, not a second parallel pricing
-- system — an item with no override behaves exactly as it does today.
--
-- order_source is added now (per the brief's own explicit instruction)
-- even though nothing reads it yet — a nullable column costs nothing to
-- add today and a lot to add later once real rows exist without it.
-- =====================================================================

alter table menu_item_prices add column order_type order_type;
alter table menu_item_prices add column order_source text;

-- Replaces the old "exactly one live DEFAULT price per item" index with
-- two indexes covering "exactly one live price per (item, order_type)",
-- including exactly one live default (order_type IS NULL) per item. A
-- single unique index on (menu_item_id, order_type) would NOT enforce
-- that on its own: Postgres treats every NULL as distinct from every
-- other NULL in a unique index, so it would silently allow unlimited
-- concurrent "default" rows for the same item. (A coalesce()-based
-- single index was tried first and rejected by Postgres itself —
-- "functions in index expression must be marked IMMUTABLE," since an
-- enum's ::text cast isn't catalogued as immutable — so this splits into
-- two plain, cast-free indexes instead: one for the NULL case, one for
-- the non-NULL case, each enforced the ordinary way.)
drop index menu_item_price_current;
create unique index menu_item_price_current_default
  on menu_item_prices (menu_item_id)
  where effective_to is null and order_type is null;
create unique index menu_item_price_current_override
  on menu_item_prices (menu_item_id, order_type)
  where effective_to is null and order_type is not null;

-- ---------------------------------------------------------------------
-- current_price_paisa() — now order-type aware. Exact match (item +
-- order_type) wins over the default (order_type IS NULL) whenever both
-- are currently effective; p_order_type default null (or no override
-- existing for it) falls back to exactly the old, unqualified default
-- lookup. The WHERE clause already scopes to just these two candidate
-- rows, so ordering by "is this the exact match" is enough to pick the
-- right one without a second query/UNION.
-- ---------------------------------------------------------------------
create or replace function current_price_paisa(
  p_item uuid,
  p_on date default current_date,
  p_order_type order_type default null
) returns bigint language sql stable as $$
  select price_paisa from menu_item_prices
  where menu_item_id = p_item
    and effective_from <= p_on
    and (effective_to is null or effective_to > p_on)
    and (order_type = p_order_type or order_type is null)
  order by (order_type is not null) desc, effective_from desc
  limit 1;
$$;

-- ---------------------------------------------------------------------
-- place_order() — threads its own p_order_type param (already accepted,
-- already stored on the order — just never reached the price lookup)
-- into current_price_paisa(). Identical otherwise to 0040's version.
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

  if p_table_id is not null and not exists (
    select 1 from dining_tables where id = p_table_id and outlet_id = p_outlet
  ) then
    raise exception 'TABLE: not found';
  end if;
  if p_customer_id is not null and not exists (
    select 1 from customers where id = p_customer_id and outlet_id = p_outlet
  ) then
    raise exception 'CUSTOMER: not found';
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

    v_price := current_price_paisa((v_item->>'menu_item_id')::uuid, v_date, p_order_type);
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
-- add_items_to_order() — same fix, using the EXISTING order's own
-- order_type (fixed at place_order() time, an order never changes type
-- mid-life). Identical otherwise to 0035's version.
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

    v_price := current_price_paisa((v_item->>'menu_item_id')::uuid, v_day.business_date, v_order.order_type);
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
-- change_item_price() — the close-out UPDATE now scopes to
-- `order_type is null` explicitly. Without this fix, changing an item's
-- DEFAULT price would also silently close out every takeaway/delivery
-- override on that item (the old `where menu_item_id = p_item_id and
-- effective_to is null` matched ALL live rows for the item, override or
-- not) — a real regression this same migration would otherwise have
-- shipped alongside the feature it's adding.
-- ---------------------------------------------------------------------
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
   where menu_item_id = p_item_id and order_type is null and effective_to is null;

  if v_old_price is not null and v_old_price = p_new_price_paisa then
    update menu_items set price_unconfirmed = false where id = p_item_id;
    return;
  end if;

  update menu_item_prices set effective_to = current_date
   where menu_item_id = p_item_id and order_type is null and effective_to is null;

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

-- ---------------------------------------------------------------------
-- set_item_order_type_price() — new. Sets (or replaces) the override
-- price for one specific order_type on one item. Same ownership check
-- and owner/manager-only gate as change_item_price(); same
-- close-out-then-insert history-preserving pattern, scoped to this one
-- order_type so it never touches the default row or any OTHER
-- order_type's override.
-- ---------------------------------------------------------------------
create or replace function set_item_order_type_price(
  p_item_id uuid,
  p_order_type order_type,
  p_price_paisa bigint
) returns void language plpgsql security definer set search_path = public as $$
declare v_actor staff;
begin
  select * into v_actor from current_staff();
  if v_actor is null or v_actor.role not in ('owner','manager') then
    raise exception 'PERM: only owner or manager can change prices';
  end if;

  if p_price_paisa < 0 then
    raise exception 'PRICE: cannot be negative';
  end if;

  if not exists (
    select 1 from menu_items mi join menu_categories mc on mc.id = mi.category_id
     where mi.id = p_item_id and mc.outlet_id = v_actor.outlet_id
  ) then
    raise exception 'ITEM: not found';
  end if;

  update menu_item_prices set effective_to = current_date
   where menu_item_id = p_item_id and order_type = p_order_type and effective_to is null;

  insert into menu_item_prices (menu_item_id, order_type, price_paisa, effective_from)
  values (p_item_id, p_order_type, p_price_paisa, current_date);

  insert into audit_log (outlet_id, actor_id, action, entity_type, entity_id, after)
  values (v_actor.outlet_id, v_actor.id, 'order_type_price_set', 'menu_items', p_item_id,
          jsonb_build_object('order_type', p_order_type, 'price_paisa', p_price_paisa));
end $$;
revoke all on function set_item_order_type_price(uuid, order_type, bigint) from public;
grant execute on function set_item_order_type_price(uuid, order_type, bigint) to authenticated;

-- ---------------------------------------------------------------------
-- clear_item_order_type_price() — removes an override so that order
-- type falls back to the item's default price again. Closing out
-- without inserting a replacement is deliberate: current_price_paisa()
-- already falls back to the default row the moment no override row is
-- currently effective, so "clear" needs no special-case logic there.
-- ---------------------------------------------------------------------
create or replace function clear_item_order_type_price(p_item_id uuid, p_order_type order_type)
returns void language plpgsql security definer set search_path = public as $$
declare v_actor staff;
begin
  select * into v_actor from current_staff();
  if v_actor is null or v_actor.role not in ('owner','manager') then
    raise exception 'PERM: only owner or manager can change prices';
  end if;

  if not exists (
    select 1 from menu_items mi join menu_categories mc on mc.id = mi.category_id
     where mi.id = p_item_id and mc.outlet_id = v_actor.outlet_id
  ) then
    raise exception 'ITEM: not found';
  end if;

  update menu_item_prices set effective_to = current_date
   where menu_item_id = p_item_id and order_type = p_order_type and effective_to is null;

  insert into audit_log (outlet_id, actor_id, action, entity_type, entity_id, after)
  values (v_actor.outlet_id, v_actor.id, 'order_type_price_cleared', 'menu_items', p_item_id,
          jsonb_build_object('order_type', p_order_type));
end $$;
revoke all on function clear_item_order_type_price(uuid, order_type) from public;
grant execute on function clear_item_order_type_price(uuid, order_type) to authenticated;

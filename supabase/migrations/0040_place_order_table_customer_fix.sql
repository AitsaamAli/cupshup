-- =====================================================================
-- Cup Shup POS — Third-wave audit: place_order() table_id/customer_id gap
-- =====================================================================
-- The third-wave directive's "foreign-ID attack generator" (§7) named
-- table_id and customer_id explicitly as ids to test — and a systematic
-- pass over EVERY foreign id THIS SAME FUNCTION accepts (not just
-- p_outlet, which 0035 already fixed) found that place_order() never
-- checks p_table_id or p_customer_id against the caller's outlet at all.
-- This is the sharpest possible proof of the user's point: place_order()
-- was already the subject of two prior fixes (0032 idempotency, 0035
-- cross-outlet on p_outlet) and STILL had an unfixed sibling gap on two
-- of its own other parameters.
--
-- Impact: a staff member could pass a table_id or customer_id belonging
-- to a different outlet (if known or guessed) and it would be silently
-- accepted onto their own outlet's order — a dangling/foreign reference
-- that pollutes another outlet's customer's order-history association,
-- and a table_id an outlet can't even SELECT via dining_tables' own RLS.
-- Lower severity than the write-bypass findings (the order row itself
-- stays correctly scoped to the caller's real outlet — this can't be
-- used to write into another outlet's financial ledger), but it is the
-- exact "does this operation verify EVERY foreign id, not just the ones
-- already proven exploitable" gap the user is auditing for.
-- =====================================================================

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

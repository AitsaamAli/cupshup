-- =====================================================================
-- Cup Shup POS — a third real bug, found by actually firing 10
-- concurrent place_order() calls at the live database with the same
-- idempotency key (not simulated — real parallel HTTP-equivalent RPC
-- calls). Result: 1 order created (correct — the unique constraint
-- held), but occasionally (~1 in 20 runs) one caller received a raw
-- "duplicate key value violates unique constraint" error instead of a
-- graceful duplicate:true response.
--
-- Cause: the existing dedup check (SELECT then, if not found, INSERT)
-- has an inherent race window between the SELECT and the INSERT — two
-- concurrent transactions can both pass the "not found" check before
-- either commits. The unique constraint is the real safety net (it's
-- why no actual duplicate ORDER was ever created), but the loser of
-- that race got the constraint's raw error surfaced to it instead of
-- the same graceful response the winner got.
--
-- Fix: catch unique_violation specifically around the INSERT and, on
-- exactly that error, re-fetch and return the row the other concurrent
-- caller just committed — turning the constraint from "last line of
-- defense that leaks a raw error" into "silent, correct fallback".
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

  -- The race-safe insert: if a concurrent call committed the SAME
  -- idempotency key between the SELECT above and this INSERT, catch it
  -- here specifically and fall through to the exact same "return the
  -- existing order" behaviour as the normal dedup path above, instead
  -- of letting the constraint violation propagate as a raw error.
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

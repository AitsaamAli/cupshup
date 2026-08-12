-- =====================================================================
-- Cup Shup POS — Part 20: a real bug found while writing the
-- idempotency pgTAP test (supabase/tests/database/idempotency.sql),
-- confirmed live against the real project 2026-08-12, not hypothetical.
--
-- place_order()'s duplicate-order guard has looked like this since
-- Part 09:
--
--   select * into v_existing from orders
--    where outlet_id = p_outlet and idempotency_key = p_idempotency_key;
--   if v_existing is not null then
--     return json_build_object('order', to_jsonb(v_existing), 'duplicate', true);
--   end if;
--
-- `v_existing` is a composite `orders` row. Postgres's `ROW IS NOT
-- NULL` is true only when EVERY field in the row is non-null — and a
-- real order row almost never has every field populated (table_id is
-- null for takeaway, invoice_no is null until settlement, pra_* stay
-- null until PRA sync, ...). So even when the SELECT genuinely found
-- the original order, `v_existing is not null` evaluated to FALSE, and
-- execution fell through to the INSERT below it — which then failed on
-- the `unique (outlet_id, idempotency_key)` constraint instead of
-- returning `duplicate: true`.
--
-- The unique constraint is exactly why no actual duplicate ORDER was
-- ever created by this bug — that part of the safety net held. What
-- broke was the promise built on top of it: a safe, silent retry.
-- Every retry after a dropped connection was hitting a raw Postgres
-- "duplicate key value violates unique constraint" error instead of
-- transparently getting the original order back — which
-- `isNetworkError()` (Part 20, lib/offline-network.ts) does not
-- recognise as a network problem, so it would have surfaced to a
-- cashier as a hard failure on exactly the retry path idempotency keys
-- exist to make safe.
--
-- Confirmed live via a direct two-call reproduction before this fix
-- (call 1 succeeds and is visible in a same-transaction count; call 2,
-- same key, still attempts an INSERT and hits the constraint instead of
-- returning duplicate: true) and confirmed fixed after it (call 2
-- correctly returns duplicate: true, no constraint violation) — see
-- docs/testing-strategy.md §3.
--
-- Fix: check the row's PRIMARY KEY specifically, never the whole row —
-- `id` is the one column guaranteed non-null exactly when a row was
-- actually found, and null exactly when it wasn't.
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

  -- Idempotency: same key -> return the original order, do not create a second one
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
-- Grants unchanged from 0010_order_engine_functions.sql — create or
-- replace keeps them, restated here only for anyone reading this file
-- in isolation.
revoke all on function place_order(uuid, order_type, jsonb, text, uuid, uuid, text) from public;
grant execute on function place_order(uuid, order_type, jsonb, text, uuid, uuid, text) to authenticated;

-- ---------------------------------------------------------------------
-- Same defensive fix applied to the one other place this exact pattern
-- appeared (0002_auth_functions.sql) — lower stakes (a skipped audit-
-- log line, not a duplicate-order risk) but the same underlying
-- mistake, not left in place now that it's been found.
-- ---------------------------------------------------------------------
create or replace function log_staff_logout()
returns void language plpgsql security definer set search_path = public as $$
declare v_staff staff;
begin
  select * into v_staff from current_staff();
  if v_staff.id is not null then
    insert into audit_log (outlet_id, actor_id, action, entity_type, entity_id)
    values (v_staff.outlet_id, v_staff.id, 'logout', 'staff', v_staff.id);
  end if;
end $$;
revoke all on function log_staff_logout() from public;
grant execute on function log_staff_logout() to authenticated;

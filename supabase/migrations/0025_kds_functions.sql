-- =====================================================================
-- Cup Shup POS — Part 17: Kitchen Display System — functions
-- Not in the reference file; original to this project, same shape as
-- everything else here: SECURITY DEFINER, internal role check, audit_log
-- entry. Required because order_items (like orders) has its writes
-- revoked from anon/authenticated directly (0005_rls.sql) — the
-- kds_update_items RLS policy that same file wrote for order_items can
-- never actually fire over the API as a result, since a revoked GRANT
-- blocks the operation before RLS is even consulted. These three
-- functions are the real write path that policy's intent needed.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Moves ONE item forward: pending -> preparing -> ready. Any other
-- transition (including skipping preparing, or touching a voided/served
-- item) is rejected. If this was the LAST non-ready item left on its
-- order, the whole order auto-completes to 'ready' as a side effect —
-- see mark_ticket_items_ready() below for why that's the right trigger
-- point rather than requiring a separate manual "finish the order" tap.
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

  select * into v_order from orders where id = v_item.order_id for update;

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
-- The "All ready" button. p_station is which station's screen is
-- calling it — only THAT station's pending/preparing items on this
-- ticket get bumped to ready in one tap, not the whole order (a
-- multi-station ticket, e.g. a burger + a chai on one table, must not
-- let Hot Kitchen mark the chai ready). Pass p_station = null for the
-- "All stations" view's bulk button, which legitimately does mean
-- every item regardless of station.
--
-- The order itself only flips to 'ready' once EVERY item across every
-- station has reached ready — same completion check as
-- advance_order_item_status() above, so it doesn't matter whether the
-- last item got there one tap at a time or via this bulk action.
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
-- RECALL — brings a ticket that was just marked ready back onto the
-- active board. Only valid from 'ready' (a 'served' order has already
-- moved past the kitchen's part of the job — Part 09's
-- add_items_to_order() already handles the "customer wants more" case
-- for that state by re-opening it). Resets every item that had reached
-- 'ready' back to 'preparing' — for every station, not just whichever
-- station's screen tapped Recall, since the ticket wasn't actually
-- complete for the floor either way and every station needs to see it
-- active again. A more surgical per-station recall was considered and
-- deliberately left out — not asked for, and it reopens exactly the
-- "does the floor think this ticket is done or not" ambiguity Recall
-- exists to resolve.
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

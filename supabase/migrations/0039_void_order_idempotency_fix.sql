-- =====================================================================
-- Cup Shup POS — Second-wave audit: void_order() double-void bug
-- =====================================================================
-- A state-machine sweep (not a cross-outlet one — this bug exists even
-- for a manager voiding their OWN outlet's order) found that void_order()
-- is the only order-mutating function with no guard on the order's
-- CURRENT status before acting. advance_order_status() and
-- add_items_to_order() both explicitly reject an already-'voided' order;
-- void_order() itself never did.
--
-- Concretely: calling void_order() twice on the same order (accidental
-- double-submit, or deliberate) re-runs the stock give-back block both
-- times. The give-back is computed by re-summing every 'sale_depletion'
-- stock_movement tied to this order id — a query that isn't affected by
-- the FIRST void's 'void_return' rows — so the second call computes and
-- inserts the exact same give-back a second time, silently duplicating
-- stock, inflating on-hand quantities, and corrupting moving-average
-- cost and stock-variance reporting for every ingredient the order used.
--
-- This migration adds ONLY that guard. It deliberately does NOT change
-- whether voiding an already-SETTLED order is allowed — the order
-- lifecycle diagram in docs/order-engine.md §3 explicitly shows
-- `settled -> (voided)` as an intended transition, and redefining that
-- is a product/financial-policy decision, not a pure idempotency fix.
-- See docs/security-audit-2026-08-14-second-wave.md for the SEPARATE,
-- still-open finding about what voiding a settled order does to cash
-- reconciliation (close_business_day/close_shift both filter
-- `status = 'settled'`, so a settled-then-voided order's real cash
-- payment silently drops out of expected-cash math) — that one is
-- reported, not guess-fixed here.
-- =====================================================================

create or replace function void_order(
  p_order_id uuid,
  p_reason_code text,
  p_reason_note text default null,
  p_order_item_id uuid default null
) returns json language plpgsql security definer set search_path = public as $$
declare v_staff staff; v_order orders; v_day business_days; v_rl record; v_item order_items;
begin
  select * into v_staff from current_staff();
  if v_staff is null or v_staff.role not in ('owner','manager','supervisor') then
    raise exception 'PERM: voids require manager authorisation';
  end if;

  select * into v_order from orders where id = p_order_id for update;
  if v_order is null then raise exception 'ORDER: not found'; end if;
  if v_order.outlet_id <> v_staff.outlet_id then raise exception 'ORDER: not found'; end if;
  if v_order.status = 'voided' then raise exception 'ORDER: already voided'; end if;

  select * into v_day from business_days where id = v_order.business_day_id;
  if v_day.status <> 'open' then
    raise exception 'DAY: closed — issue a next-day credit note instead';
  end if;

  if p_order_item_id is not null then
    select * into v_item from order_items where id = p_order_item_id and order_id = p_order_id;
    if v_item is null then raise exception 'ITEM: not found on this order'; end if;
    if v_item.status = 'voided' then raise exception 'ITEM: already voided'; end if;
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

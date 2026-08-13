-- =====================================================================
-- Cup Shup POS — settled-order void: access control + audit trail
-- =====================================================================
-- Finding, from docs/security-audit-2026-08-14-second-wave.md and an
-- external code audit (2026-08-13): void_order() lets any
-- manager/supervisor void an already-SETTLED order. Doing so flips the
-- order to 'voided' with no other trace. Both close_business_day() and
-- close_shift() compute cash_sales as
--   sum(p.amount_paisa) ... where o.status = 'settled' and p.method = 'cash'
-- so the instant an order stops being 'settled', its entire cash
-- contribution — the join filters on the order's CURRENT status, not
-- "was this order settled at some point during the period" — silently
-- drops out of expected cash. A cashier who pockets the cash and then
-- voids the order makes counted cash AND expected cash fall by the same
-- amount, so the variance report shows zero. Nothing else in the system
-- records that this happened.
--
-- IMPORTANT — verified against the actual query before writing this:
-- an earlier version of this fix (matching a suggestion from the code
-- audit) proposed inserting a negative "reversal" payments row and nothing
-- else, reasoning that the reversal would cancel the original payment in
-- the cash_sales sum. That reasoning doesn't hold: once the order is
-- 'voided', the `o.status = 'settled'` join filter excludes that order's
-- payments rows ENTIRELY — the original AND any reversal — so a reversal
-- row alone changes nothing about the sum. Confirmed by reading
-- close_business_day/close_shift directly (0036_second_wave_ownership_
-- fixes.sql), not by trusting the suggestion.
--
-- What a reversal row genuinely IS good for: an explicit, permanent,
-- queryable record of "this much cash was un-settled by a void, by whom,
-- when" — instead of the current behaviour where the money just stops
-- appearing anywhere once the order flips to 'voided'. Two real fixes,
-- neither of which is "the math quietly fixes itself":
--
--   1. ACCESS CONTROL — voiding an already-SETTLED order now requires
--      the OWNER role specifically, not manager/supervisor. This is a
--      real control: a cashier acting alone, or with a complicit
--      manager, can no longer make a settled order's cash disappear
--      without the owner's own credentials.
--
--   2. VISIBILITY — void_order() now writes a mirrored negative
--      "reversal" payments row for every payment on a settled order it
--      voids (linked via the new reverses_payment_id column). Both
--      close_business_day() and close_shift() now surface the total of
--      these reversals as a new, separate `voided_after_settle_cash_paisa`
--      figure in the closing snapshot — every day/shift close makes this
--      number visible instead of it being invisible-by-omission. This is
--      deliberately reported, not netted into expected_cash_paisa/
--      variance_paisa: a genuine settled-then-voided refund (cash
--      actually handed back to the customer) SHOULD reduce expected
--      cash, exactly as it already does today. The fix is that an owner
--      reviewing the close can now see "Rs 6,500 was voided after
--      settlement today" and go verify each one, rather than that figure
--      being unrecoverable from the closing snapshot at all.
-- =====================================================================

-- ---------------------------------------------------------------------
-- payments: add the reversal link. Reversal rows carry a negative
-- base_paisa, which the original check constraint disallowed outright
-- (it was written assuming every row is a real, positive payment) — the
-- constraint is widened to admit negative amounts ONLY when the row
-- explicitly says what it reverses.
-- ---------------------------------------------------------------------
alter table payments add column reverses_payment_id uuid references payments(id);
create index on payments (reverses_payment_id) where reverses_payment_id is not null;

alter table payments drop constraint payments_base_paisa_check;
alter table payments add constraint payments_base_paisa_check
  check (base_paisa >= 0 or reverses_payment_id is not null);

-- ---------------------------------------------------------------------
-- void_order() — owner-only for a settled order, plus the reversal rows.
-- Everything else (idempotency guard from 0039, item-level void, stock
-- give-back) is unchanged.
-- ---------------------------------------------------------------------
create or replace function void_order(
  p_order_id uuid,
  p_reason_code text,
  p_reason_note text default null,
  p_order_item_id uuid default null
) returns json language plpgsql security definer set search_path = public as $$
declare
  v_staff staff; v_order orders; v_day business_days; v_rl record; v_item order_items;
  v_pay payments;
begin
  select * into v_staff from current_staff();
  if v_staff is null or v_staff.role not in ('owner','manager','supervisor') then
    raise exception 'PERM: voids require manager authorisation';
  end if;

  select * into v_order from orders where id = p_order_id for update;
  if v_order is null then raise exception 'ORDER: not found'; end if;
  if v_order.outlet_id <> v_staff.outlet_id then raise exception 'ORDER: not found'; end if;
  if v_order.status = 'voided' then raise exception 'ORDER: already voided'; end if;

  -- A settled order has already been paid for — voiding it makes real
  -- cash disappear from reconciliation (see migration header). Only the
  -- owner can authorise that; a manager/supervisor voiding a NOT-YET-
  -- settled order (the common case — wrong item, kitchen 86, etc.) is
  -- unaffected.
  if v_order.status = 'settled' and v_staff.role <> 'owner' then
    raise exception 'PERM: voiding a settled order requires the owner';
  end if;

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
    if v_order.status = 'settled' then
      for v_pay in select * from payments where order_id = p_order_id and reverses_payment_id is null
      loop
        insert into payments (order_id, method, class, base_paisa, tax_rate_bp, tax_paisa,
                              amount_paisa, reverses_payment_id)
        values (p_order_id, v_pay.method, v_pay.class, -v_pay.base_paisa, v_pay.tax_rate_bp,
                -v_pay.tax_paisa, -v_pay.amount_paisa, v_pay.id);
      end loop;
    end if;

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
-- close_business_day() — add voided_after_settle_cash_paisa to the
-- snapshot. Deliberately NOT folded into v_expected/variance (see
-- header) — this is a visibility figure, not a correction to the cash
-- math, which was already right.
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
  v_voided_after_settle_cash bigint;
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

  select coalesce(sum(-p.amount_paisa),0) into v_voided_after_settle_cash
  from payments p join orders o on o.id = p.order_id
  where o.business_day_id = p_business_day_id and p.reverses_payment_id is not null and p.method = 'cash';

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
    'variance_paisa', p_counted_cash_paisa - v_expected,
    'voided_after_settle_cash_paisa', v_voided_after_settle_cash
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
-- close_shift() — same addition, shift-scoped.
-- ---------------------------------------------------------------------
create or replace function close_shift(p_shift_id uuid, p_counted_cash_paisa bigint)
returns json language plpgsql security definer set search_path = public as $$
declare
  v_staff staff; v_shift shifts;
  v_cash_sales bigint; v_cash_expenses bigint;
  v_voided_after_settle_cash bigint;
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

  select coalesce(sum(-p.amount_paisa),0) into v_voided_after_settle_cash
  from payments p join orders o on o.id = p.order_id
  where o.shift_id = p_shift_id and p.reverses_payment_id is not null and p.method = 'cash';

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
  values (v_staff.outlet_id, v_staff.id, 'close_shift', 'shifts', p_shift_id,
          to_jsonb(v_shift) || jsonb_build_object('voided_after_settle_cash_paisa', v_voided_after_settle_cash));

  return to_jsonb(v_shift) || jsonb_build_object('voided_after_settle_cash_paisa', v_voided_after_settle_cash);
end $$;
revoke all on function close_shift(uuid, bigint) from public;
grant execute on function close_shift(uuid, bigint) to authenticated;

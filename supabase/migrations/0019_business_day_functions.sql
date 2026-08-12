-- =====================================================================
-- Cup Shup POS — Business Day, Shifts & Cash Reconciliation
-- Part 13.
--
-- open_business_day() and close_business_day() are copied verbatim from
-- the project's full reference 0002_functions.sql — this closes the
-- last gap in 0005_rls.sql's original grant statement, tracked since
-- Part 04 (place_order/settle_order/void_order already had their own
-- explicit grants from Parts 09/10; only these two were still missing).
--
-- open_shift() and close_shift() are original to this project — not in
-- the reference file. Part 13's own brief explicitly asks for
-- per-cashier shift open/close (a 3pm-3am cafe runs at least two
-- drawers) and per-SHIFT variance, not just per-day — the reference
-- file's open_business_day() only ever creates one shift, for whoever
-- opens the day.
-- =====================================================================

-- A cash expense can only reduce a specific shift's expected cash if we
-- know which shift it was paid from. expenses only had business_day_id
-- until now — close_business_day()'s day-level formula (below) never
-- needed more than that, but true PER-SHIFT variance does. Nullable, so
-- nothing existing breaks; Part 14 (Expenses) is what will actually let
-- staff set this when they record an expense.
alter table expenses add column if not exists shift_id uuid references shifts(id);
create index if not exists expenses_shift_id_idx on expenses (shift_id);

-- ---------------------------------------------------------------------
-- OPEN BUSINESS DAY
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
-- CLOSE BUSINESS DAY (one transaction: snapshot + lock)
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
  if v_day.status <> 'open' then raise exception 'DAY: already closed'; end if;

  select count(*), coalesce(sum(subtotal_paisa - discount_paisa + service_charge_paisa + delivery_fee_paisa),0),
         coalesce(sum(tax_paisa),0), coalesce(sum(total_paisa),0), coalesce(sum(cogs_paisa),0)
    into v_orders, v_revenue, v_tax, v_collected, v_cogs
  from orders where business_day_id = p_business_day_id and status = 'settled';

  v_gross := v_revenue - v_cogs;   -- REAL gross profit, not a flat 40%

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
-- OPEN SHIFT — a second (or third) cashier starting their own drawer
-- within an already-open business day. One open shift per cashier at a
-- time, so a variance can always be traced to exactly one person.
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

-- ---------------------------------------------------------------------
-- CLOSE SHIFT — a cashier's own drawer, reconciled independently of the
-- whole business day. The shift's own cashier, or a manager, can close
-- it. Deliberately excludes cash expenses from the formula unless
-- they're tagged with THIS shift's id (most won't be, until Part 14
-- wires up shift_id on expense entry) — attributing an untagged expense
-- to whichever cashier happens to be closing would be a guess, and a
-- wrong guess here defeats the entire point of per-shift variance. See
-- docs/business-day-and-shifts.md for the full reasoning.
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
  if v_shift is null then raise exception 'SHIFT: not found'; end if;
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
-- RECORD CASH MOVEMENT — float top-up, drop to the safe, pickup,
-- petty-cash paid-out/paid-in, all against the CURRENT staff member's
-- own open shift. No separate "reason required" enforcement here beyond
-- the column already being free text — matches cash_movements.reason
-- (Part 03), nullable.
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
  if v_shift is null then raise exception 'SHIFT: not found'; end if;
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

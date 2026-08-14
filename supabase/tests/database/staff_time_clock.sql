-- =====================================================================
-- Cup Shup POS — pgTAP: staff time clock + real labour cost %, Patch 2
--
-- Regression test for 0049_staff_time_clock.sql. Covers: clock in/out
-- records correct hours and cost, a double clock-in is rejected, a
-- break longer than the shift is rejected at the source, permission
-- gating on set_staff_hourly_rate(), and — the master-prompt §1
-- non-negotiable — that the EXISTING labour_cost_daily view (amortised
-- salary expenses) is completely untouched by any of this.
--
-- Same technique as house_accounts.sql / order_type_pricing.sql: one
-- owner + one cashier identity, identity-switched via set_config within
-- one rolled-back transaction. The clock_in timestamp is backdated by a
-- direct UPDATE (run before switching to the `authenticated` role, same
-- privilege level test setup already uses elsewhere in this file) so a
-- real elapsed duration can be tested without an actual 2-hour wait.
-- =====================================================================

begin;
select plan(9);

do $$
declare
  v_outlet uuid;
  v_owner_user uuid := gen_random_uuid();
  v_cashier_user uuid := gen_random_uuid();
  v_owner_staff uuid;
  v_cashier_staff uuid;
  v_day business_days;
  v_tz text; v_start_hour int; v_today date;
begin
  select id, timezone, day_start_hour into v_outlet, v_tz, v_start_hour from outlets limit 1;
  v_today := business_date_of(now(), v_tz, v_start_hour);

  insert into auth.users (id) values (v_owner_user);
  insert into staff (user_id, outlet_id, code, name, role)
  values (v_owner_user, v_outlet, 'PGTAP-TC-OWN', 'pgTAP TimeClock Owner', 'owner')
  returning id into v_owner_staff;

  insert into auth.users (id) values (v_cashier_user);
  insert into staff (user_id, outlet_id, code, name, role)
  values (v_cashier_user, v_outlet, 'PGTAP-TC-CSH', 'pgTAP TimeClock Cashier', 'cashier')
  returning id into v_cashier_staff;

  select * into v_day from business_days where outlet_id = v_outlet and business_date = v_today;
  if v_day.id is null then
    insert into business_days (outlet_id, business_date, status, opened_by)
    values (v_outlet, v_today, 'open', v_owner_staff)
    returning * into v_day;
  elsif v_day.status <> 'open' then
    update business_days set status = 'open' where id = v_day.id;
  end if;

  perform set_config('pgtap.outlet', v_outlet::text, true);
  perform set_config('pgtap.today', v_today::text, true);
  perform set_config('pgtap.owner_user', v_owner_user::text, true);
  perform set_config('pgtap.cashier_user', v_cashier_user::text, true);
  perform set_config('pgtap.cashier_staff', v_cashier_staff::text, true);
end $$;

select set_config('request.jwt.claim.sub', current_setting('pgtap.owner_user'), true);
set local role authenticated;

-- A cashier cannot set anyone's hourly rate — owner/manager only.
select set_config('request.jwt.claim.sub', current_setting('pgtap.cashier_user'), true);
do $$
declare v_code text := 'none';
begin
  begin
    perform set_staff_hourly_rate(current_setting('pgtap.cashier_staff')::uuid, 100000);
  exception when others then
    get stacked diagnostics v_code = message_text;
  end;
  perform set_config('pgtap.cashier_attack', v_code, true);
end $$;

select ok(
  current_setting('pgtap.cashier_attack') = 'PERM: only owner or manager can set hourly rates',
  'a cashier cannot set their own hourly rate — owner/manager only'
);

-- Owner sets the cashier's hourly rate to Rs 1000/hour.
select set_config('request.jwt.claim.sub', current_setting('pgtap.owner_user'), true);
do $$
begin
  perform set_staff_hourly_rate(current_setting('pgtap.cashier_staff')::uuid, 100000);
end $$;

select ok(
  (select hourly_rate_paisa from staff where id = current_setting('pgtap.cashier_staff')::uuid) = 100000,
  'hourly rate set to Rs 1000/hour'
);

-- Cashier clocks in, then we backdate the clock_in to 2 hours ago
-- (superuser-level UPDATE, same privilege as this file's own setup
-- block above) so a real elapsed duration can be tested.
select set_config('request.jwt.claim.sub', current_setting('pgtap.cashier_user'), true);
do $$
declare v_row attendance;
begin
  v_row := clock_in();
  perform set_config('pgtap.attendance_id', v_row.id::text, true);
end $$;

-- Back to the original (superuser) role for this one direct UPDATE —
-- attendance has insert/update/delete revoked from `authenticated` by
-- design (0049), same as orders/payments/business_days already are.
reset role;
update attendance set clock_in = now() - interval '2 hours' where id = current_setting('pgtap.attendance_id')::uuid;
set local role authenticated;

-- A second clock-in while already clocked in is rejected.
do $$
declare v_code text := 'none';
begin
  begin
    perform clock_in();
  exception when others then
    get stacked diagnostics v_code = message_text;
  end;
  perform set_config('pgtap.double_clockin', v_code, true);
end $$;

select ok(
  current_setting('pgtap.double_clockin') = 'ATTENDANCE: already clocked in',
  'a second clock-in while already clocked in is rejected'
);

-- A break longer than the (backdated, ~2h) shift is rejected.
do $$
declare v_code text := 'none';
begin
  begin
    perform clock_out(200);
  exception when others then
    get stacked diagnostics v_code = message_text;
  end;
  perform set_config('pgtap.overlong_break', v_code, true);
end $$;

select ok(
  current_setting('pgtap.overlong_break') like 'ATTENDANCE: break%exceeds the shift itself%',
  'a break longer than the shift itself is rejected'
);

select ok(
  (select clock_out from attendance where id = current_setting('pgtap.attendance_id')::uuid) is null,
  'the rejected clock-out left the shift still open'
);

-- Real clock-out: ~2h shift, 30 min break -> 1.5h at Rs 1000/hour = Rs 1500.
do $$
begin
  perform clock_out(30);
end $$;

select ok(
  (select clock_out from attendance where id = current_setting('pgtap.attendance_id')::uuid) is not null,
  'clock-out with a valid break succeeds'
);

-- labour_cost_hourly_daily is owner-only (same gate as labour_cost_daily)
-- — switch back to the owner identity to read it.
select set_config('request.jwt.claim.sub', current_setting('pgtap.owner_user'), true);

select ok(
  (
    select labour_cost_paisa from labour_cost_hourly_daily
    where outlet_id = current_setting('pgtap.outlet')::uuid
      and business_date = current_setting('pgtap.today')::date
  ) = 150000,
  'labour_cost_hourly_daily computes ~1.5h at Rs 1000/hour = Rs 1500'
);

-- master-prompt §1: the EXISTING labour_cost_daily view must be
-- completely unaffected by any of this — it has no idea attendance
-- exists, and it should stay that way.
select ok(
  not exists (
    select 1 from information_schema.view_column_usage
    where view_name = 'labour_cost_daily' and table_name = 'attendance'
  ),
  'labour_cost_daily does not reference attendance at all — untouched'
);

-- Clocking back in for a second shift the same day must work (no
-- lingering "already clocked in" state from the closed shift).
select set_config('request.jwt.claim.sub', current_setting('pgtap.owner_user'), true);
select set_config('request.jwt.claim.sub', current_setting('pgtap.cashier_user'), true);
do $$
declare v_code text := 'none'; v_row attendance;
begin
  begin
    v_row := clock_in();
  exception when others then
    get stacked diagnostics v_code = message_text;
  end;
  perform set_config('pgtap.reclockin', v_code, true);
end $$;

select ok(
  current_setting('pgtap.reclockin') = 'none',
  'clocking in again after a closed shift succeeds — no lingering lock'
);

select * from finish();
rollback;

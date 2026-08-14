-- =====================================================================
-- Cup Shup POS — Patch 2: Staff Time Clock + Real Labour Cost %
-- =====================================================================
-- restaurant-system-master-prompt.md §6: Dashboard/Master P&L already
-- show "Labour cost %" (labour_cost_daily, 0028_reports_views.sql), but
-- that view sums only amortised monthly-SALARY expense entries — there
-- was never any clock-in/out data behind it for hourly-paid staff. This
-- adds that missing half additively; labour_cost_daily itself is not
-- touched, redefined, or reasoned about differently by anything here.
-- =====================================================================

-- Nullable — salaried staff (the ones labour_cost_daily already covers
-- via their monthly-salary expense entry) simply never set this and are
-- completely unaffected.
alter table staff add column hourly_rate_paisa bigint;

-- ---------------------------------------------------------------------
-- attendance — one row per clock-in. Keyed by business_date (via
-- business_date_of(), same derivation labour_cost_daily's own key
-- already uses) rather than a hard FK to an open business_days row —
-- staff clock in before a manager opens the register in real life, and
-- this table has no reason to block that.
-- ---------------------------------------------------------------------
create table attendance (
  id             uuid primary key default gen_random_uuid(),
  outlet_id      uuid not null references outlets(id) on delete cascade,
  staff_id       uuid not null references staff(id) on delete cascade,
  business_date  date not null,
  clock_in       timestamptz not null default now(),
  clock_out      timestamptz,
  break_minutes  int not null default 0 check (break_minutes >= 0),
  approved_by    uuid references staff(id),
  created_at     timestamptz not null default now()
);
create index on attendance (outlet_id, business_date);
create index on attendance (staff_id);
-- At most one OPEN shift per staff member at a time — the same
-- "exactly one live row" shape as menu_item_prices/house_accounts.
create unique index attendance_one_open_per_staff on attendance (staff_id) where clock_out is null;

alter table attendance enable row level security;
create policy read_attendance on attendance for select using (outlet_id = my_outlet());
-- Same defensive pattern as orders/payments/business_days (0005_rls.sql
-- "Lock down direct table writes that must go through RPCs") — every
-- write here goes through clock_in()/clock_out() below.
revoke insert, update, delete on attendance from anon, authenticated;

-- ---------------------------------------------------------------------
-- clock_in() — acts on current_staff() (their own already-authenticated
-- session), same trust level as open_shift()'s own self-service action.
-- No separate PIN re-entry: being logged in via PIN IS the
-- authentication this app already relies on everywhere else.
-- ---------------------------------------------------------------------
create or replace function clock_in()
returns attendance language plpgsql security definer set search_path = public as $$
declare v_staff staff; v_tz text; v_start_hour int; v_date date; v_row attendance;
begin
  select * into v_staff from current_staff();
  if v_staff is null then raise exception 'AUTH: not a staff member'; end if;

  if exists (select 1 from attendance where staff_id = v_staff.id and clock_out is null) then
    raise exception 'ATTENDANCE: already clocked in';
  end if;

  select timezone, day_start_hour into v_tz, v_start_hour from outlets where id = v_staff.outlet_id;
  v_date := business_date_of(now(), v_tz, v_start_hour);

  insert into attendance (outlet_id, staff_id, business_date)
  values (v_staff.outlet_id, v_staff.id, v_date)
  returning * into v_row;

  insert into audit_log (outlet_id, actor_id, action, entity_type, entity_id, after)
  values (v_staff.outlet_id, v_staff.id, 'clock_in', 'attendance', v_row.id, to_jsonb(v_row));

  return v_row;
end $$;
revoke all on function clock_in() from public;
grant execute on function clock_in() to authenticated;

-- ---------------------------------------------------------------------
-- clock_out() — closes the caller's own open attendance row.
-- break_minutes is validated against the ACTUAL worked duration here,
-- at the source, rather than only clamped later in the cost view — bad
-- data (a break longer than the shift itself) never gets written at all.
-- ---------------------------------------------------------------------
create or replace function clock_out(p_break_minutes int default 0)
returns attendance language plpgsql security definer set search_path = public as $$
declare v_staff staff; v_row attendance; v_worked_minutes numeric;
begin
  select * into v_staff from current_staff();
  if v_staff is null then raise exception 'AUTH: not a staff member'; end if;

  select * into v_row from attendance where staff_id = v_staff.id and clock_out is null for update;
  if v_row.id is null then raise exception 'ATTENDANCE: not clocked in'; end if;

  if p_break_minutes < 0 then raise exception 'ATTENDANCE: break minutes cannot be negative'; end if;

  v_worked_minutes := extract(epoch from (now() - v_row.clock_in)) / 60.0;
  if p_break_minutes > v_worked_minutes then
    raise exception 'ATTENDANCE: break (% min) exceeds the shift itself (% min)', p_break_minutes, round(v_worked_minutes);
  end if;

  update attendance set clock_out = now(), break_minutes = p_break_minutes
   where id = v_row.id returning * into v_row;

  insert into audit_log (outlet_id, actor_id, action, entity_type, entity_id, after)
  values (v_staff.outlet_id, v_staff.id, 'clock_out', 'attendance', v_row.id, to_jsonb(v_row));

  return v_row;
end $$;
revoke all on function clock_out(int) from public;
grant execute on function clock_out(int) to authenticated;

-- ---------------------------------------------------------------------
-- set_staff_hourly_rate() — owner/manager only, same role gate as
-- change_item_price()/upsert_house_account(). Direct table writes to
-- `staff` are already possible for an owner via 0005_rls.sql's
-- owner_manages_staff policy, but this goes through an RPC anyway for
-- the same reason change_item_price does: an audit_log entry, and a
-- manager (not just the owner) can use it.
-- ---------------------------------------------------------------------
create or replace function set_staff_hourly_rate(p_staff_id uuid, p_hourly_rate_paisa bigint)
returns void language plpgsql security definer set search_path = public as $$
declare v_actor staff;
begin
  select * into v_actor from current_staff();
  if v_actor is null or v_actor.role not in ('owner','manager') then
    raise exception 'PERM: only owner or manager can set hourly rates';
  end if;
  if p_hourly_rate_paisa is not null and p_hourly_rate_paisa < 0 then
    raise exception 'RATE: cannot be negative';
  end if;
  if not exists (select 1 from staff where id = p_staff_id and outlet_id = v_actor.outlet_id) then
    raise exception 'STAFF: not found';
  end if;

  update staff set hourly_rate_paisa = p_hourly_rate_paisa where id = p_staff_id;

  insert into audit_log (outlet_id, actor_id, action, entity_type, entity_id, after)
  values (v_actor.outlet_id, v_actor.id, 'hourly_rate_set', 'staff', p_staff_id,
          jsonb_build_object('hourly_rate_paisa', p_hourly_rate_paisa));
end $$;
revoke all on function set_staff_hourly_rate(uuid, bigint) from public;
grant execute on function set_staff_hourly_rate(uuid, bigint) to authenticated;

-- ---------------------------------------------------------------------
-- labour_cost_hourly_daily — parallel to labour_cost_daily (0028), same
-- owner-only gate, same (outlet_id, business_date) key shape so the two
-- can be summed client-side with a plain join-by-key, never merged into
-- one view (keeps each source independently inspectable/debuggable).
-- Only CLOSED shifts (clock_out is not null) count — an ongoing shift's
-- cost isn't known yet. greatest(...,0) guards the arithmetic itself
-- even though clock_out() already rejects an over-long break at the
-- source — defence in depth on a wage figure, not redundant caution.
--
-- has_role() is schema-qualified (public.has_role) below, deliberately —
-- pgTAP (0031_pgtap_extension.sql) installs its OWN has_role(name)/
-- has_role(name,text) into the extensions schema, which is also on the
-- default search_path. An unqualified has_role('owner') here resolves
-- ambiguously to pgTAP's version (which returns text, a TAP result
-- line, not boolean) instead of this app's public.has_role(staff_role[])
-- — confirmed the hard way: it fails CREATE VIEW itself with "argument
-- of AND must be type boolean, not type text." labour_cost_daily
-- (0028) never hit this only because it was created BEFORE 0031
-- installed pgTAP, so its function reference was already bound
-- unambiguously by the time the collision would have mattered.
-- ---------------------------------------------------------------------
create or replace view labour_cost_hourly_daily
with (security_invoker = true)
as
select
  a.outlet_id,
  a.business_date,
  coalesce(sum(
    round(
      greatest(extract(epoch from (a.clock_out - a.clock_in)) / 3600.0 - a.break_minutes / 60.0, 0)
      * s.hourly_rate_paisa
    )
  ), 0)::bigint as labour_cost_paisa
from attendance a
join staff s on s.id = a.staff_id
where a.clock_out is not null and s.hourly_rate_paisa is not null and public.has_role('owner')
group by a.outlet_id, a.business_date;

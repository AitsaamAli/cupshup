-- =====================================================================
-- Cup Shup POS — Identity & Auth Functions
-- Part 07.
--
-- This ALSO closes a gap flagged back in Part 04: current_staff(),
-- has_role(), and my_outlet() are the three helpers nearly every RLS
-- policy in 0003_rls.sql calls, but they hadn't been defined anywhere
-- in the migration set yet (they live in the project's full reference
-- 0002_functions.sql, alongside the order engine that's still Parts
-- 09/10/13's job). Part 07 is the first part that actually needs these
-- three to work end-to-end, so they're extracted here — same "subset,
-- zero forward dependency" pattern as 0002_tax_functions.sql and
-- 0002_business_date_function.sql. See supabase/migrations/README.md.
-- =====================================================================

create or replace function current_staff()
returns staff language sql stable security definer set search_path = public as $$
  select * from staff where user_id = auth.uid() and active limit 1;
$$;

create or replace function has_role(variadic roles staff_role[])
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from staff
    where user_id = auth.uid() and active and role = any(roles)
  );
$$;

create or replace function my_outlet()
returns uuid language sql stable security definer set search_path = public as $$
  select outlet_id from staff where user_id = auth.uid() and active limit 1;
$$;

-- ---------------------------------------------------------------------
-- STAFF PICKER — safe to call from a fully logged-out device: returns
-- only name + role, never a PIN hash or anything else sensitive. Scoped
-- by an explicit outlet_id argument (rather than my_outlet()) because at
-- this point in the flow there is no session yet to derive it from —
-- that's the whole point of this function.
-- ---------------------------------------------------------------------
create or replace function list_active_staff(p_outlet_id uuid)
returns table(id uuid, name text, role staff_role)
language sql stable security definer set search_path = public as $$
  select id, name, role from staff where outlet_id = p_outlet_id and active order by name;
$$;
revoke all on function list_active_staff(uuid) from public;
grant execute on function list_active_staff(uuid) to anon, authenticated;

-- ---------------------------------------------------------------------
-- PIN VERIFICATION — never compared on the client, ever. This is called
-- ONLY from the server-only route app/api/auth/pin/route.ts, using the
-- service_role key — which is why EXECUTE is revoked from anon and
-- authenticated and granted only to service_role. See docs/auth-design.md
-- for the full flow (PIN -> this function -> Admin API magic-link ->
-- browser exchanges it for that staff member's own real session).
-- ---------------------------------------------------------------------
create or replace function verify_staff_pin(p_staff_id uuid, p_pin text)
returns json language plpgsql security definer set search_path = public as $$
declare
  v staff;
  v_fail_count int;
begin
  select * into v from staff where id = p_staff_id and active;
  if v is null then
    raise exception 'AUTH: staff not found';
  end if;

  -- Rolling lockout: 5 failed attempts in the last 15 minutes blocks
  -- further tries. No separate lockout table/column needed — audit_log
  -- is already the append-only source of truth, and the lock naturally
  -- lifts once the 5th-most-recent failure ages out of the window.
  select count(*) into v_fail_count from audit_log
   where entity_type = 'staff' and entity_id = p_staff_id
     and action = 'pin_failed' and created_at > now() - interval '15 minutes';
  if v_fail_count >= 5 then
    raise exception 'AUTH: too many failed attempts — try again in 15 minutes';
  end if;

  if v.pin_hash is null or not (v.pin_hash = crypt(p_pin, v.pin_hash)) then
    insert into audit_log (outlet_id, actor_id, action, entity_type, entity_id)
    values (v.outlet_id, v.id, 'pin_failed', 'staff', v.id);
    raise exception 'AUTH: invalid PIN';
  end if;

  insert into audit_log (outlet_id, actor_id, action, entity_type, entity_id)
  values (v.outlet_id, v.id, 'pin_success', 'staff', v.id);

  return json_build_object(
    'staff_id', v.id, 'outlet_id', v.outlet_id,
    'name', v.name, 'role', v.role, 'user_id', v.user_id
  );
end $$;
revoke all on function verify_staff_pin(uuid, text) from public;
grant execute on function verify_staff_pin(uuid, text) to service_role;

-- ---------------------------------------------------------------------
-- SET / CHANGE A STAFF PIN — owner/manager only, called from an
-- already-authenticated real staff session (unlike verify_staff_pin,
-- which runs before any session exists).
-- ---------------------------------------------------------------------
create or replace function set_staff_pin(p_staff_id uuid, p_new_pin text)
returns void language plpgsql security definer set search_path = public as $$
declare v_actor staff;
begin
  select * into v_actor from current_staff();
  if v_actor is null or v_actor.role not in ('owner','manager') then
    raise exception 'PERM: only owner or manager can set a staff PIN';
  end if;

  if p_new_pin !~ '^[0-9]{4,6}$' then
    raise exception 'PIN: must be 4 to 6 digits';
  end if;

  if p_new_pin = any(array[
    '0000','1111','2222','3333','4444','5555','6666','7777','8888','9999',
    '1234','4321','0123','1212','2580','123456','654321','111111','000000'
  ]) then
    raise exception 'PIN: too easy to guess — choose another';
  end if;

  update staff set pin_hash = crypt(p_new_pin, gen_salt('bf'))
   where id = p_staff_id and outlet_id = v_actor.outlet_id;
  if not found then
    raise exception 'STAFF: not found in your outlet';
  end if;

  insert into audit_log (outlet_id, actor_id, action, entity_type, entity_id)
  values (v_actor.outlet_id, v_actor.id, 'pin_set', 'staff', p_staff_id);
end $$;
revoke all on function set_staff_pin(uuid, text) from public;
grant execute on function set_staff_pin(uuid, text) to authenticated;

-- ---------------------------------------------------------------------
-- LOGOUT AUDIT — the actual Supabase sign-out happens client-side
-- (supabase.auth.signOut()); this just records that it happened, since
-- every login/logout/failed-attempt must be traceable (Part 07).
-- ---------------------------------------------------------------------
create or replace function log_staff_logout()
returns void language plpgsql security definer set search_path = public as $$
declare v_staff staff;
begin
  select * into v_staff from current_staff();
  if v_staff is not null then
    insert into audit_log (outlet_id, actor_id, action, entity_type, entity_id)
    values (v_staff.outlet_id, v_staff.id, 'logout', 'staff', v_staff.id);
  end if;
end $$;
revoke all on function log_staff_logout() from public;
grant execute on function log_staff_logout() to authenticated;

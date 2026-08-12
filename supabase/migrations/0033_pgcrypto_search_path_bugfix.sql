-- =====================================================================
-- Cup Shup POS — a second real bug, found the same way as the first
-- (0032_idempotency_bugfix.sql): by actually running the app in a
-- browser and hitting it live, 2026-08-12.
--
-- verify_staff_pin() and set_staff_pin() (0002_auth_functions.sql) both
-- call crypt()/gen_salt() — but pgcrypto is installed in Supabase's own
-- `extensions` schema on this project (confirmed live:
-- pg_extension.extnamespace = 'extensions'), not `public`. 0001_schema.sql's
-- `create extension if not exists "pgcrypto"` was a silent no-op against
-- an extension the Supabase platform had already installed elsewhere —
-- it does not move an existing extension to a new schema.
--
-- Both functions declare `set search_path = public` (this project's
-- standing security convention, restricting a SECURITY DEFINER
-- function's search_path so it can't be hijacked by a same-named
-- function planted earlier in a caller-controlled path) — which meant
-- `crypt`/`gen_salt` were simply not found. Every PIN login has been
-- broken since Part 07; nothing in this build ever called
-- verify_staff_pin() through a real HTTP request until just now.
--
-- Fix: add `extensions` to these two functions' search_path
-- specifically — not a blanket change, and not moving pgcrypto itself
-- (Supabase manages that schema; this project doesn't own it).
-- =====================================================================

create or replace function verify_staff_pin(p_staff_id uuid, p_pin text)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare
  v staff;
  v_fail_count int;
begin
  select * into v from staff where id = p_staff_id and active;
  if v is null then
    raise exception 'AUTH: staff not found';
  end if;

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

create or replace function set_staff_pin(p_staff_id uuid, p_new_pin text)
returns void language plpgsql security definer set search_path = public, extensions as $$
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

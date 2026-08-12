-- =====================================================================
-- Cup Shup POS — pgTAP: cross-outlet write isolation (Case A)
--
-- Regression test for a CRITICAL bug found live 2026-08-13: every
-- SECURITY DEFINER RPC in the order/KDS/printing/business-day write
-- path checked WHO the caller is but never WHICH OUTLET the row they
-- were operating on belonged to. Fixed in
-- 0035_cross_outlet_isolation_fix.sql. This file expresses as much of
-- that live attack as a SINGLE Postgres session can (identity-switching
-- via set_config, the same technique rls.sql already uses) — the parts
-- that genuinely need two separate concurrent processes/sessions
-- (nothing here needs that; this whole class of bug is about identity
-- vs. row ownership, not timing) are fully covered. Same "executed
-- live against the real project" status as every other file in this
-- directory — see docs/testing-strategy.md §3.
--
-- Everything rolls back at the end — two throwaway outlets, two
-- throwaway staff/auth rows, one throwaway order.
-- =====================================================================

begin;
select plan(6);

do $$
declare
  v_outlet_a uuid; v_outlet_b uuid;
  v_owner_a_user uuid := gen_random_uuid();
  v_owner_b_user uuid := gen_random_uuid();
  v_owner_a_staff uuid;
  v_item uuid;
  v_day business_days;
  v_order orders;
  v_tz text; v_hour int; v_today date;
begin
  -- Outlet A = the project's real seeded outlet (reused, not created —
  -- this test only ever READS from it via a legitimate owner session,
  -- and writes exactly one throwaway order to it as outlet A's own
  -- rightful owner, which is not a violation of anything).
  select id, timezone, day_start_hour into v_outlet_a, v_tz, v_hour from outlets limit 1;
  v_today := business_date_of(now(), v_tz, v_hour);

  insert into auth.users (id) values (v_owner_a_user);
  insert into staff (user_id, outlet_id, code, name, role)
  values (v_owner_a_user, v_outlet_a, 'PGTAP-XO-A', 'pgTAP Outlet A Owner', 'owner')
  returning id into v_owner_a_staff;

  -- Outlet B = a genuinely separate, throwaway outlet with its own owner.
  insert into outlets (name, timezone, day_start_hour) values ('PGTAP-XO-OTHER', 'Asia/Karachi', 15)
  returning id into v_outlet_b;
  insert into auth.users (id) values (v_owner_b_user);
  insert into staff (user_id, outlet_id, code, name, role)
  values (v_owner_b_user, v_outlet_b, 'PGTAP-XO-B', 'pgTAP Outlet B Owner', 'owner');

  -- A real day + order in outlet A, created as outlet A's own owner —
  -- this is the row outlet B will attempt to attack.
  insert into business_days (outlet_id, business_date, status, opened_by)
  values (v_outlet_a, v_today, 'open', v_owner_a_staff)
  on conflict (outlet_id, business_date) do update set status = 'open'
  returning * into v_day;

  select mi.id into v_item
  from menu_items mi join menu_categories mc on mc.id = mi.category_id
  where mc.outlet_id = v_outlet_a and mi.active and not mi.is_86
  limit 1;

  perform set_config('pgtap.outlet_a', v_outlet_a::text, true);
  perform set_config('pgtap.outlet_b', v_outlet_b::text, true);
  perform set_config('pgtap.owner_a_user', v_owner_a_user::text, true);
  perform set_config('pgtap.owner_b_user', v_owner_b_user::text, true);
  perform set_config('pgtap.item', v_item::text, true);
end $$;

-- Act as outlet A's owner to create one real order to attack.
select set_config('request.jwt.claim.sub', current_setting('pgtap.owner_a_user'), true);
set local role authenticated;

do $$
declare v_result json;
begin
  v_result := place_order(
    current_setting('pgtap.outlet_a')::uuid, 'dine_in',
    jsonb_build_array(jsonb_build_object('menu_item_id', current_setting('pgtap.item'), 'qty', 1)),
    'pgtap-xo-target-' || clock_timestamp()::text
  );
  perform set_config('pgtap.target_order', (v_result->'order'->>'id'), true);
end $$;

-- Now switch identity to OUTLET B's owner — everything below is an attack.
select set_config('request.jwt.claim.sub', current_setting('pgtap.owner_b_user'), true);

select ok(
  (select count(*) from orders where id = current_setting('pgtap.target_order')::uuid) = 0,
  'outlet B session: cannot SELECT outlet A''s order at all (RLS)'
);

do $$
declare v_code text := 'none'; v_result json;
begin
  begin
    v_result := place_order(
      current_setting('pgtap.outlet_a')::uuid, 'dine_in',
      jsonb_build_array(jsonb_build_object('menu_item_id', current_setting('pgtap.item'), 'qty', 1)),
      'pgtap-xo-attack-' || clock_timestamp()::text
    );
  exception when others then
    get stacked diagnostics v_code = message_text;
  end;
  perform set_config('pgtap.attack1', v_code, true);
end $$;
select ok(
  current_setting('pgtap.attack1') like 'AUTH:%',
  'outlet B owner: place_order spoofing outlet A''s id is rejected'
);

do $$
declare v_code text := 'none';
begin
  begin
    perform void_order(current_setting('pgtap.target_order')::uuid, 'customer_cancel');
  exception when others then
    get stacked diagnostics v_code = message_text;
  end;
  perform set_config('pgtap.attack2', v_code, true);
end $$;
select ok(
  current_setting('pgtap.attack2') like 'ORDER:%',
  'outlet B owner: void_order against outlet A''s real order id is rejected'
);

do $$
declare v_code text := 'none';
begin
  begin
    perform advance_order_status(current_setting('pgtap.target_order')::uuid, 'ready');
  exception when others then
    get stacked diagnostics v_code = message_text;
  end;
  perform set_config('pgtap.attack3', v_code, true);
end $$;
select ok(
  current_setting('pgtap.attack3') like 'ORDER:%',
  'outlet B owner: advance_order_status against outlet A''s order is rejected'
);

do $$
declare v_code text := 'none';
begin
  begin
    perform add_items_to_order(
      current_setting('pgtap.target_order')::uuid,
      jsonb_build_array(jsonb_build_object('menu_item_id', current_setting('pgtap.item'), 'qty', 1))
    );
  exception when others then
    get stacked diagnostics v_code = message_text;
  end;
  perform set_config('pgtap.attack4', v_code, true);
end $$;
select ok(
  current_setting('pgtap.attack4') like 'ORDER:%',
  'outlet B owner: add_items_to_order against outlet A''s order is rejected'
);

do $$
declare v_code text := 'none';
begin
  begin
    perform settle_order(
      current_setting('pgtap.target_order')::uuid,
      jsonb_build_array(jsonb_build_object('method', 'cash', 'base_paisa', 1)),
      0, 0, 0
    );
  exception when others then
    get stacked diagnostics v_code = message_text;
  end;
  perform set_config('pgtap.attack5', v_code, true);
end $$;
select ok(
  current_setting('pgtap.attack5') like 'ORDER:%',
  'outlet B owner: settle_order against outlet A''s order is rejected'
);

select * from finish();
rollback;

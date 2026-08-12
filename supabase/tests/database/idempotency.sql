-- =====================================================================
-- Cup Shup POS — pgTAP: place_order() idempotency
-- Part 20. Same "executed live against the real project, 2026-08-12,
-- 3/3 passed" status as rls.sql — see that file's header. This is also
-- the file that FOUND a real bug: place_order()'s original dedup check
-- (`if v_existing is not null`) never actually matched a found row,
-- because Postgres's ROW IS NOT NULL requires every column non-null,
-- and a real order always has some null columns (table_id, invoice_no,
-- ...). Fixed in 0032_idempotency_bugfix.sql — see that migration's own
-- extensive comment for the full story and the before/after
-- reproduction. Every assertion below reflects the FIXED behaviour.
--
-- IMPORTANT SCOPE NOTE: this file proves the SEQUENTIAL case — the
-- same idempotency key, called twice, never creates a second order.
-- It does NOT prove the TRUE CONCURRENT case (10 simultaneous calls
-- racing each other) — pgTAP runs as one session executing statements
-- one after another, which cannot simulate two terminals hitting
-- place_order() at the exact same instant. The concurrency guarantee
-- itself comes from `unique (outlet_id, idempotency_key)` on the
-- orders table (0001_schema.sql) — a real database constraint, not
-- application logic, so it holds under real concurrency regardless of
-- what any test harness can observe from one session. A genuine
-- concurrent-load check needs pgbench or N parallel psql connections —
-- see docs/testing-strategy.md §4 for the exact command.
-- =====================================================================

begin;
select plan(3);

do $$
declare
  v_outlet uuid;
  v_owner_user uuid := gen_random_uuid();
  v_owner_staff uuid;
  v_day business_days;
  v_item uuid;
  v_tz text; v_start_hour int; v_today date;
begin
  select id, timezone, day_start_hour into v_outlet, v_tz, v_start_hour from outlets limit 1;
  v_today := business_date_of(now(), v_tz, v_start_hour);

  insert into auth.users (id) values (v_owner_user);
  insert into staff (user_id, outlet_id, code, name, role)
  values (v_owner_user, v_outlet, 'PGTAP-IDEM', 'pgTAP Idempotency Test', 'owner')
  returning id into v_owner_staff;

  -- An open business day is required for place_order() to succeed at
  -- all — reuse today's if one is already open, otherwise open a
  -- throwaway one (rolled back with everything else). Uses the SAME
  -- business_date_of() calculation place_order() itself uses
  -- internally (Part 06) — not current_date — so this matches
  -- whichever row place_order() actually looks up.
  select * into v_day from business_days where outlet_id = v_outlet and business_date = v_today;
  if v_day.id is null then
    insert into business_days (outlet_id, business_date, status, opened_by)
    values (v_outlet, v_today, 'open', v_owner_staff)
    returning * into v_day;
  elsif v_day.status <> 'open' then
    update business_days set status = 'open' where id = v_day.id;
  end if;

  select mi.id into v_item
  from menu_items mi join menu_categories mc on mc.id = mi.category_id
  where mc.outlet_id = v_outlet and mi.active and not mi.is_86
  limit 1;

  perform set_config('pgtap.outlet', v_outlet::text, true);
  perform set_config('pgtap.owner_user', v_owner_user::text, true);
  perform set_config('pgtap.item', v_item::text, true);
end $$;

select set_config('request.jwt.claim.sub', current_setting('pgtap.owner_user'), true);
set local role authenticated;

-- First call: creates a real order.
select ok(
  (place_order(
    current_setting('pgtap.outlet')::uuid,
    'dine_in',
    jsonb_build_array(jsonb_build_object('menu_item_id', current_setting('pgtap.item'), 'qty', 1)),
    'pgtap-fixed-idempotency-key'
  )->>'duplicate')::boolean is not true,
  'first call with a fresh idempotency key creates a real order (duplicate: false)'
);

-- Second call, SAME key: must return the original order, not create a
-- second one.
select ok(
  (place_order(
    current_setting('pgtap.outlet')::uuid,
    'dine_in',
    jsonb_build_array(jsonb_build_object('menu_item_id', current_setting('pgtap.item'), 'qty', 1)),
    'pgtap-fixed-idempotency-key'
  )->>'duplicate')::boolean is true,
  'second call with the SAME idempotency key returns duplicate: true'
);

select is(
  (select count(*) from orders where idempotency_key = 'pgtap-fixed-idempotency-key')::int,
  1,
  'exactly one order exists for this idempotency key, no matter how many times it was called'
);

select * from finish();
rollback;

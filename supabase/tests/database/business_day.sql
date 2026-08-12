-- =====================================================================
-- Cup Shup POS — pgTAP: closed-day order blocking
-- Part 20. Same "executed live against the real project, 2026-08-12,
-- 2/2 passed" status as rls.sql.
--
-- place_order() derives the business date itself from now() and the
-- outlet's own timezone (business_date_of(), Part 06) — it never
-- trusts a date the caller supplies. So testing "closed day blocks
-- orders" means acting on TODAY's real row, not a fabricated one:
-- whatever business_days row already exists for today (open or not)
-- gets flipped to 'closed' for the duration of this transaction, the
-- attempt is made, and the whole thing rolls back afterward — the
-- live project's real open day (if any) is restored exactly as it was,
-- untouched outside this transaction.
-- =====================================================================

begin;
select plan(2);

do $$
declare
  v_outlet uuid;
  v_owner_user uuid := gen_random_uuid();
  v_owner_staff uuid;
  v_item uuid;
  v_tz text; v_start_hour int; v_today date;
begin
  select id, timezone, day_start_hour into v_outlet, v_tz, v_start_hour from outlets limit 1;
  v_today := business_date_of(now(), v_tz, v_start_hour);

  insert into auth.users (id) values (v_owner_user);
  insert into staff (user_id, outlet_id, code, name, role)
  values (v_owner_user, v_outlet, 'PGTAP-DAY', 'pgTAP Business Day Test', 'owner')
  returning id into v_owner_staff;

  -- Ensure a row for today exists, then force it closed — whether it
  -- was already open (the normal live-project case) or missing
  -- entirely (a fresh project with no day opened yet).
  insert into business_days (outlet_id, business_date, status, opened_by)
  values (v_outlet, v_today, 'closed', v_owner_staff)
  on conflict (outlet_id, business_date) do update set status = 'closed';

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

select throws_like(
  $$ select place_order(
       current_setting('pgtap.outlet')::uuid, 'dine_in',
       jsonb_build_array(jsonb_build_object('menu_item_id', current_setting('pgtap.item'), 'qty', 1)),
       'pgtap-closed-day-key'
     ) $$,
  'DAY:%',
  'place_order() raises a DAY: error when today''s business day is closed'
);

select is(
  (select count(*) from orders where idempotency_key = 'pgtap-closed-day-key')::int,
  0,
  'no order was created by the rejected attempt'
);

select * from finish();
rollback;

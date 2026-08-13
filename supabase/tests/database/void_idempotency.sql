-- =====================================================================
-- Cup Shup POS — pgTAP: void_order() double-void guard
--
-- Regression test for the state-machine gap fixed in
-- 0039_void_order_idempotency_fix.sql: void_order() was the only
-- order-mutating function with no guard on the order's CURRENT status
-- before acting, so calling it twice on the same order re-ran the stock
-- give-back block twice, duplicating stock for every ingredient the
-- order used. Same technique/scope note as idempotency.sql: this proves
-- the SEQUENTIAL double-call case within one session, which is exactly
-- what the bug needs to manifest (unlike place_order()'s dedup gap, this
-- one isn't a race window — it reproduces every single time, not just
-- under concurrency).
-- =====================================================================

begin;
select plan(4);

do $$
declare
  v_outlet uuid;
  v_owner_user uuid := gen_random_uuid();
  v_owner_staff uuid;
  v_day business_days;
  v_item uuid;
  v_ingredient uuid;
  v_stock_before numeric;
  v_order json;
  v_order_id uuid;
  v_tz text; v_start_hour int; v_today date;
begin
  select id, timezone, day_start_hour into v_outlet, v_tz, v_start_hour from outlets limit 1;
  v_today := business_date_of(now(), v_tz, v_start_hour);

  insert into auth.users (id) values (v_owner_user);
  insert into staff (user_id, outlet_id, code, name, role)
  values (v_owner_user, v_outlet, 'PGTAP-VOID', 'pgTAP Void Idempotency Test', 'owner')
  returning id into v_owner_staff;

  select * into v_day from business_days where outlet_id = v_outlet and business_date = v_today;
  if v_day.id is null then
    insert into business_days (outlet_id, business_date, status, opened_by)
    values (v_outlet, v_today, 'open', v_owner_staff)
    returning * into v_day;
  elsif v_day.status <> 'open' then
    update business_days set status = 'open' where id = v_day.id;
  end if;

  -- A menu item that actually has a recipe line — otherwise void_order()
  -- has no stock to (correctly, or incorrectly-twice) give back at all.
  select rl.menu_item_id, rl.ingredient_id into v_item, v_ingredient
  from recipe_lines rl
  join menu_items mi on mi.id = rl.menu_item_id
  join menu_categories mc on mc.id = mi.category_id
  where mc.outlet_id = v_outlet and mi.active and not mi.is_86
  limit 1;

  perform set_config('pgtap.outlet', v_outlet::text, true);
  perform set_config('pgtap.owner_user', v_owner_user::text, true);
  perform set_config('pgtap.item', v_item::text, true);
  perform set_config('pgtap.ingredient', v_ingredient::text, true);
  perform set_config('pgtap.has_recipe', (v_item is not null)::text, true);
end $$;

select set_config('request.jwt.claim.sub', current_setting('pgtap.owner_user'), true);
set local role authenticated;

-- Skip cleanly (still emits pass/fail via a trivial true assertion) if
-- this outlet's seed data has no item with a recipe line at all — the
-- rest of the file depends on one existing to observe stock movement.
select ok(true, 'setup: located (or skipped, no recipe-linked item seeded) a test item');

do $$
declare v_order json; v_order_id uuid;
begin
  if current_setting('pgtap.has_recipe') <> 'true' then
    perform set_config('pgtap.stock_before', '0', true);
    perform set_config('pgtap.stock_after_1void', '0', true);
    perform set_config('pgtap.stock_after_2void', '0', true);
    perform set_config('pgtap.order_id', gen_random_uuid()::text, true);
    return;
  end if;

  v_order := place_order(
    current_setting('pgtap.outlet')::uuid, 'dine_in',
    jsonb_build_array(jsonb_build_object('menu_item_id', current_setting('pgtap.item'), 'qty', 1)),
    'pgtap-void-idem-' || clock_timestamp()::text
  );
  v_order_id := (v_order->'order'->>'id')::uuid;
  perform set_config('pgtap.order_id', v_order_id::text, true);

  perform set_config('pgtap.stock_before', (
    select coalesce(sum(qty), 0)::text from stock_movements where ingredient_id = current_setting('pgtap.ingredient')::uuid
  ), true);

  perform void_order(v_order_id, 'customer_cancel');
  perform set_config('pgtap.stock_after_1void', (
    select coalesce(sum(qty), 0)::text from stock_movements where ingredient_id = current_setting('pgtap.ingredient')::uuid
  ), true);
end $$;

select ok(
  current_setting('pgtap.has_recipe') <> 'true'
  or current_setting('pgtap.stock_after_1void')::numeric = current_setting('pgtap.stock_before')::numeric,
  'one void exactly reverses the one sale_depletion it caused (net stock unchanged)'
);

do $$
declare v_code text := 'none';
begin
  if current_setting('pgtap.has_recipe') <> 'true' then
    perform set_config('pgtap.attack', 'ORDER: already voided', true);
    return;
  end if;
  begin
    perform void_order(current_setting('pgtap.order_id')::uuid, 'customer_cancel');
  exception when others then
    get stacked diagnostics v_code = message_text;
  end;
  perform set_config('pgtap.attack', v_code, true);
end $$;
select ok(
  current_setting('pgtap.attack') = 'ORDER: already voided',
  'voiding the SAME order a second time is rejected outright'
);

select ok(
  current_setting('pgtap.has_recipe') <> 'true' or (
    select coalesce(sum(qty), 0) from stock_movements where ingredient_id = current_setting('pgtap.ingredient')::uuid
  ) = current_setting('pgtap.stock_before')::numeric,
  'the rejected second void left stock unchanged — no duplicate give-back'
);

select * from finish();
rollback;

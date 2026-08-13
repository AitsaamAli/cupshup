-- =====================================================================
-- Cup Shup POS — pgTAP: order-type pricing
--
-- Regression test for 0044_order_type_pricing.sql (Part 22 §1). Covers
-- the doc's own named acceptance tests — delivery order gets the
-- delivery price, dine-in gets default, an order_type with no override
-- falls back to default — plus the one real regression this same
-- migration had to guard against: changing an item's default price
-- must NOT silently wipe out its order-type overrides.
--
-- Same technique as settled_void_reconciliation.sql / void_idempotency.sql:
-- one throwaway owner + cashier identity, identity-switched via
-- set_config within one rolled-back transaction.
-- =====================================================================

begin;
select plan(8);

do $$
declare
  v_outlet uuid;
  v_owner_user uuid := gen_random_uuid();
  v_cashier_user uuid := gen_random_uuid();
  v_owner_staff uuid;
  v_cashier_staff uuid;
  v_day business_days;
  v_item uuid;
  v_tz text; v_start_hour int; v_today date;
begin
  select id, timezone, day_start_hour into v_outlet, v_tz, v_start_hour from outlets limit 1;
  v_today := business_date_of(now(), v_tz, v_start_hour);

  insert into auth.users (id) values (v_owner_user);
  insert into staff (user_id, outlet_id, code, name, role)
  values (v_owner_user, v_outlet, 'PGTAP-OTP-OWN', 'pgTAP OrderTypePricing Owner', 'owner')
  returning id into v_owner_staff;

  insert into auth.users (id) values (v_cashier_user);
  insert into staff (user_id, outlet_id, code, name, role)
  values (v_cashier_user, v_outlet, 'PGTAP-OTP-CSH', 'pgTAP OrderTypePricing Cashier', 'cashier')
  returning id into v_cashier_staff;

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
  perform set_config('pgtap.cashier_user', v_cashier_user::text, true);
  perform set_config('pgtap.item', v_item::text, true);
end $$;

select set_config('request.jwt.claim.sub', current_setting('pgtap.owner_user'), true);
set local role authenticated;

-- Fix the item's default price at a known value, then set a delivery
-- override at a different one.
do $$
begin
  perform change_item_price(current_setting('pgtap.item')::uuid, 50000);
  perform set_item_order_type_price(current_setting('pgtap.item')::uuid, 'delivery', 65000);
end $$;

select ok(
  current_price_paisa(current_setting('pgtap.item')::uuid, current_date, 'dine_in') = 50000,
  'dine_in (no override) reads the default price'
);

select ok(
  current_price_paisa(current_setting('pgtap.item')::uuid, current_date, 'delivery') = 65000,
  'delivery (has an override) reads the override price, not the default'
);

select ok(
  current_price_paisa(current_setting('pgtap.item')::uuid, current_date, 'takeaway') = 50000,
  'takeaway (no override set for it) falls back to the default price'
);

-- A cashier attempting to set an order-type override must be rejected —
-- same owner/manager-only gate as change_item_price().
select set_config('request.jwt.claim.sub', current_setting('pgtap.cashier_user'), true);

do $$
declare v_code text := 'none';
begin
  begin
    perform set_item_order_type_price(current_setting('pgtap.item')::uuid, 'takeaway', 1);
  exception when others then
    get stacked diagnostics v_code = message_text;
  end;
  perform set_config('pgtap.cashier_attack', v_code, true);
end $$;

select ok(
  current_setting('pgtap.cashier_attack') = 'PERM: only owner or manager can change prices',
  'a cashier cannot set an order-type override price — owner/manager only'
);

select set_config('request.jwt.claim.sub', current_setting('pgtap.owner_user'), true);

-- The real regression: changing the DEFAULT price must not close out the
-- delivery override that's still supposed to be live.
do $$
begin
  perform change_item_price(current_setting('pgtap.item')::uuid, 55000);
end $$;

select ok(
  current_price_paisa(current_setting('pgtap.item')::uuid, current_date, 'dine_in') = 55000,
  'changing the default price updates dine_in as expected'
);

select ok(
  current_price_paisa(current_setting('pgtap.item')::uuid, current_date, 'delivery') = 65000,
  'the delivery override survives a default-price change — not silently closed out'
);

-- Placing actual orders end to end: a delivery order is charged the
-- override, a dine_in order the default, in the same business day.
do $$
declare
  v_delivery_order json; v_dine_order json;
  v_delivery_id uuid; v_dine_id uuid;
begin
  v_delivery_order := place_order(
    current_setting('pgtap.outlet')::uuid, 'delivery',
    jsonb_build_array(jsonb_build_object('menu_item_id', current_setting('pgtap.item'), 'qty', 1)),
    'pgtap-otp-delivery-' || clock_timestamp()::text
  );
  v_delivery_id := (v_delivery_order->'order'->>'id')::uuid;

  v_dine_order := place_order(
    current_setting('pgtap.outlet')::uuid, 'dine_in',
    jsonb_build_array(jsonb_build_object('menu_item_id', current_setting('pgtap.item'), 'qty', 1)),
    'pgtap-otp-dinein-' || clock_timestamp()::text
  );
  v_dine_id := (v_dine_order->'order'->>'id')::uuid;

  perform set_config('pgtap.delivery_order', v_delivery_id::text, true);
  perform set_config('pgtap.dine_order', v_dine_id::text, true);
end $$;

select ok(
  (select unit_price_paisa from order_items where order_id = current_setting('pgtap.delivery_order')::uuid) = 65000,
  'a real delivery order is actually charged the delivery override price'
);

select ok(
  (select unit_price_paisa from order_items where order_id = current_setting('pgtap.dine_order')::uuid) = 55000,
  'a real dine_in order in the same business day is charged the (updated) default price'
);

select * from finish();
rollback;

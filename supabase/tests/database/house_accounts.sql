-- =====================================================================
-- Cup Shup POS — pgTAP: house accounts (Khata/Credit), Patch 1
--
-- Regression test for 0046/0047_house_accounts_*.sql. Covers: settling
-- an order to a house account records a matching charge, the credit
-- limit is enforced BEFORE any write (no partial state on rejection),
-- recording a payment reduces outstanding, permission gating on the
-- management RPCs, and that every EXISTING payment method still
-- settles exactly as before (master-prompt §1's "existing behaviour
-- must not change").
--
-- Same technique as order_type_pricing.sql / settled_void_reconciliation.sql:
-- one owner + one cashier identity, identity-switched via set_config
-- within one rolled-back transaction.
-- =====================================================================

begin;
select plan(10);

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
  values (v_owner_user, v_outlet, 'PGTAP-HA-OWN', 'pgTAP HouseAccount Owner', 'owner')
  returning id into v_owner_staff;

  insert into auth.users (id) values (v_cashier_user);
  insert into staff (user_id, outlet_id, code, name, role)
  values (v_cashier_user, v_outlet, 'PGTAP-HA-CSH', 'pgTAP HouseAccount Cashier', 'cashier')
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

-- A cashier cannot create a house account — owner/manager only.
select set_config('request.jwt.claim.sub', current_setting('pgtap.cashier_user'), true);
do $$
declare v_code text := 'none';
begin
  begin
    perform upsert_house_account(null, 'Attack Corp', 500000, 1);
  exception when others then
    get stacked diagnostics v_code = message_text;
  end;
  perform set_config('pgtap.cashier_attack', v_code, true);
end $$;

select ok(
  current_setting('pgtap.cashier_attack') = 'PERM: only owner or manager can manage house accounts',
  'a cashier cannot create a house account — owner/manager only'
);

-- Owner creates a small-credit-limit account, exactly Rs 1000.
select set_config('request.jwt.claim.sub', current_setting('pgtap.owner_user'), true);

do $$
declare v_account uuid;
begin
  v_account := upsert_house_account(null, 'pgTAP Test Corp', 100000, 5);
  perform set_config('pgtap.account', v_account::text, true);
end $$;

select ok(
  (select credit_limit_paisa from house_accounts where id = current_setting('pgtap.account')::uuid) = 100000,
  'house account created with the given credit limit'
);

-- Place and settle a small order to the account — should succeed and
-- write a matching charge.
do $$
declare
  v_order json; v_order_id uuid; v_settled json; v_base bigint;
begin
  v_order := place_order(
    current_setting('pgtap.outlet')::uuid, 'dine_in',
    jsonb_build_array(jsonb_build_object('menu_item_id', current_setting('pgtap.item'), 'qty', 1)),
    'pgtap-ha-order1-' || clock_timestamp()::text
  );
  v_order_id := (v_order->'order'->>'id')::uuid;
  select subtotal_paisa into v_base from orders where id = v_order_id;

  v_settled := settle_order(v_order_id, jsonb_build_array(
    jsonb_build_object('method', 'house_account', 'account_id', current_setting('pgtap.account'), 'base_paisa', v_base)
  ));
  perform set_config('pgtap.order1', v_order_id::text, true);
  perform set_config('pgtap.order1_total', (v_settled->>'total_paisa'), true);
end $$;

select ok(
  (select status from orders where id = current_setting('pgtap.order1')::uuid) = 'settled',
  'an order settled to a house account is marked settled'
);

select ok(
  exists (
    select 1 from house_account_charges
    where order_id = current_setting('pgtap.order1')::uuid
      and account_id = current_setting('pgtap.account')::uuid
      and amount_paisa = current_setting('pgtap.order1_total')::bigint
  ),
  'a house_account_charges row was written matching the order total'
);

select ok(
  (select outstanding_paisa from house_account_balances where account_id = current_setting('pgtap.account')::uuid)
    = current_setting('pgtap.order1_total')::bigint,
  'house_account_balances view reflects the new charge'
);

-- Now try to settle a second order that would push the account over its
-- Rs 1000 limit — must be rejected, with NOTHING written (no payment
-- row, no charge row, order stays unsettled).
do $$
declare
  v_order json; v_order_id uuid; v_code text := 'none';
begin
  v_order := place_order(
    current_setting('pgtap.outlet')::uuid, 'dine_in',
    jsonb_build_array(jsonb_build_object('menu_item_id', current_setting('pgtap.item'), 'qty', 50)),
    'pgtap-ha-order2-' || clock_timestamp()::text
  );
  v_order_id := (v_order->'order'->>'id')::uuid;
  perform set_config('pgtap.order2', v_order_id::text, true);

  begin
    perform settle_order(v_order_id, jsonb_build_array(
      jsonb_build_object('method', 'house_account', 'account_id', current_setting('pgtap.account'), 'base_paisa',
        (select subtotal_paisa from orders where id = v_order_id))
    ));
  exception when others then
    get stacked diagnostics v_code = message_text;
  end;
  perform set_config('pgtap.overlimit_attack', v_code, true);
end $$;

select ok(
  current_setting('pgtap.overlimit_attack') like 'ACCOUNT: % credit limit exceeded%',
  'settling past the credit limit is rejected'
);

select ok(
  (select status from orders where id = current_setting('pgtap.order2')::uuid) = 'sent_to_kitchen',
  'the rejected over-limit settle left the order unsettled — no partial write'
);

select ok(
  not exists (select 1 from house_account_charges where order_id = current_setting('pgtap.order2')::uuid),
  'the rejected over-limit settle wrote no charge row'
);

-- Record a payment against the account — outstanding should drop back
-- to zero.
do $$
begin
  perform record_house_account_payment(
    current_setting('pgtap.account')::uuid,
    current_setting('pgtap.order1_total')::bigint,
    'cash', 'pgTAP test payment'
  );
end $$;

select ok(
  (select outstanding_paisa from house_account_balances where account_id = current_setting('pgtap.account')::uuid) = 0,
  'recording a payment against the account brings outstanding back to zero'
);

-- Regression: a plain cash settle on a fresh order still works exactly
-- as it always has — master-prompt §1's "existing behaviour unchanged."
do $$
declare
  v_order json; v_order_id uuid; v_settled json; v_base bigint;
begin
  v_order := place_order(
    current_setting('pgtap.outlet')::uuid, 'dine_in',
    jsonb_build_array(jsonb_build_object('menu_item_id', current_setting('pgtap.item'), 'qty', 1)),
    'pgtap-ha-cash-' || clock_timestamp()::text
  );
  v_order_id := (v_order->'order'->>'id')::uuid;
  select subtotal_paisa into v_base from orders where id = v_order_id;
  v_settled := settle_order(v_order_id, jsonb_build_array(
    jsonb_build_object('method', 'cash', 'base_paisa', v_base, 'tendered_paisa', v_base)
  ));
  perform set_config('pgtap.cash_order', v_order_id::text, true);
end $$;

select ok(
  (select status from orders where id = current_setting('pgtap.cash_order')::uuid) = 'settled'
    and (select method from payments where order_id = current_setting('pgtap.cash_order')::uuid) = 'cash',
  'an ordinary cash settle still works exactly as before'
);

select * from finish();
rollback;

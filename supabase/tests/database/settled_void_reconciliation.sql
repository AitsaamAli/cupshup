-- =====================================================================
-- Cup Shup POS — pgTAP: settled-order void access control + reversal row
--
-- Regression test for 0043_settled_void_reconciliation.sql. Covers the
-- exact attack the code audit (2026-08-13) and
-- docs/security-audit-2026-08-14-second-wave.md both flagged: a manager
-- (not just a cashier — the role check is the point) voiding an
-- already-SETTLED order to make its cash silently drop out of
-- close_business_day/close_shift's cash_sales sum.
--
-- Same technique as void_idempotency.sql / second_wave_cross_outlet.sql:
-- one throwaway outlet, an owner AND a manager identity, identity-
-- switched via set_config within one rolled-back transaction.
-- =====================================================================

begin;
select plan(7);

do $$
declare
  v_outlet uuid;
  v_owner_user uuid := gen_random_uuid();
  v_manager_user uuid := gen_random_uuid();
  v_owner_staff uuid;
  v_manager_staff uuid;
  v_day business_days;
  v_item uuid;
  v_tz text; v_start_hour int; v_today date;
begin
  select id, timezone, day_start_hour into v_outlet, v_tz, v_start_hour from outlets limit 1;
  v_today := business_date_of(now(), v_tz, v_start_hour);

  insert into auth.users (id) values (v_owner_user);
  insert into staff (user_id, outlet_id, code, name, role)
  values (v_owner_user, v_outlet, 'PGTAP-SV-OWN', 'pgTAP SettledVoid Owner', 'owner')
  returning id into v_owner_staff;

  insert into auth.users (id) values (v_manager_user);
  insert into staff (user_id, outlet_id, code, name, role)
  values (v_manager_user, v_outlet, 'PGTAP-SV-MGR', 'pgTAP SettledVoid Manager', 'manager')
  returning id into v_manager_staff;

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
  perform set_config('pgtap.manager_user', v_manager_user::text, true);
  perform set_config('pgtap.item', v_item::text, true);
end $$;

select set_config('request.jwt.claim.sub', current_setting('pgtap.owner_user'), true);
set local role authenticated;

-- Place + settle an order as the owner, one cash payment. Then flip to
-- the MANAGER identity and attempt to void it.
do $$
declare
  v_order json; v_order_id uuid; v_settled json;
  v_base bigint; v_pay_id uuid;
begin
  v_order := place_order(
    current_setting('pgtap.outlet')::uuid, 'dine_in',
    jsonb_build_array(jsonb_build_object('menu_item_id', current_setting('pgtap.item'), 'qty', 1)),
    'pgtap-settled-void-' || clock_timestamp()::text
  );
  v_order_id := (v_order->'order'->>'id')::uuid;
  perform set_config('pgtap.order_id', v_order_id::text, true);

  select subtotal_paisa into v_base from orders where id = v_order_id;
  v_settled := settle_order(v_order_id, jsonb_build_array(
    jsonb_build_object('method', 'cash', 'base_paisa', v_base, 'tendered_paisa', v_base)
  ));

  select id into v_pay_id from payments where order_id = v_order_id and reverses_payment_id is null;
  perform set_config('pgtap.payment_id', v_pay_id::text, true);
end $$;

select ok(
  (select status from orders where id = current_setting('pgtap.order_id')::uuid) = 'settled',
  'setup: order is settled with exactly one cash payment before any void attempt'
);

-- Switch to the MANAGER identity and attack: void the settled order.
select set_config('request.jwt.claim.sub', current_setting('pgtap.manager_user'), true);

do $$
declare v_code text := 'none';
begin
  begin
    perform void_order(current_setting('pgtap.order_id')::uuid, 'customer_cancel');
  exception when others then
    get stacked diagnostics v_code = message_text;
  end;
  perform set_config('pgtap.manager_attack', v_code, true);
end $$;

select ok(
  current_setting('pgtap.manager_attack') = 'PERM: voiding a settled order requires the owner',
  'a MANAGER voiding an already-settled order is rejected — owner-only'
);

select ok(
  (select status from orders where id = current_setting('pgtap.order_id')::uuid) = 'settled',
  'the rejected manager void left the order untouched — still settled'
);

select ok(
  (select count(*) from payments where order_id = current_setting('pgtap.order_id')::uuid) = 1,
  'the rejected manager void created no reversal payment row'
);

-- Now the OWNER voids the same settled order — this must succeed and
-- must write a mirrored negative reversal row.
select set_config('request.jwt.claim.sub', current_setting('pgtap.owner_user'), true);

do $$
begin
  perform void_order(current_setting('pgtap.order_id')::uuid, 'customer_cancel');
end $$;

select ok(
  (select status from orders where id = current_setting('pgtap.order_id')::uuid) = 'voided',
  'the OWNER voiding the same settled order succeeds'
);

select ok(
  exists (
    select 1 from payments
    where reverses_payment_id = current_setting('pgtap.payment_id')::uuid
      and order_id = current_setting('pgtap.order_id')::uuid
  ),
  'a reversal payments row linked to the original via reverses_payment_id was written'
);

select ok(
  (
    select p_rev.base_paisa = -p_orig.base_paisa
       and p_rev.tax_paisa  = -p_orig.tax_paisa
       and p_rev.amount_paisa = -p_orig.amount_paisa
       and p_rev.method = p_orig.method
    from payments p_orig
    join payments p_rev on p_rev.reverses_payment_id = p_orig.id
    where p_orig.id = current_setting('pgtap.payment_id')::uuid
  ),
  'the reversal row exactly mirrors the original payment, negated, same method'
);

select * from finish();
rollback;

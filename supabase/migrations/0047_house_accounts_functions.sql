-- =====================================================================
-- Cup Shup POS — Patch 1: Khata/Credit (House Accounts) — functions
-- =====================================================================
-- Second half of Patch 1 (0046 = schema). house_account is now a valid
-- payment_method value; this migration is safe to actually USE it.
-- =====================================================================

-- house_account is a real sale, tax still applies — just like every
-- other non-cash method already in this seeded table, mapped to
-- 'digital' (8%). Nothing about tax logic itself changes; this is one
-- new data row, same shape as the 6 that already exist.
insert into payment_method_tax_class (method, class) values ('house_account', 'digital');

-- ---------------------------------------------------------------------
-- house_account_balances — "kis account ka kitna baqaya hai," same
-- shape/intent as supplier_payables (0017). security_invoker = true
-- from the start — Part 11's ingredient_stock found the hard way that a
-- plain view bypasses RLS for every caller.
-- ---------------------------------------------------------------------
create or replace view house_account_balances
with (security_invoker = true)
as
select
  ha.id as account_id,
  ha.outlet_id,
  ha.customer_id,
  ha.name,
  ha.credit_limit_paisa,
  ha.billing_day,
  ha.active,
  coalesce(c.charged_paisa, 0) as charged_paisa,
  coalesce(p.paid_paisa, 0) as paid_paisa,
  coalesce(c.charged_paisa, 0) - coalesce(p.paid_paisa, 0) as outstanding_paisa
from house_accounts ha
left join (
  select account_id, sum(amount_paisa) as charged_paisa
  from house_account_charges group by account_id
) c on c.account_id = ha.id
left join (
  select account_id, sum(amount_paisa) as paid_paisa
  from house_account_payments group by account_id
) p on p.account_id = ha.id;

-- ---------------------------------------------------------------------
-- upsert_house_account() — same create-or-edit shape as upsertSupplier's
-- RPC (0007). p_id null = create, else edit the existing account.
-- ---------------------------------------------------------------------
create or replace function upsert_house_account(
  p_id uuid,
  p_name text,
  p_credit_limit_paisa bigint,
  p_billing_day int,
  p_customer_id uuid default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_actor staff; v_id uuid;
begin
  select * into v_actor from current_staff();
  if v_actor is null or v_actor.role not in ('owner','manager') then
    raise exception 'PERM: only owner or manager can manage house accounts';
  end if;

  if p_credit_limit_paisa < 0 then raise exception 'ACCOUNT: credit limit cannot be negative'; end if;
  if p_billing_day < 1 or p_billing_day > 28 then raise exception 'ACCOUNT: billing day must be 1-28'; end if;

  if p_id is not null then
    if not exists (select 1 from house_accounts where id = p_id and outlet_id = v_actor.outlet_id) then
      raise exception 'ACCOUNT: not found';
    end if;
    update house_accounts set
      name = p_name, credit_limit_paisa = p_credit_limit_paisa,
      billing_day = p_billing_day, customer_id = p_customer_id
    where id = p_id;
    v_id := p_id;
  else
    insert into house_accounts (outlet_id, customer_id, name, credit_limit_paisa, billing_day, created_by)
    values (v_actor.outlet_id, p_customer_id, p_name, p_credit_limit_paisa, p_billing_day, v_actor.id)
    returning id into v_id;
  end if;

  insert into audit_log (outlet_id, actor_id, action, entity_type, entity_id, after)
  values (v_actor.outlet_id, v_actor.id, case when p_id is null then 'house_account_created' else 'house_account_updated' end,
          'house_accounts', v_id,
          jsonb_build_object('name', p_name, 'credit_limit_paisa', p_credit_limit_paisa, 'billing_day', p_billing_day));

  return v_id;
end $$;
revoke all on function upsert_house_account(uuid, text, bigint, int, uuid) from public;
grant execute on function upsert_house_account(uuid, text, bigint, int, uuid) to authenticated;

-- ---------------------------------------------------------------------
-- set_house_account_active() — "delete" is deactivate, same convention
-- as setSupplierActive: an account already tied to charge history is
-- never actually removed.
-- ---------------------------------------------------------------------
create or replace function set_house_account_active(p_id uuid, p_active boolean)
returns void language plpgsql security definer set search_path = public as $$
declare v_actor staff;
begin
  select * into v_actor from current_staff();
  if v_actor is null or v_actor.role not in ('owner','manager') then
    raise exception 'PERM: only owner or manager can manage house accounts';
  end if;
  if not exists (select 1 from house_accounts where id = p_id and outlet_id = v_actor.outlet_id) then
    raise exception 'ACCOUNT: not found';
  end if;

  update house_accounts set active = p_active where id = p_id;

  insert into audit_log (outlet_id, actor_id, action, entity_type, entity_id, after)
  values (v_actor.outlet_id, v_actor.id, case when p_active then 'house_account_reactivated' else 'house_account_deactivated' end,
          'house_accounts', p_id, jsonb_build_object('active', p_active));
end $$;
revoke all on function set_house_account_active(uuid, boolean) from public;
grant execute on function set_house_account_active(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------
-- record_house_account_payment() — the monthly settlement this whole
-- feature exists for: money received against an account's running
-- balance, not tied to any single order (see 0046's own comment on
-- house_account_payments for why it's a separate table from `payments`).
-- Same role set as who can record a cash movement/expense — the people
-- who actually handle money at the counter, not kitchen roles.
-- ---------------------------------------------------------------------
create or replace function record_house_account_payment(
  p_account_id uuid,
  p_amount_paisa bigint,
  p_method payment_method,
  p_note text default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_actor staff; v_id uuid;
begin
  select * into v_actor from current_staff();
  if v_actor is null or v_actor.role not in ('owner','manager','supervisor','cashier') then
    raise exception 'PERM: not authorised to record a house account payment';
  end if;

  if p_amount_paisa <= 0 then raise exception 'PAYMENT: amount must be > 0'; end if;

  if not exists (select 1 from house_accounts where id = p_account_id and outlet_id = v_actor.outlet_id) then
    raise exception 'ACCOUNT: not found';
  end if;

  insert into house_account_payments (account_id, amount_paisa, method, note, received_by)
  values (p_account_id, p_amount_paisa, p_method, p_note, v_actor.id)
  returning id into v_id;

  insert into audit_log (outlet_id, actor_id, action, entity_type, entity_id, after)
  values (v_actor.outlet_id, v_actor.id, 'house_account_payment_recorded', 'house_accounts', p_account_id,
          jsonb_build_object('amount_paisa', p_amount_paisa, 'method', p_method));

  return v_id;
end $$;
revoke all on function record_house_account_payment(uuid, bigint, payment_method, text) from public;
grant execute on function record_house_account_payment(uuid, bigint, payment_method, text) to authenticated;

-- ---------------------------------------------------------------------
-- settle_order() — extended, not rewritten. Every existing payment
-- method behaves EXACTLY as before (0035's version, byte-for-byte,
-- outside the two clearly-marked NEW blocks below) — master-prompt §1's
-- "existing working logic ko disturb nahi karna."
--
-- New behaviour: a payment line with method = 'house_account' must
-- carry an account_id in its JSON. Credit-limit is checked BEFORE any
-- writes happen (pre-pass over p_payments, summed per account — a
-- single settle could in principle carry more than one house_account
-- line, though the UI only ever sends one), so an over-limit charge
-- rejects the WHOLE settle with nothing written, same all-or-nothing
-- guarantee master-prompt §4.2 requires. The charge row is written in
-- the same loop, same transaction, as its payment row.
-- ---------------------------------------------------------------------
create or replace function settle_order(
  p_order_id uuid,
  p_payments jsonb,
  p_discount_paisa bigint default 0,
  p_service_charge_paisa bigint default 0,
  p_delivery_fee_paisa bigint default 0
) returns json language plpgsql security definer set search_path = public as $$
declare
  v_staff staff; v_order orders; v_day business_days;
  v_p jsonb; v_method payment_method; v_class tax_class;
  v_rate int; v_base bigint; v_tax bigint;
  v_base_total bigint := 0; v_tax_total bigint := 0; v_net_base bigint;
  v_inv text; v_rl record;
  v_payment_id uuid; v_account_id uuid;
  v_ha_requested jsonb; v_ha record; v_outstanding bigint;
begin
  select * into v_staff from current_staff();
  if v_staff is null then raise exception 'AUTH: not a staff member'; end if;

  select * into v_order from orders where id = p_order_id for update;
  if v_order is null then raise exception 'ORDER: not found'; end if;
  if v_order.outlet_id <> v_staff.outlet_id then raise exception 'ORDER: not found'; end if;
  if v_order.status = 'settled' then raise exception 'ORDER: already settled'; end if;
  if v_order.status = 'voided'  then raise exception 'ORDER: voided'; end if;

  select * into v_day from business_days where id = v_order.business_day_id;
  if v_day.status <> 'open' then raise exception 'DAY: closed — cannot settle'; end if;

  if p_discount_paisa > 0 and v_staff.role not in ('owner','manager','supervisor') then
    raise exception 'PERM: discounts need manager authorisation';
  end if;

  v_net_base := v_order.subtotal_paisa - p_discount_paisa
                + p_service_charge_paisa + p_delivery_fee_paisa;
  if v_net_base < 0 then raise exception 'ORDER: discount exceeds bill'; end if;

  -- NEW: credit-limit pre-check, before any payment/charge is written.
  -- Sums every house_account line by account_id (base + its own tax,
  -- computed the same way the main loop below computes it) and rejects
  -- the whole settle if any one account would go over its limit.
  for v_ha_requested in
    select
      (p->>'account_id')::uuid as account_id,
      sum(
        (p->>'base_paisa')::bigint
        + round((p->>'base_paisa')::bigint * tax_rate_bp(class_of_method('house_account'::payment_method), v_day.business_date) / 10000.0)
      ) as requested_paisa
    from jsonb_array_elements(p_payments) p
    where (p->>'method') = 'house_account'
    group by (p->>'account_id')::uuid
  loop
    select * into v_ha from house_accounts where id = v_ha_requested.account_id and outlet_id = v_staff.outlet_id;
    if v_ha.id is null then raise exception 'ACCOUNT: not found'; end if;
    if not v_ha.active then raise exception 'ACCOUNT: % is not active', v_ha.name; end if;

    select coalesce(sum(amount_paisa), 0) into v_outstanding from house_account_charges where account_id = v_ha.id;
    select v_outstanding - coalesce(sum(amount_paisa), 0) into v_outstanding from house_account_payments where account_id = v_ha.id;

    if v_outstanding + v_ha_requested.requested_paisa > v_ha.credit_limit_paisa then
      raise exception 'ACCOUNT: % credit limit exceeded (outstanding % + this charge % > limit %)',
        v_ha.name, v_outstanding, v_ha_requested.requested_paisa, v_ha.credit_limit_paisa;
    end if;
  end loop;

  for v_p in select * from jsonb_array_elements(p_payments) loop
    v_method := (v_p->>'method')::payment_method;
    v_class  := class_of_method(v_method);
    v_rate   := tax_rate_bp(v_class, v_day.business_date);
    if v_rate is null then raise exception 'TAX: no rate configured for %', v_class; end if;

    v_base := (v_p->>'base_paisa')::bigint;
    v_tax  := round(v_base * v_rate / 10000.0);

    if v_method = 'house_account' then
      v_account_id := (v_p->>'account_id')::uuid;
      if v_account_id is null then raise exception 'ACCOUNT: account_id required for a house_account payment'; end if;
    else
      v_account_id := null;
    end if;

    insert into payments (order_id, method, class, base_paisa, tax_rate_bp,
                          tax_paisa, amount_paisa, tendered_paisa, change_paisa, processor_ref)
    values (p_order_id, v_method, v_class, v_base, v_rate, v_tax, v_base + v_tax,
            (v_p->>'tendered_paisa')::bigint,
            greatest(coalesce((v_p->>'tendered_paisa')::bigint, 0) - (v_base + v_tax), 0),
            v_p->>'processor_ref')
    returning id into v_payment_id;

    -- NEW: the house-account charge row, same transaction as its payment.
    if v_method = 'house_account' then
      insert into house_account_charges (account_id, order_id, payment_id, amount_paisa)
      values (v_account_id, p_order_id, v_payment_id, v_base + v_tax);
    end if;

    v_base_total := v_base_total + v_base;
    v_tax_total  := v_tax_total + v_tax;
  end loop;

  if v_base_total <> v_net_base then
    raise exception 'PAY: split payments (%) do not sum to bill (%)', v_base_total, v_net_base;
  end if;

  v_inv := next_invoice_no(v_order.outlet_id, v_day.business_date);

  update orders set
    discount_paisa       = p_discount_paisa,
    service_charge_paisa = p_service_charge_paisa,
    delivery_fee_paisa   = p_delivery_fee_paisa,
    tax_paisa            = v_tax_total,
    total_paisa          = v_net_base + v_tax_total,
    invoice_no            = v_inv,
    status               = 'settled',
    settled_at           = now()
  where id = p_order_id returning * into v_order;

  for v_rl in
    select rl.ingredient_id, sum(rl.qty * oi.qty) as total_qty
    from order_items oi
    join recipe_lines rl on rl.menu_item_id = oi.menu_item_id
    where oi.order_id = p_order_id and oi.status <> 'voided'
    group by rl.ingredient_id
  loop
    insert into stock_movements (outlet_id, ingredient_id, movement_type, qty,
                                 reference_type, reference_id, performed_by)
    values (v_order.outlet_id, v_rl.ingredient_id, 'sale_depletion', -v_rl.total_qty,
            'orders', p_order_id, v_staff.id);
  end loop;

  insert into audit_log (outlet_id, actor_id, action, entity_type, entity_id, after)
  values (v_order.outlet_id, v_staff.id, 'settle_order', 'orders', p_order_id, to_jsonb(v_order));

  return to_jsonb(v_order);
end $$;
revoke all on function settle_order(uuid, jsonb, bigint, bigint, bigint) from public;
grant execute on function settle_order(uuid, jsonb, bigint, bigint, bigint) to authenticated;

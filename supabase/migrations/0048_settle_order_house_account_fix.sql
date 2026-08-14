-- =====================================================================
-- Cup Shup POS — settle_order(): fix v_ha_requested variable type
-- =====================================================================
-- Bug found by this Patch's own pgTAP test before it ever reached a
-- real user — not a live incident. 0047's settle_order() declared the
-- credit-limit pre-check's FOR-loop variable as `jsonb`
-- (`v_ha_requested jsonb`) when the loop's SELECT returns two columns
-- (account_id, requested_paisa) — PL/pgSQL needs a `record` (or a
-- matching composite type) to receive a multi-column row, same as
-- `v_ha`/`v_rl` are already declared elsewhere in this same function.
-- With `jsonb`, PostgreSQL tried to coerce the row into a single JSON
-- value and failed on the first field it hit: "invalid input syntax for
-- type json — Token '<uuid-prefix>' is invalid." Every house_account
-- settle would have failed outright. Only line 5 of the declare block
-- changes; everything else is byte-for-byte identical to 0047.
-- =====================================================================

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
  v_ha_requested record; v_ha record; v_outstanding bigint;
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

  -- Credit-limit pre-check, before any payment/charge is written. Sums
  -- every house_account line by account_id (base + its own tax, computed
  -- the same way the main loop below computes it) and rejects the whole
  -- settle if any one account would go over its limit.
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

    -- The house-account charge row, same transaction as its payment.
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

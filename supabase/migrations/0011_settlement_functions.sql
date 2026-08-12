-- =====================================================================
-- Cup Shup POS — Payment & Settlement
-- Part 10. Copied verbatim from the project's full reference
-- 0002_functions.sql (see supabase/migrations/README.md for the running
-- account of what's been split out from it and why).
--
-- void_order() — also named in this part's brief — was already copied
-- in Part 09 (0008_order_engine_functions.sql), since 0003_rls.sql's
-- grant statement had been waiting on it since Part 04 and "void" reads
-- more as an order-lifecycle concern than a payment one. Nothing new to
-- add for it here.
-- =====================================================================

-- ---------------------------------------------------------------------
-- SETTLE ORDER
--   Payment happens AFTER eating — and can be split.
--   Punjab taxes by payment mode, so each split gets its own rate.
--   Client sends: [{ method, base_paisa, tendered_paisa, processor_ref }]
--   base_paisa = the PRE-TAX portion of the bill settled by that method.
--   The client never sends a tax amount, only the pre-tax base — same
--   "browser never sends money" rule as place_order() (Part 09).
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
begin
  select * into v_staff from current_staff();
  if v_staff is null then raise exception 'AUTH: not a staff member'; end if;

  select * into v_order from orders where id = p_order_id for update;
  if v_order is null then raise exception 'ORDER: not found'; end if;
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

  for v_p in select * from jsonb_array_elements(p_payments) loop
    v_method := (v_p->>'method')::payment_method;
    v_class  := class_of_method(v_method);
    v_rate   := tax_rate_bp(v_class, v_day.business_date);
    if v_rate is null then raise exception 'TAX: no rate configured for %', v_class; end if;

    v_base := (v_p->>'base_paisa')::bigint;
    v_tax  := round(v_base * v_rate / 10000.0);

    insert into payments (order_id, method, class, base_paisa, tax_rate_bp,
                          tax_paisa, amount_paisa, tendered_paisa, change_paisa, processor_ref)
    values (p_order_id, v_method, v_class, v_base, v_rate, v_tax, v_base + v_tax,
            (v_p->>'tendered_paisa')::bigint,
            greatest(coalesce((v_p->>'tendered_paisa')::bigint, 0) - (v_base + v_tax), 0),
            v_p->>'processor_ref');

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

  -- Deduct ingredients from the recipe — this is what makes variance reporting real
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

  -- NOTE: transmit to PRA eIMS here (Edge Function), then write back
  --       pra_invoice_no / pra_qr_payload / pra_synced_at.
  return to_jsonb(v_order);
end $$;
revoke all on function settle_order(uuid, jsonb, bigint, bigint, bigint) from public;
grant execute on function settle_order(uuid, jsonb, bigint, bigint, bigint) to authenticated;

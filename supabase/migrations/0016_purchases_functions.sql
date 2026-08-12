-- =====================================================================
-- Cup Shup POS — Purchases & Suppliers: functions
-- Part 12. Original to this project.
--
-- record_purchase_grn() is a proper multi-line goods-receipt version of
-- Part 11's record_purchase() (which still exists, unchanged, for
-- quick single-ingredient top-ups from the inventory screen). Both
-- apply the exact same weighted-average formula per ingredient — this
-- one just also creates the purchases/purchase_lines header+detail rows
-- a real supplier delivery needs (invoice reference, payment status,
-- multiple ingredients in one GRN).
-- =====================================================================

create or replace function upsert_supplier(
  p_id uuid,
  p_name text,
  p_phone text default null,
  p_terms text default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_actor staff; v_id uuid;
begin
  select * into v_actor from current_staff();
  if v_actor is null or v_actor.role not in ('owner','manager') then
    raise exception 'PERM: only owner or manager can manage suppliers';
  end if;
  if p_name is null or length(trim(p_name)) = 0 then
    raise exception 'SUPPLIER: name is required';
  end if;

  if p_id is null then
    insert into suppliers (outlet_id, name, phone, terms)
    values (v_actor.outlet_id, p_name, p_phone, p_terms)
    returning id into v_id;
  else
    update suppliers set name = p_name, phone = p_phone, terms = p_terms
     where id = p_id and outlet_id = v_actor.outlet_id
    returning id into v_id;
    if v_id is null then raise exception 'SUPPLIER: not found'; end if;
  end if;

  insert into audit_log (outlet_id, actor_id, action, entity_type, entity_id)
  values (v_actor.outlet_id, v_actor.id,
          case when p_id is null then 'supplier_created' else 'supplier_updated' end,
          'suppliers', v_id);

  return v_id;
end $$;
revoke all on function upsert_supplier(uuid, text, text, text) from public;
grant execute on function upsert_supplier(uuid, text, text, text) to authenticated;

create or replace function set_supplier_active(p_supplier_id uuid, p_active boolean)
returns void language plpgsql security definer set search_path = public as $$
declare v_actor staff;
begin
  select * into v_actor from current_staff();
  if v_actor is null or v_actor.role not in ('owner','manager') then
    raise exception 'PERM: only owner or manager can retire a supplier';
  end if;

  update suppliers set active = p_active
   where id = p_supplier_id and outlet_id = v_actor.outlet_id;
  if not found then raise exception 'SUPPLIER: not found'; end if;

  insert into audit_log (outlet_id, actor_id, action, entity_type, entity_id, after)
  values (v_actor.outlet_id, v_actor.id,
          case when p_active then 'supplier_activated' else 'supplier_deactivated' end,
          'suppliers', p_supplier_id, jsonb_build_object('active', p_active));
end $$;
revoke all on function set_supplier_active(uuid, boolean) from public;
grant execute on function set_supplier_active(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------
-- RECORD PURCHASE GRN — the goods-receipt entry point. One transaction:
-- the purchase header, every line, every line's stock_movement, and
-- every line's moving_avg_cost_paisa update all succeed together or
-- none do — a receiving screen can never leave stock half-updated.
--
-- p_lines: [{ ingredient_id, qty, unit_cost_paisa }]
-- ---------------------------------------------------------------------
create or replace function record_purchase_grn(
  p_supplier_id uuid,
  p_lines jsonb,
  p_invoice_ref text default null,
  p_payment_status text default 'credit',
  p_amount_paid_paisa bigint default 0,
  p_invoice_photo_url text default null,
  p_note text default null
) returns json language plpgsql security definer set search_path = public as $$
declare
  v_actor staff;
  v_purchase purchases;
  v_day business_days;
  v_line jsonb;
  v_ingredient ingredients;
  v_current_stock numeric;
  v_new_avg bigint;
  v_qty numeric;
  v_unit_cost bigint;
  v_line_total bigint;
  v_total bigint := 0;
begin
  select * into v_actor from current_staff();
  if v_actor is null or v_actor.role not in ('owner','manager') then
    raise exception 'PERM: only owner or manager can record a purchase';
  end if;

  if p_payment_status not in ('paid','credit','partial') then
    raise exception 'PURCHASE: invalid payment_status';
  end if;
  if jsonb_array_length(p_lines) = 0 then
    raise exception 'PURCHASE: at least one line is required';
  end if;

  -- Optional link to today's open business day, if there is one — a
  -- delivery can arrive before the day opens or after it closes.
  select * into v_day from business_days
   where outlet_id = v_actor.outlet_id and status = 'open'
   order by opened_at desc limit 1;

  insert into purchases (outlet_id, supplier_id, business_day_id, invoice_ref,
                         invoice_photo_url, payment_status, amount_paid_paisa,
                         received_by, note)
  values (v_actor.outlet_id, p_supplier_id, v_day.id, p_invoice_ref,
          p_invoice_photo_url, p_payment_status, p_amount_paid_paisa,
          v_actor.id, p_note)
  returning * into v_purchase;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    select * into v_ingredient from ingredients
     where id = (v_line->>'ingredient_id')::uuid and outlet_id = v_actor.outlet_id;
    if v_ingredient is null then raise exception 'INGREDIENT: not found'; end if;

    v_qty := (v_line->>'qty')::numeric;
    v_unit_cost := (v_line->>'unit_cost_paisa')::bigint;
    if v_qty is null or v_qty <= 0 then raise exception 'PURCHASE: qty must be > 0'; end if;
    if v_unit_cost is null or v_unit_cost < 0 then
      raise exception 'PURCHASE: unit cost cannot be negative';
    end if;

    select coalesce(sum(qty), 0) into v_current_stock
    from stock_movements where ingredient_id = v_ingredient.id;

    -- Same weighted-average formula as record_purchase() (Part 11) —
    -- the number every recipe_cost_paisa() call and every order's
    -- cogs_paisa ultimately traces back to.
    if v_current_stock > 0 then
      v_new_avg := round(
        (v_current_stock * v_ingredient.moving_avg_cost_paisa + v_qty * v_unit_cost)
        / (v_current_stock + v_qty)
      );
    else
      v_new_avg := v_unit_cost;
    end if;

    v_line_total := round(v_qty * v_unit_cost);

    insert into purchase_lines (purchase_id, ingredient_id, qty, unit_cost_paisa, line_total_paisa)
    values (v_purchase.id, v_ingredient.id, v_qty, v_unit_cost, v_line_total);

    insert into stock_movements (outlet_id, ingredient_id, movement_type, qty,
                                 unit_cost_paisa, reference_type, reference_id, performed_by)
    values (v_actor.outlet_id, v_ingredient.id, 'purchase', v_qty, v_unit_cost,
            'purchases', v_purchase.id, v_actor.id);

    update ingredients set moving_avg_cost_paisa = v_new_avg where id = v_ingredient.id;

    v_total := v_total + v_line_total;
  end loop;

  update purchases set total_paisa = v_total where id = v_purchase.id returning * into v_purchase;

  insert into audit_log (outlet_id, actor_id, action, entity_type, entity_id, after)
  values (v_actor.outlet_id, v_actor.id, 'purchase_recorded', 'purchases', v_purchase.id,
          to_jsonb(v_purchase));

  return to_jsonb(v_purchase);
end $$;
revoke all on function record_purchase_grn(uuid, jsonb, text, text, bigint, text, text) from public;
grant execute on function record_purchase_grn(uuid, jsonb, text, text, bigint, text, text) to authenticated;

-- ---------------------------------------------------------------------
-- PURCHASE RETURN — "kharab maal wapas". Never edits or deletes the
-- original GRN; writes a purchase_returns row plus a stock_movement
-- taking the returned qty back out. Uses movement_type 'transfer' (the
-- closest existing fit — stock leaving for a reason that's neither a
-- sale nor wastage) rather than adding a new enum value for this.
--
-- Deliberately does NOT recompute moving_avg_cost_paisa: unwinding a
-- weighted average precisely requires knowing the exact prior state at
-- the time of the original purchase, which isn't reliably reconstructable
-- from the ledger alone. The average is left as-is — a known, documented
-- simplification, not an oversight.
-- ---------------------------------------------------------------------
create or replace function record_purchase_return(
  p_purchase_id uuid,
  p_ingredient_id uuid,
  p_qty numeric,
  p_reason text default null
) returns json language plpgsql security definer set search_path = public as $$
declare
  v_actor staff;
  v_purchase purchases;
  v_ingredient ingredients;
begin
  select * into v_actor from current_staff();
  if v_actor is null or v_actor.role not in ('owner','manager') then
    raise exception 'PERM: only owner or manager can record a purchase return';
  end if;
  if p_qty <= 0 then raise exception 'RETURN: qty must be > 0'; end if;

  select * into v_purchase from purchases where id = p_purchase_id and outlet_id = v_actor.outlet_id;
  if v_purchase is null then raise exception 'PURCHASE: not found'; end if;

  select * into v_ingredient from ingredients where id = p_ingredient_id;
  if v_ingredient is null then raise exception 'INGREDIENT: not found'; end if;

  insert into purchase_returns (purchase_id, ingredient_id, qty, unit_cost_paisa, reason, performed_by)
  values (p_purchase_id, p_ingredient_id, p_qty, v_ingredient.moving_avg_cost_paisa, p_reason, v_actor.id);

  insert into stock_movements (outlet_id, ingredient_id, movement_type, qty,
                               unit_cost_paisa, reference_type, reference_id, reason, performed_by)
  values (v_purchase.outlet_id, p_ingredient_id, 'transfer', -p_qty,
          v_ingredient.moving_avg_cost_paisa, 'purchase_returns', p_purchase_id, p_reason, v_actor.id);

  insert into audit_log (outlet_id, actor_id, action, entity_type, entity_id, after)
  values (v_purchase.outlet_id, v_actor.id, 'purchase_return', 'purchases', p_purchase_id,
          jsonb_build_object('ingredient_id', p_ingredient_id, 'qty', p_qty, 'reason', p_reason));

  return json_build_object('purchase_id', p_purchase_id, 'ingredient_id', p_ingredient_id, 'qty', p_qty);
end $$;
revoke all on function record_purchase_return(uuid, uuid, numeric, text) from public;
grant execute on function record_purchase_return(uuid, uuid, numeric, text) to authenticated;

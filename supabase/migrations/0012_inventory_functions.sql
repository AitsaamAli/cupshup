-- =====================================================================
-- Cup Shup POS — Inventory & Recipe Functions
-- Part 11. Original to this project — no reference file for these.
--
-- Two big pieces of "inventory ka sales se koi taluq nahi" were already
-- fixed as side effects of earlier parts, not new work here:
--   - settle_order() (0011) already deducts recipe_lines × qty as a
--     'sale_depletion' movement the instant an order is paid for.
--   - void_order() (0010) already reverses that with 'void_return'.
--   - Wastage/staff-meal logging needs no new RPC at all — 0005_rls.sql's
--     log_wastage policy already lets kitchen roles INSERT directly into
--     stock_movements for those two movement types (and only those),
--     with purchase/count_adjustment locked to owner/manager. lib/
--     inventory.ts's logWastage() just does that direct insert.
--
-- What's genuinely new: recipe editing, recording a purchase (with the
-- weighted-average cost update), and physical stock counts.
-- =====================================================================

-- ---------------------------------------------------------------------
-- RECIPE EDITING — owner/manager/chef, matching 0005_rls.sql's
-- manage_recipes policy exactly. Kept as RPCs (rather than relying on
-- that RLS policy alone for direct writes) so every recipe change is
-- audited — a recipe line is a cost input to every future order's COGS,
-- not a cosmetic menu detail.
-- ---------------------------------------------------------------------
create or replace function upsert_recipe_line(
  p_menu_item_id uuid,
  p_ingredient_id uuid,
  p_qty numeric
) returns void language plpgsql security definer set search_path = public as $$
declare v_actor staff; v_before numeric;
begin
  select * into v_actor from current_staff();
  if v_actor is null or v_actor.role not in ('owner','manager','chef') then
    raise exception 'PERM: only owner, manager, or chef can edit recipes';
  end if;
  if p_qty <= 0 then raise exception 'RECIPE: qty must be > 0'; end if;

  select qty into v_before from recipe_lines
   where menu_item_id = p_menu_item_id and ingredient_id = p_ingredient_id;

  insert into recipe_lines (menu_item_id, ingredient_id, qty)
  values (p_menu_item_id, p_ingredient_id, p_qty)
  on conflict (menu_item_id, ingredient_id) do update set qty = p_qty;

  insert into audit_log (outlet_id, actor_id, action, entity_type, entity_id, before, after)
  values (v_actor.outlet_id, v_actor.id, 'recipe_line_set', 'recipe_lines', p_menu_item_id,
          jsonb_build_object('ingredient_id', p_ingredient_id, 'qty', v_before),
          jsonb_build_object('ingredient_id', p_ingredient_id, 'qty', p_qty));
end $$;
revoke all on function upsert_recipe_line(uuid, uuid, numeric) from public;
grant execute on function upsert_recipe_line(uuid, uuid, numeric) to authenticated;

create or replace function remove_recipe_line(p_menu_item_id uuid, p_ingredient_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_actor staff;
begin
  select * into v_actor from current_staff();
  if v_actor is null or v_actor.role not in ('owner','manager','chef') then
    raise exception 'PERM: only owner, manager, or chef can edit recipes';
  end if;

  delete from recipe_lines where menu_item_id = p_menu_item_id and ingredient_id = p_ingredient_id;
  if not found then raise exception 'RECIPE: line not found'; end if;

  insert into audit_log (outlet_id, actor_id, action, entity_type, entity_id, after)
  values (v_actor.outlet_id, v_actor.id, 'recipe_line_removed', 'recipe_lines', p_menu_item_id,
          jsonb_build_object('ingredient_id', p_ingredient_id));
end $$;
revoke all on function remove_recipe_line(uuid, uuid) from public;
grant execute on function remove_recipe_line(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------
-- RECORD PURCHASE — owner/manager only (matches log_wastage's split:
-- purchase/count_adjustment are manager-only movement types). Updates
-- moving_avg_cost_paisa as a weighted average of what was already on
-- hand and what just arrived — the number every COGS/margin figure in
-- this app ultimately traces back to.
-- ---------------------------------------------------------------------
create or replace function record_purchase(
  p_ingredient_id uuid,
  p_qty numeric,
  p_unit_cost_paisa bigint,
  p_supplier_id uuid default null,
  p_note text default null
) returns json language plpgsql security definer set search_path = public as $$
declare
  v_actor staff;
  v_ingredient ingredients;
  v_current_stock numeric;
  v_new_avg_cost bigint;
begin
  select * into v_actor from current_staff();
  if v_actor is null or v_actor.role not in ('owner','manager') then
    raise exception 'PERM: only owner or manager can record a purchase';
  end if;
  if p_qty <= 0 then raise exception 'PURCHASE: qty must be > 0'; end if;
  if p_unit_cost_paisa < 0 then raise exception 'PURCHASE: unit cost cannot be negative'; end if;

  select * into v_ingredient from ingredients where id = p_ingredient_id;
  if v_ingredient is null then raise exception 'INGREDIENT: not found'; end if;

  select coalesce(sum(qty), 0) into v_current_stock
  from stock_movements where ingredient_id = p_ingredient_id;

  -- Weighted average: blend what's already on hand at its existing
  -- average cost with what's arriving at its own cost. If there's
  -- nothing on hand (or a negative ledger, which shouldn't happen but
  -- is handled safely), the new cost simply becomes the average.
  if v_current_stock > 0 then
    v_new_avg_cost := round(
      (v_current_stock * v_ingredient.moving_avg_cost_paisa + p_qty * p_unit_cost_paisa)
      / (v_current_stock + p_qty)
    );
  else
    v_new_avg_cost := p_unit_cost_paisa;
  end if;

  insert into stock_movements (outlet_id, ingredient_id, movement_type, qty,
                               unit_cost_paisa, reference_type, reference_id,
                               reason, performed_by)
  values (v_ingredient.outlet_id, p_ingredient_id, 'purchase', p_qty,
          p_unit_cost_paisa, 'suppliers', p_supplier_id, p_note, v_actor.id);

  update ingredients set moving_avg_cost_paisa = v_new_avg_cost where id = p_ingredient_id;

  insert into audit_log (outlet_id, actor_id, action, entity_type, entity_id, after)
  values (v_ingredient.outlet_id, v_actor.id, 'purchase_recorded', 'ingredients', p_ingredient_id,
          jsonb_build_object('qty', p_qty, 'unit_cost_paisa', p_unit_cost_paisa,
                             'new_avg_cost_paisa', v_new_avg_cost));

  return json_build_object(
    'new_stock', v_current_stock + p_qty,
    'new_avg_cost_paisa', v_new_avg_cost
  );
end $$;
revoke all on function record_purchase(uuid, numeric, bigint, uuid, text) from public;
grant execute on function record_purchase(uuid, numeric, bigint, uuid, text) to authenticated;

-- ---------------------------------------------------------------------
-- PHYSICAL STOCK COUNT — owner/manager only. Compares what the ledger
-- says should be on the shelf against what a manager actually counted,
-- and writes exactly the difference as a count_adjustment movement.
-- That single number — this count's adjustment — IS this ingredient's
-- unexplained variance for the period since the last count (see
-- stock_variance, 0013_stock_variance_view.sql).
-- ---------------------------------------------------------------------
create or replace function record_stock_count(
  p_ingredient_id uuid,
  p_counted_qty numeric,
  p_note text default null
) returns json language plpgsql security definer set search_path = public as $$
declare
  v_actor staff;
  v_ingredient ingredients;
  v_theoretical numeric;
  v_delta numeric;
begin
  select * into v_actor from current_staff();
  if v_actor is null or v_actor.role not in ('owner','manager') then
    raise exception 'PERM: only owner or manager can record a stock count';
  end if;
  if p_counted_qty < 0 then raise exception 'COUNT: cannot be negative'; end if;

  select * into v_ingredient from ingredients where id = p_ingredient_id;
  if v_ingredient is null then raise exception 'INGREDIENT: not found'; end if;

  select coalesce(sum(qty), 0) into v_theoretical
  from stock_movements where ingredient_id = p_ingredient_id;

  v_delta := p_counted_qty - v_theoretical;

  if v_delta <> 0 then
    insert into stock_movements (outlet_id, ingredient_id, movement_type, qty,
                                 reference_type, reason, performed_by)
    values (v_ingredient.outlet_id, p_ingredient_id, 'count_adjustment', v_delta,
            'stock_count', coalesce(p_note, 'physical count'), v_actor.id);
  end if;

  insert into audit_log (outlet_id, actor_id, action, entity_type, entity_id, after)
  values (v_ingredient.outlet_id, v_actor.id, 'stock_count', 'ingredients', p_ingredient_id,
          jsonb_build_object('theoretical', v_theoretical, 'counted', p_counted_qty, 'variance', v_delta));

  return json_build_object('theoretical', v_theoretical, 'counted', p_counted_qty, 'variance', v_delta);
end $$;
revoke all on function record_stock_count(uuid, numeric, text) from public;
grant execute on function record_stock_count(uuid, numeric, text) to authenticated;

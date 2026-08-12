-- =====================================================================
-- Cup Shup POS — Menu Management Functions
-- Part 08. Every menu edit goes through one of these RPCs, never a raw
-- client UPDATE — that's what actually enforces "price changes are
-- always a new row, never an overwrite" and "every menu change is
-- audited," instead of leaving both as rules someone has to remember.
-- =====================================================================

-- ---------------------------------------------------------------------
-- upsert_menu_item — create or edit an item's NON-PRICE fields. Price is
-- deliberately never a parameter here — see change_item_price() below.
-- ---------------------------------------------------------------------
create or replace function upsert_menu_item(
  p_id uuid,
  p_category_id uuid,
  p_name text,
  p_sku text default null,
  p_sort_order int default 0,
  p_image_url text default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_actor staff;
  v_id uuid;
  v_before jsonb;
  v_after jsonb;
begin
  select * into v_actor from current_staff();
  if v_actor is null or v_actor.role not in ('owner','manager') then
    raise exception 'PERM: only owner or manager can edit the menu';
  end if;

  if p_id is null then
    insert into menu_items (category_id, name, sku, sort_order, image_url)
    values (p_category_id, p_name, p_sku, p_sort_order, p_image_url)
    returning id into v_id;

    select to_jsonb(mi) into v_after from menu_items mi where mi.id = v_id;
    insert into audit_log (outlet_id, actor_id, action, entity_type, entity_id, after)
    values (v_actor.outlet_id, v_actor.id, 'menu_item_created', 'menu_items', v_id, v_after);
  else
    select to_jsonb(mi) into v_before from menu_items mi where mi.id = p_id;
    if v_before is null then raise exception 'ITEM: not found'; end if;

    update menu_items set
      category_id = p_category_id,
      name        = p_name,
      sku         = p_sku,
      sort_order  = p_sort_order,
      image_url   = coalesce(p_image_url, image_url)
    where id = p_id
    returning id into v_id;

    select to_jsonb(mi) into v_after from menu_items mi where mi.id = v_id;
    insert into audit_log (outlet_id, actor_id, action, entity_type, entity_id, before, after)
    values (v_actor.outlet_id, v_actor.id, 'menu_item_updated', 'menu_items', v_id, v_before, v_after);
  end if;

  return v_id;
end $$;
revoke all on function upsert_menu_item(uuid, uuid, text, text, int, text) from public;
grant execute on function upsert_menu_item(uuid, uuid, text, text, int, text) to authenticated;

-- ---------------------------------------------------------------------
-- change_item_price — the ONLY way a price ever changes. Never an
-- UPDATE on the existing row: close it out (effective_to = today) and
-- insert a new one (effective_from = today), so an old invoice keeps
-- pointing at the closed-out row and keeps showing the price that was
-- actually charged, forever. Also clears price_unconfirmed — a
-- deliberate price change by an owner/manager IS the confirmation.
-- ---------------------------------------------------------------------
create or replace function change_item_price(p_item_id uuid, p_new_price_paisa bigint)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_actor staff;
  v_old_price bigint;
begin
  select * into v_actor from current_staff();
  if v_actor is null or v_actor.role not in ('owner','manager') then
    raise exception 'PERM: only owner or manager can change prices';
  end if;

  if p_new_price_paisa < 0 then
    raise exception 'PRICE: cannot be negative';
  end if;

  select price_paisa into v_old_price from menu_item_prices
   where menu_item_id = p_item_id and effective_to is null;

  if v_old_price is not null and v_old_price = p_new_price_paisa then
    -- No real change — just clear the unconfirmed flag if it was set,
    -- and skip creating a pointless same-price history row for today.
    update menu_items set price_unconfirmed = false where id = p_item_id;
    return;
  end if;

  update menu_item_prices set effective_to = current_date
   where menu_item_id = p_item_id and effective_to is null;

  insert into menu_item_prices (menu_item_id, price_paisa, effective_from)
  values (p_item_id, p_new_price_paisa, current_date);

  update menu_items set price_unconfirmed = false where id = p_item_id;

  insert into audit_log (outlet_id, actor_id, action, entity_type, entity_id, before, after)
  values (v_actor.outlet_id, v_actor.id, 'price_changed', 'menu_items', p_item_id,
          jsonb_build_object('price_paisa', v_old_price),
          jsonb_build_object('price_paisa', p_new_price_paisa));
end $$;
revoke all on function change_item_price(uuid, bigint) from public;
grant execute on function change_item_price(uuid, bigint) to authenticated;

-- ---------------------------------------------------------------------
-- toggle_86 — mark an item temporarily out of stock. Chef/Kitchen can do
-- this instantly, no Manager approval needed — but only this one flag.
-- Price lives in a completely separate table this function never
-- touches, so there's no way for a kitchen-role call to reach it.
-- ---------------------------------------------------------------------
create or replace function toggle_86(p_item_id uuid, p_is_86 boolean)
returns void language plpgsql security definer set search_path = public as $$
declare v_actor staff;
begin
  select * into v_actor from current_staff();
  if v_actor is null or v_actor.role not in
     ('owner','manager','supervisor','chef','kitchen') then
    raise exception 'PERM: not authorised to 86 an item';
  end if;

  update menu_items set is_86 = p_is_86 where id = p_item_id;
  if not found then raise exception 'ITEM: not found'; end if;

  insert into audit_log (outlet_id, actor_id, action, entity_type, entity_id, after)
  values (v_actor.outlet_id, v_actor.id, case when p_is_86 then '86_on' else '86_off' end,
          'menu_items', p_item_id, jsonb_build_object('is_86', p_is_86));
end $$;
revoke all on function toggle_86(uuid, boolean) from public;
grant execute on function toggle_86(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------
-- reorder_categories — takes category ids in their new display order;
-- sort_order becomes each id's position in the array.
-- ---------------------------------------------------------------------
create or replace function reorder_categories(p_category_ids uuid[])
returns void language plpgsql security definer set search_path = public as $$
declare v_actor staff; v_id uuid; v_pos int := 0;
begin
  select * into v_actor from current_staff();
  if v_actor is null or v_actor.role not in ('owner','manager') then
    raise exception 'PERM: only owner or manager can reorder categories';
  end if;

  foreach v_id in array p_category_ids loop
    update menu_categories set sort_order = v_pos
     where id = v_id and outlet_id = v_actor.outlet_id;
    v_pos := v_pos + 1;
  end loop;

  insert into audit_log (outlet_id, actor_id, action, entity_type, after)
  values (v_actor.outlet_id, v_actor.id, 'categories_reordered', 'menu_categories',
          to_jsonb(p_category_ids));
end $$;
revoke all on function reorder_categories(uuid[]) from public;
grant execute on function reorder_categories(uuid[]) to authenticated;

-- ---------------------------------------------------------------------
-- set_menu_item_active — the only "delete." Old orders keep referencing
-- an item's id (order_items.menu_item_id, with its own name/price
-- snapshot), so the row must never actually disappear.
-- ---------------------------------------------------------------------
create or replace function set_menu_item_active(p_item_id uuid, p_active boolean)
returns void language plpgsql security definer set search_path = public as $$
declare v_actor staff;
begin
  select * into v_actor from current_staff();
  if v_actor is null or v_actor.role not in ('owner','manager') then
    raise exception 'PERM: only owner or manager can hide a menu item';
  end if;

  update menu_items set active = p_active where id = p_item_id;
  if not found then raise exception 'ITEM: not found'; end if;

  insert into audit_log (outlet_id, actor_id, action, entity_type, entity_id, after)
  values (v_actor.outlet_id, v_actor.id,
          case when p_active then 'menu_item_activated' else 'menu_item_deactivated' end,
          'menu_items', p_item_id, jsonb_build_object('active', p_active));
end $$;
revoke all on function set_menu_item_active(uuid, boolean) from public;
grant execute on function set_menu_item_active(uuid, boolean) to authenticated;

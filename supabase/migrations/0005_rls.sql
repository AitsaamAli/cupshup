-- =====================================================================
-- Cup Shup POS — 0003 Row Level Security
-- This is the ONLY real permission layer. Hiding tabs in React is UX,
-- not security — anyone can flip client state in DevTools.
-- =====================================================================

alter table outlets            enable row level security;
alter table staff              enable row level security;
alter table terminals          enable row level security;
alter table tax_rates          enable row level security;
alter table payment_method_tax_class enable row level security;
alter table menu_categories    enable row level security;
alter table menu_items         enable row level security;
alter table menu_item_prices   enable row level security;
alter table modifier_groups    enable row level security;
alter table modifiers          enable row level security;
alter table menu_item_modifier_groups enable row level security;
alter table ingredients        enable row level security;
alter table recipe_lines       enable row level security;
alter table suppliers          enable row level security;
alter table stock_movements    enable row level security;
alter table business_days      enable row level security;
alter table shifts             enable row level security;
alter table dining_tables      enable row level security;
alter table customers          enable row level security;
alter table orders             enable row level security;
alter table order_items        enable row level security;
alter table order_voids        enable row level security;
alter table payments           enable row level security;
alter table expense_categories enable row level security;
alter table expenses           enable row level security;
alter table cash_movements     enable row level security;
alter table audit_log          enable row level security;
-- Counters have no policies below (only SECURITY DEFINER functions touch
-- them), so enabling RLS with zero policies denies ALL direct access —
-- exactly what a table that must only ever be written by next_order_no()/
-- next_invoice_no() needs. (Added here — the reference file enabled RLS
-- on every other table but missed these two; same pattern, applied.)
alter table invoice_counters   enable row level security;
alter table order_counters     enable row level security;

-- ---------------------------------------------------------------------
-- Everyone on staff can READ their own outlet's operational data
-- ---------------------------------------------------------------------
create policy read_own_outlet on outlets for select
  using (id = my_outlet());

create policy read_staff on staff for select
  using (outlet_id = my_outlet());

create policy read_terminals on terminals for select using (outlet_id = my_outlet());
create policy read_tax_rates on tax_rates for select using (auth.uid() is not null);
create policy read_pm_class  on payment_method_tax_class for select using (auth.uid() is not null);

create policy read_categories on menu_categories for select using (outlet_id = my_outlet());
create policy read_items      on menu_items for select
  using (exists (select 1 from menu_categories c where c.id = category_id and c.outlet_id = my_outlet()));
create policy read_prices     on menu_item_prices for select using (auth.uid() is not null);
create policy read_modgroups  on modifier_groups for select using (outlet_id = my_outlet());
create policy read_mods       on modifiers for select using (auth.uid() is not null);
create policy read_item_mods  on menu_item_modifier_groups for select using (auth.uid() is not null);

create policy read_tables    on dining_tables for select using (outlet_id = my_outlet());
create policy read_days      on business_days for select using (outlet_id = my_outlet());
create policy read_shifts    on shifts for select
  using (exists (select 1 from business_days d where d.id = business_day_id and d.outlet_id = my_outlet()));

-- ---------------------------------------------------------------------
-- MENU: only owner/manager may change prices or items
-- ---------------------------------------------------------------------
create policy manage_categories on menu_categories for all
  using (outlet_id = my_outlet() and has_role('owner','manager'))
  with check (outlet_id = my_outlet() and has_role('owner','manager'));

create policy manage_items on menu_items for all
  using (has_role('owner','manager')) with check (has_role('owner','manager'));

create policy manage_prices on menu_item_prices for all
  using (has_role('owner','manager')) with check (has_role('owner','manager'));

-- Kitchen may 86 an item (mark out of stock) but not change its price
create policy kitchen_86 on menu_items for update
  using (has_role('chef','kitchen','supervisor'))
  with check (has_role('chef','kitchen','supervisor'));

-- ---------------------------------------------------------------------
-- ORDERS: insert via RPC only. No UPDATE policy, no DELETE policy —
-- meaning nobody can edit or delete an order through the API, ever.
-- Corrections go through void_order(), which writes a reversal.
-- ---------------------------------------------------------------------
create policy read_orders on orders for select using (outlet_id = my_outlet());
create policy read_order_items on order_items for select
  using (exists (select 1 from orders o where o.id = order_id and o.outlet_id = my_outlet()));
create policy read_payments on payments for select
  using (exists (select 1 from orders o where o.id = order_id and o.outlet_id = my_outlet()));
create policy read_voids on order_voids for select
  using (exists (select 1 from orders o where o.id = order_id and o.outlet_id = my_outlet()));

-- Kitchen staff may advance an order ITEM's status (pending -> preparing -> ready)
create policy kds_update_items on order_items for update
  using (has_role('chef','kitchen','barista','supervisor','manager','owner'))
  with check (has_role('chef','kitchen','barista','supervisor','manager','owner'));

-- ---------------------------------------------------------------------
-- INVENTORY: kitchen can log wastage; only manager can adjust counts
-- ---------------------------------------------------------------------
create policy read_ingredients on ingredients for select using (outlet_id = my_outlet());
create policy read_recipes     on recipe_lines for select using (auth.uid() is not null);
create policy read_movements   on stock_movements for select using (outlet_id = my_outlet());
create policy read_suppliers   on suppliers for select using (outlet_id = my_outlet());

create policy manage_ingredients on ingredients for all
  using (outlet_id = my_outlet() and has_role('owner','manager'))
  with check (outlet_id = my_outlet() and has_role('owner','manager'));

create policy manage_recipes on recipe_lines for all
  using (has_role('owner','manager','chef')) with check (has_role('owner','manager','chef'));

-- Anyone in the kitchen can record wastage or a staff meal — but nothing else.
create policy log_wastage on stock_movements for insert
  with check (
    outlet_id = my_outlet()
    and (
      (movement_type in ('wastage','staff_meal')
        and has_role('chef','kitchen','barista','supervisor','manager','owner'))
      or (movement_type in ('purchase','count_adjustment','transfer')
        and has_role('owner','manager'))
    )
  );
-- deliberately no update/delete: the stock ledger is append-only

-- ---------------------------------------------------------------------
-- EXPENSES
-- ---------------------------------------------------------------------
create policy read_exp_cats on expense_categories for select using (outlet_id = my_outlet());
create policy manage_exp_cats on expense_categories for all
  using (outlet_id = my_outlet() and has_role('owner','manager'))
  with check (outlet_id = my_outlet() and has_role('owner','manager'));

create policy read_expenses on expenses for select
  using (outlet_id = my_outlet() and has_role('owner','manager','supervisor'));

create policy insert_expenses on expenses for insert
  with check (outlet_id = my_outlet() and has_role('owner','manager','supervisor'));

create policy update_expenses on expenses for update
  using (outlet_id = my_outlet() and has_role('owner','manager')
         and exists (select 1 from business_days d
                     where d.id = business_day_id and d.status = 'open'))
  with check (outlet_id = my_outlet() and has_role('owner','manager'));

create policy delete_expenses on expenses for delete
  using (outlet_id = my_outlet() and has_role('owner')
         and exists (select 1 from business_days d
                     where d.id = business_day_id and d.status = 'open'));

create policy cash_moves on cash_movements for all
  using (has_role('owner','manager','supervisor'))
  with check (has_role('owner','manager','supervisor'));

-- ---------------------------------------------------------------------
-- CUSTOMERS
-- ---------------------------------------------------------------------
create policy read_customers on customers for select using (outlet_id = my_outlet());
create policy write_customers on customers for insert
  with check (outlet_id = my_outlet());
create policy update_customers on customers for update
  using (outlet_id = my_outlet() and has_role('owner','manager','supervisor','cashier'))
  with check (outlet_id = my_outlet());

-- ---------------------------------------------------------------------
-- OWNER-ONLY: the P&L, and the audit trail
-- ---------------------------------------------------------------------
create policy owner_reads_audit on audit_log for select
  using (outlet_id = my_outlet() and has_role('owner'));
-- no insert policy: only SECURITY DEFINER functions write here

-- Views inherit RLS from their base tables, but lock the P&L explicitly.
-- DEFERRED: daily_pl / product_performance / stock_variance don't exist
-- yet — they're Part 18's reporting views. This statement is re-added in
-- a later migration once Part 18 creates them (documented in
-- supabase/migrations/README.md). Not a defect — those views genuinely
-- aren't built yet at this point in the guide's pacing.
-- revoke all on daily_pl, product_performance, stock_variance from anon, authenticated;
-- grant select on daily_pl, product_performance, stock_variance to authenticated;

-- Staff can only ever manage staff if they are the owner
create policy owner_manages_staff on staff for all
  using (outlet_id = my_outlet() and has_role('owner'))
  with check (outlet_id = my_outlet() and has_role('owner'));

-- ---------------------------------------------------------------------
-- Lock down direct table writes that must go through RPCs
-- ---------------------------------------------------------------------
revoke insert, update, delete on orders, order_items, payments, order_voids,
       business_days, shifts, invoice_counters, order_counters
  from anon, authenticated;

-- place_order/settle_order/void_order already have their own explicit
-- grants (0010/0011_*.sql), so this only needs to cover the two that
-- don't exist yet. DEFERRED: open_business_day/close_business_day are
-- Part 13's functions — this statement is re-added once they exist
-- (documented in supabase/migrations/README.md).
-- grant execute on function place_order, settle_order, void_order,
--                           open_business_day, close_business_day
--   to authenticated;

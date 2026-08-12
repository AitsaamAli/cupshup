-- =====================================================================
-- Cup Shup POS — Expenses: approval workflow
-- Part 14. Original to this project — no reference file.
--
-- The schema already had everything Part 14 asks for: expense_categories.
-- accrual_type, and every column on expenses (payment_method, vendor,
-- receipt_url, approved_by, period_start/end) — all from Part 03/04's
-- reference material, including expense_categories seeded with exactly
-- the categories this part's brief names (0006_seed.sql). Even direct
-- insert/update/delete RLS policies already existed (0005_rls.sql).
--
-- What was missing: the amount-based approval threshold itself. The
-- existing RLS policies let any supervisor+ insert ANY amount with no
-- approval check at all — this migration revokes direct writes (same
-- "financial writes are RPC-only" pattern as orders/payments/purchases
-- everywhere else in this app) and replaces them with functions that
-- actually enforce the threshold table from the brief:
--   < Rs 5,000        — no approval needed
--   Rs 5,000–25,000   — needs a Manager (or Owner)
--   > Rs 25,000       — must be ENTERED by Manager+, needs Owner
-- =====================================================================

revoke insert, update, delete on expenses from anon, authenticated;

-- ---------------------------------------------------------------------
-- RECORD EXPENSE
-- ---------------------------------------------------------------------
create or replace function record_expense(
  p_category_id uuid,
  p_amount_paisa bigint,
  p_payment_method payment_method default 'cash',
  p_vendor text default null,
  p_note text default null,
  p_receipt_url text default null,
  p_period_start date default null,
  p_period_end date default null
) returns json language plpgsql security definer set search_path = public as $$
declare
  v_staff staff;
  v_day business_days;
  v_shift shifts;
  v_required_role text;
  v_auto_approved boolean;
  v_expense expenses;
begin
  select * into v_staff from current_staff();
  if v_staff is null or v_staff.role not in ('owner','manager','supervisor') then
    raise exception 'PERM: only supervisor or above can record an expense';
  end if;
  if p_amount_paisa <= 0 then raise exception 'EXPENSE: amount must be > 0'; end if;

  -- Entry-level gate: who is even allowed to key in an expense this
  -- large, separate from who has to sign off on it afterward.
  if p_amount_paisa > 2500000 and v_staff.role not in ('owner','manager') then
    raise exception 'PERM: expenses over Rs 25,000 must be entered by a manager or owner';
  end if;

  -- Approval threshold (Part 14's table, in paisa: Rs 5,000 = 500000, Rs 25,000 = 2500000)
  if p_amount_paisa < 500000 then
    v_required_role := 'supervisor';
  elsif p_amount_paisa <= 2500000 then
    v_required_role := 'manager';
  else
    v_required_role := 'owner';
  end if;

  -- If the person entering it already holds (at least) the required
  -- role, their own entry IS the approval — no separate sign-off step
  -- for a manager entering their own Rs 10,000 expense. Anyone below
  -- the required tier leaves it pending (approved_by null) for
  -- approve_expense() to close out later.
  v_auto_approved := case v_required_role
    when 'supervisor' then true
    when 'manager'    then v_staff.role in ('owner','manager')
    when 'owner'      then v_staff.role = 'owner'
  end;

  select * into v_day from business_days
   where outlet_id = v_staff.outlet_id and status = 'open'
   order by opened_at desc limit 1;

  select * into v_shift from shifts
   where cashier_id = v_staff.id and closed_at is null
   order by opened_at desc limit 1;

  insert into expenses (outlet_id, business_day_id, shift_id, category_id, amount_paisa,
                        payment_method, vendor, note, receipt_url, period_start, period_end,
                        created_by, approved_by)
  values (v_staff.outlet_id, v_day.id, v_shift.id, p_category_id, p_amount_paisa,
          p_payment_method, p_vendor, p_note, p_receipt_url, p_period_start, p_period_end,
          v_staff.id, case when v_auto_approved then v_staff.id else null end)
  returning * into v_expense;

  insert into audit_log (outlet_id, actor_id, action, entity_type, entity_id, after)
  values (v_staff.outlet_id, v_staff.id, 'expense_recorded', 'expenses', v_expense.id,
          to_jsonb(v_expense));

  return to_jsonb(v_expense);
end $$;
revoke all on function record_expense(uuid, bigint, payment_method, text, text, text, date, date) from public;
grant execute on function record_expense(uuid, bigint, payment_method, text, text, text, date, date) to authenticated;

-- ---------------------------------------------------------------------
-- APPROVE EXPENSE — closes out an entry that was left pending because
-- whoever entered it didn't hold the required approval tier themselves.
-- ---------------------------------------------------------------------
create or replace function approve_expense(p_expense_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_staff staff; v_expense expenses;
begin
  select * into v_staff from current_staff();
  if v_staff is null or v_staff.role not in ('owner','manager') then
    raise exception 'PERM: only manager or owner can approve an expense';
  end if;

  select * into v_expense from expenses where id = p_expense_id and outlet_id = v_staff.outlet_id;
  if v_expense is null then raise exception 'EXPENSE: not found'; end if;
  if v_expense.approved_by is not null then raise exception 'EXPENSE: already approved'; end if;

  if v_expense.amount_paisa > 2500000 and v_staff.role <> 'owner' then
    raise exception 'PERM: expenses over Rs 25,000 require Owner approval';
  end if;

  update expenses set approved_by = v_staff.id where id = p_expense_id;

  insert into audit_log (outlet_id, actor_id, action, entity_type, entity_id, after)
  values (v_expense.outlet_id, v_staff.id, 'expense_approved', 'expenses', p_expense_id,
          jsonb_build_object('approved_by', v_staff.id));
end $$;
revoke all on function approve_expense(uuid) from public;
grant execute on function approve_expense(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- UPDATE EXPENSE — owner/manager only, open day only, full before/after
-- in audit_log.
-- ---------------------------------------------------------------------
create or replace function update_expense(
  p_expense_id uuid,
  p_amount_paisa bigint,
  p_payment_method payment_method,
  p_vendor text,
  p_note text,
  p_receipt_url text,
  p_period_start date,
  p_period_end date
) returns void language plpgsql security definer set search_path = public as $$
declare v_staff staff; v_before expenses; v_day business_days;
begin
  select * into v_staff from current_staff();
  if v_staff is null or v_staff.role not in ('owner','manager') then
    raise exception 'PERM: only owner or manager can edit an expense';
  end if;
  if p_amount_paisa <= 0 then raise exception 'EXPENSE: amount must be > 0'; end if;

  select * into v_before from expenses where id = p_expense_id and outlet_id = v_staff.outlet_id;
  if v_before is null then raise exception 'EXPENSE: not found'; end if;

  select * into v_day from business_days where id = v_before.business_day_id;
  if v_day is null or v_day.status <> 'open' then
    raise exception 'DAY: closed — cannot edit this expense';
  end if;

  update expenses set
    amount_paisa   = p_amount_paisa,
    payment_method = p_payment_method,
    vendor         = p_vendor,
    note           = p_note,
    receipt_url    = p_receipt_url,
    period_start   = p_period_start,
    period_end     = p_period_end
  where id = p_expense_id;

  insert into audit_log (outlet_id, actor_id, action, entity_type, entity_id, before, after)
  values (v_staff.outlet_id, v_staff.id, 'expense_updated', 'expenses', p_expense_id,
          to_jsonb(v_before),
          jsonb_build_object(
            'amount_paisa', p_amount_paisa, 'payment_method', p_payment_method,
            'vendor', p_vendor, 'note', p_note, 'receipt_url', p_receipt_url,
            'period_start', p_period_start, 'period_end', p_period_end
          ));
end $$;
revoke all on function update_expense(uuid, bigint, payment_method, text, text, text, date, date) from public;
grant execute on function update_expense(uuid, bigint, payment_method, text, text, text, date, date) to authenticated;

-- ---------------------------------------------------------------------
-- DELETE EXPENSE — owner only, open day only. A real DELETE (unlike
-- menu items/orders elsewhere in this app) — the brief's own "yeh mat
-- karna" list says "don't delete without a record," not "never delete,"
-- and the pre-existing reference RLS policy for this table was always a
-- genuine delete policy. The audit_log row (with the full pre-delete
-- state in `before`) IS that record.
-- ---------------------------------------------------------------------
create or replace function delete_expense(p_expense_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_staff staff; v_expense expenses; v_day business_days;
begin
  select * into v_staff from current_staff();
  if v_staff is null or v_staff.role <> 'owner' then
    raise exception 'PERM: only owner can delete an expense';
  end if;

  select * into v_expense from expenses where id = p_expense_id and outlet_id = v_staff.outlet_id;
  if v_expense is null then raise exception 'EXPENSE: not found'; end if;

  select * into v_day from business_days where id = v_expense.business_day_id;
  if v_day is null or v_day.status <> 'open' then
    raise exception 'DAY: closed — cannot delete this expense';
  end if;

  delete from expenses where id = p_expense_id;

  insert into audit_log (outlet_id, actor_id, action, entity_type, entity_id, before)
  values (v_staff.outlet_id, v_staff.id, 'expense_deleted', 'expenses', p_expense_id,
          to_jsonb(v_expense));
end $$;
revoke all on function delete_expense(uuid) from public;
grant execute on function delete_expense(uuid) to authenticated;

-- =====================================================================
-- Cup Shup POS — Part 18: Reports — functions
-- Not in the reference file; original to this project.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Records one print of an invoice — the actual thermal-printer call is
-- Part 19's job; this is the audit trail underneath it, built now so
-- Part 19 has somewhere to write to. Any authenticated staff member can
-- call this (printing a bill is a normal cashier task, not a
-- manager-only one) — what's restricted is who can READ the resulting
-- report (owner only, 0026_reports_schema.sql's select policy).
-- ---------------------------------------------------------------------
create or replace function record_invoice_print(p_order_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_staff staff; v_order orders; v_already_printed boolean;
begin
  select * into v_staff from current_staff();
  if v_staff is null then raise exception 'AUTH: not a staff member'; end if;

  select * into v_order from orders where id = p_order_id;
  if v_order is null then raise exception 'ORDER: not found'; end if;

  select exists(select 1 from invoice_prints where order_id = p_order_id) into v_already_printed;

  insert into invoice_prints (order_id, printed_by, is_reprint)
  values (p_order_id, v_staff.id, v_already_printed);

  insert into audit_log (outlet_id, actor_id, action, entity_type, entity_id, after)
  values (v_order.outlet_id, v_staff.id,
          case when v_already_printed then 'invoice_reprint' else 'invoice_print' end,
          'orders', p_order_id, jsonb_build_object('is_reprint', v_already_printed));
end $$;
revoke all on function record_invoice_print(uuid) from public;
grant execute on function record_invoice_print(uuid) to authenticated;

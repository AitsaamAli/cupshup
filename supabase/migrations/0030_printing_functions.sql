-- =====================================================================
-- Cup Shup POS — Part 19: Printing & PRA Invoice — functions
-- Not in the reference file; original to this project.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Redefined from Part 18 (see 0029_printing_schema.sql) — now returns
-- the print's own 1-indexed sequence number for this order (1 = the
-- first print, 2 = the first reprint, ...) so the client can render
-- "REPRINT #N" on the ticket it's about to send to the printer, without
-- a second query. Any authenticated staff member may call this —
-- printing a bill isn't manager-only — but the resulting report
-- (reprint_summary, Part 18) stays owner-only.
-- ---------------------------------------------------------------------
create or replace function record_invoice_print(p_order_id uuid)
returns int language plpgsql security definer set search_path = public as $$
declare v_staff staff; v_order orders; v_prior_count int;
begin
  select * into v_staff from current_staff();
  if v_staff is null then raise exception 'AUTH: not a staff member'; end if;

  select * into v_order from orders where id = p_order_id;
  if v_order is null then raise exception 'ORDER: not found'; end if;

  select count(*) into v_prior_count from invoice_prints where order_id = p_order_id;

  insert into invoice_prints (order_id, printed_by, is_reprint)
  values (p_order_id, v_staff.id, v_prior_count > 0);

  insert into audit_log (outlet_id, actor_id, action, entity_type, entity_id, after)
  values (v_order.outlet_id, v_staff.id,
          case when v_prior_count > 0 then 'invoice_reprint' else 'invoice_print' end,
          'orders', p_order_id, jsonb_build_object('print_number', v_prior_count + 1));

  return v_prior_count + 1;
end $$;
revoke all on function record_invoice_print(uuid) from public;
grant execute on function record_invoice_print(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- Enqueues a PRA submission — idempotent per order: calling this twice
-- for the same order while a pending/failed row already exists returns
-- that SAME row rather than creating a duplicate (a flaky connection
-- retried from the client shouldn't fork the queue).
-- ---------------------------------------------------------------------
create or replace function enqueue_pra_submission(p_order_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_staff staff; v_order orders; v_id uuid;
begin
  select * into v_staff from current_staff();
  if v_staff is null then raise exception 'AUTH: not a staff member'; end if;

  select * into v_order from orders where id = p_order_id;
  if v_order is null then raise exception 'ORDER: not found'; end if;

  select id into v_id from pra_submission_queue
   where order_id = p_order_id and status in ('pending', 'failed')
   order by created_at desc limit 1;

  if v_id is not null then return v_id; end if;

  insert into pra_submission_queue (order_id) values (p_order_id) returning id into v_id;
  return v_id;
end $$;
revoke all on function enqueue_pra_submission(uuid) from public;
grant execute on function enqueue_pra_submission(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- Writes back what PRA actually returned. orders.pra_invoice_no /
-- pra_qr_payload / pra_synced_at have existed since Part 03 — this is
-- the first migration to ever write to them, exactly where Part 10 left
-- its own note pointing ("NOTE: transmit to PRA eIMS here", 0011_
-- settlement_functions.sql).
-- ---------------------------------------------------------------------
create or replace function record_pra_result(p_order_id uuid, p_pra_invoice_no text, p_qr_payload text)
returns void language plpgsql security definer set search_path = public as $$
declare v_staff staff; v_order orders;
begin
  select * into v_staff from current_staff();
  if v_staff is null then raise exception 'AUTH: not a staff member'; end if;

  update orders set
    pra_invoice_no = p_pra_invoice_no,
    pra_qr_payload = p_qr_payload,
    pra_synced_at  = now()
  where id = p_order_id
  returning * into v_order;
  if v_order is null then raise exception 'ORDER: not found'; end if;

  update pra_submission_queue set status = 'submitted', submitted_at = now()
   where order_id = p_order_id and status in ('pending', 'failed');

  insert into audit_log (outlet_id, actor_id, action, entity_type, entity_id, after)
  values (v_order.outlet_id, v_staff.id, 'pra_submitted', 'orders', p_order_id,
          jsonb_build_object('pra_invoice_no', p_pra_invoice_no));
end $$;
revoke all on function record_pra_result(uuid, text, text) from public;
grant execute on function record_pra_result(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------
-- Records a failed attempt and schedules the next one. The backoff
-- itself is computed here (not trusted from the client) so a
-- misbehaving client can't force a hot retry loop against PRA — capped
-- at 60 minutes between attempts, same ceiling
-- lib/pra.ts's nextRetryDelayMs() uses for its own client-side display,
-- kept in sync deliberately (see that function's own comment).
-- ---------------------------------------------------------------------
create or replace function record_pra_failure(p_queue_id uuid, p_error text)
returns void language plpgsql security definer set search_path = public as $$
declare v_staff staff; v_queue pra_submission_queue; v_order orders; v_attempts int;
begin
  select * into v_staff from current_staff();
  if v_staff is null then raise exception 'AUTH: not a staff member'; end if;

  select * into v_queue from pra_submission_queue where id = p_queue_id for update;
  if v_queue is null then raise exception 'QUEUE: not found'; end if;

  select * into v_order from orders where id = v_queue.order_id;

  v_attempts := v_queue.attempts + 1;

  update pra_submission_queue set
    status = 'failed',
    attempts = v_attempts,
    last_error = p_error,
    next_attempt_at = now() + (least(power(2, v_attempts), 60) * interval '1 minute')
  where id = p_queue_id;

  insert into audit_log (outlet_id, actor_id, action, entity_type, entity_id, after)
  values (v_order.outlet_id, v_staff.id, 'pra_submission_failed', 'orders', v_queue.order_id,
          jsonb_build_object('attempts', v_attempts, 'error', p_error));
end $$;
revoke all on function record_pra_failure(uuid, text) from public;
grant execute on function record_pra_failure(uuid, text) to authenticated;

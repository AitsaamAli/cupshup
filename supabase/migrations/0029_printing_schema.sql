-- =====================================================================
-- Cup Shup POS — Part 19: Printing & PRA Invoice — schema
-- Not in the reference file; original to this project.
-- =====================================================================

-- ---------------------------------------------------------------------
-- PRA submission queue — "internet down ho to local number par print
-- karo, queue mein daalo, connection aate hi bhejo aur reconcile karo."
-- A row here means "this order's invoice hasn't been confirmed by PRA
-- yet" — created on a failed/unreachable submission attempt, and
-- resolved (deleted's cousin: marked 'submitted') once
-- record_pra_result() succeeds. Printing the customer's receipt never
-- waits on this table — the receipt prints immediately with the local
-- invoice_no either way (0030_printing_functions.sql).
-- ---------------------------------------------------------------------
create type pra_submission_status as enum ('pending', 'failed', 'submitted');

create table pra_submission_queue (
  id             uuid primary key default gen_random_uuid(),
  order_id       uuid not null references orders(id) on delete cascade,
  status         pra_submission_status not null default 'pending',
  attempts       int not null default 0,
  last_error     text,
  -- Exponential backoff target — a reconcile pass only retries rows
  -- where this has already passed, so a flaky connection doesn't get
  -- hammered every few seconds (lib/pra.ts's nextRetryDelayMs()).
  next_attempt_at timestamptz not null default now(),
  created_at     timestamptz not null default now(),
  submitted_at   timestamptz
);
create index on pra_submission_queue (order_id);
create index on pra_submission_queue (status, next_attempt_at);

alter table pra_submission_queue enable row level security;

-- Read side: owner/manager/supervisor — same tier as the rest of this
-- outlet's operational/accountability data, not owner-exclusive (this
-- is "is this invoice stuck", not a per-person fraud report).
create policy read_pra_queue on pra_submission_queue for select
  using (has_role('owner', 'manager', 'supervisor')
         and exists (select 1 from orders o where o.id = order_id and o.outlet_id = my_outlet()));

-- Write side: RPC only (0030_printing_functions.sql) — same reasoning
-- as every other accountability-adjacent table in this project
-- (Part 17's KDS functions, Part 18's invoice_prints).
revoke insert, update, delete on pra_submission_queue from anon, authenticated;

-- ---------------------------------------------------------------------
-- record_invoice_print() (Part 18, 0027_reports_functions.sql) returned
-- void — this part needs the print's own sequence number back
-- immediately, to print "REPRINT #2" on the receipt itself rather than
-- a second round trip. Postgres won't let `create or replace` change a
-- function's return type, so the old version is dropped here and
-- redefined in 0030_printing_functions.sql. invoice_prints itself
-- (the table) is unchanged — Part 18's reprint_summary report still
-- reads the exact same rows.
-- ---------------------------------------------------------------------
drop function if exists record_invoice_print(uuid);

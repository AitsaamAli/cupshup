-- =====================================================================
-- Cup Shup POS — Part 18: Reports, Dashboard & Master P&L — schema
-- Two additions, neither in the reference file:
--   1. expense_categories.is_labour_cost — labour cost % (Master P&L §f)
--      needs to know WHICH expense categories are payroll, not just sum
--      everything. A name match against 'Salaries'/'Daily Wages' would
--      silently break the day someone renames a category or adds
--      'Overtime' — an explicit flag doesn't.
--   2. invoice_prints — reprint tracking (Master P&L §e) has nothing to
--      report from yet: actual printing is Part 19's job. This is the
--      same forward-declaration this project has done before (Part 09
--      built useIncomingOrders() before Part 17 had a KDS screen to
--      feed) — the table and its write path exist now so Part 19 only
--      has to call record_invoice_print() from wherever it puts the
--      Print button, not design a new audit trail at the same time.
-- =====================================================================

alter table expense_categories add column is_labour_cost boolean not null default false;
update expense_categories set is_labour_cost = true where name in ('Salaries', 'Daily Wages');

create table invoice_prints (
  id          uuid primary key default gen_random_uuid(),
  order_id    uuid not null references orders(id) on delete cascade,
  printed_by  uuid references staff(id),
  -- true when this order already had at least one earlier print row —
  -- set by record_invoice_print(), never by the client, so it can't be
  -- spoofed to hide a reprint pattern.
  is_reprint  boolean not null default false,
  printed_at  timestamptz not null default now()
);
create index on invoice_prints (order_id);

alter table invoice_prints enable row level security;

-- Read side matches the rest of this part's per-person accountability
-- reports (cash/void by cashier) — owner only. Write side has no policy
-- at all (see the revoke below): every print goes through
-- record_invoice_print() (0027_reports_functions.sql), same reasoning
-- as Part 17's KDS functions — a plain per-role RLS policy on a table
-- whose writes are revoked from anon/authenticated can never actually
-- fire over the API, so there's no point writing one here.
create policy owner_reads_invoice_prints on invoice_prints for select
  using (has_role('owner') and exists (
    select 1 from orders o where o.id = order_id and o.outlet_id = my_outlet()
  ));

revoke insert, update, delete on invoice_prints from anon, authenticated;

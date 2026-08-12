-- =====================================================================
-- Cup Shup POS — Supplier Payables
-- Part 12: "kis supplier ka kitna udhaar hai." security_invoker is set
-- from the start here — Part 11 found the hard way (ingredient_stock)
-- that a plain view silently bypasses RLS for every caller, since it
-- runs with the migration role's BYPASSRLS exemption rather than the
-- querying user's.
-- =====================================================================

create or replace view supplier_payables
with (security_invoker = true)
as
select
  s.id as supplier_id,
  s.outlet_id,
  s.name,
  s.active,
  coalesce(sum(p.total_paisa - p.amount_paid_paisa)
           filter (where p.payment_status <> 'paid'), 0) as payable_paisa,
  count(*) filter (where p.payment_status <> 'paid') as open_invoices,
  max(p.created_at) as last_purchase_at
from suppliers s
left join purchases p on p.supplier_id = s.id
group by s.id;

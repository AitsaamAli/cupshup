-- =====================================================================
-- Cup Shup POS — Storage bucket for purchase invoice photos
-- Part 12. Private (not public like menu-images, Part 08) — an invoice
-- can show supplier pricing/terms an outlet may not want publicly
-- readable. Read/write both restricted to owner/manager, matching who
-- can record a purchase at all (0016_purchases_functions.sql).
-- =====================================================================

insert into storage.buckets (id, name, public)
values ('purchase-invoices', 'purchase-invoices', false)
on conflict (id) do nothing;

create policy purchase_invoices_owner_manager_read on storage.objects
  for select using (bucket_id = 'purchase-invoices' and has_role('owner','manager'));

create policy purchase_invoices_owner_manager_write on storage.objects
  for insert with check (bucket_id = 'purchase-invoices' and has_role('owner','manager'));

create policy purchase_invoices_owner_manager_update on storage.objects
  for update using (bucket_id = 'purchase-invoices' and has_role('owner','manager'));

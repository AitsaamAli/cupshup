-- =====================================================================
-- Cup Shup POS — Second-wave audit: storage bucket outlet scoping
-- =====================================================================
-- purchase-invoices (0018/Part 12) and expense-receipts (0022/Part 14)
-- are both PRIVATE buckets whose RLS policies checked ROLE only
-- (`has_role('owner','manager')` / `has_role('owner','manager',
-- 'supervisor')`) with no outlet dimension at all — the storage
-- equivalent of the same gap fixed for tables in 0036/0037. Any
-- owner/manager (or supervisor, for receipts) anywhere could list/read/
-- upload/overwrite ANY outlet's private purchase-invoice or expense-
-- receipt photos: real financial documents, not metadata.
--
-- Object paths didn't previously carry an outlet segment at all
-- (`${supplierId}/...`, `${categoryId}/...` — see app/manage/purchases/
-- page.tsx and app/manage/expenses/page.tsx before this fix), so there
-- was nothing in the object's own name for a policy to check against.
-- Fixed on both sides together: the app now uploads under
-- `${outletId}/...`, and the policy below requires that first path
-- segment to equal the caller's own outlet. Objects uploaded before this
-- fix (if any — this project has not gone live yet) won't match either
-- the old or new path convention's owner and become unreachable through
-- these policies; that's a fail-closed, not fail-open, consequence and
-- is the correct behaviour for a fix closing a cross-tenant leak.
-- =====================================================================

drop policy purchase_invoices_owner_manager_read on storage.objects;
create policy purchase_invoices_owner_manager_read on storage.objects
  for select using (
    bucket_id = 'purchase-invoices' and has_role('owner','manager')
    and (storage.foldername(name))[1] = my_outlet()::text
  );

drop policy purchase_invoices_owner_manager_write on storage.objects;
create policy purchase_invoices_owner_manager_write on storage.objects
  for insert with check (
    bucket_id = 'purchase-invoices' and has_role('owner','manager')
    and (storage.foldername(name))[1] = my_outlet()::text
  );

drop policy purchase_invoices_owner_manager_update on storage.objects;
create policy purchase_invoices_owner_manager_update on storage.objects
  for update using (
    bucket_id = 'purchase-invoices' and has_role('owner','manager')
    and (storage.foldername(name))[1] = my_outlet()::text
  );

drop policy expense_receipts_read on storage.objects;
create policy expense_receipts_read on storage.objects
  for select using (
    bucket_id = 'expense-receipts' and has_role('owner','manager','supervisor')
    and (storage.foldername(name))[1] = my_outlet()::text
  );

drop policy expense_receipts_write on storage.objects;
create policy expense_receipts_write on storage.objects
  for insert with check (
    bucket_id = 'expense-receipts' and has_role('owner','manager','supervisor')
    and (storage.foldername(name))[1] = my_outlet()::text
  );

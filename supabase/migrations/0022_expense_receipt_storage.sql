-- =====================================================================
-- Cup Shup POS — Storage bucket for expense receipt photos
-- Part 14. Private (like purchase-invoices, Part 12) — a receipt can
-- show vendor pricing an outlet may not want publicly readable. Read/
-- write open to supervisor+ (matches who can record an expense at all,
-- 0020_expenses_functions.sql), unlike purchase-invoices which was
-- owner/manager only since only they can record a GRN.
-- =====================================================================

insert into storage.buckets (id, name, public)
values ('expense-receipts', 'expense-receipts', false)
on conflict (id) do nothing;

create policy expense_receipts_read on storage.objects
  for select using (bucket_id = 'expense-receipts' and has_role('owner','manager','supervisor'));

create policy expense_receipts_write on storage.objects
  for insert with check (bucket_id = 'expense-receipts' and has_role('owner','manager','supervisor'));

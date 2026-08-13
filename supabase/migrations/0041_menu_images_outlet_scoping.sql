-- =====================================================================
-- Cup Shup POS — Third-wave audit: menu-images bucket write scoping
-- =====================================================================
-- Finding T (docs/security-audit-2026-08-14-third-wave.md §E): building
-- the full storage matrix the user required — not stopping at the two
-- buckets already flagged in the second wave — found `menu-images`'
-- write policies had the exact same role-only gap as `purchase-invoices`
-- and `expense-receipts` did: any owner/manager could overwrite or
-- delete ANY outlet's menu photo, not just their own.
--
-- Different in kind from the 0038 fix, not just a copy: this bucket is
-- `public: true` by design (menu photos render without an auth header,
-- 0009_menu_storage.sql's own header) — so only INSERT/UPDATE/DELETE get
-- an outlet-path check here; SELECT stays fully public, unchanged.
-- Paired with lib/storage.ts now prefixing uploads with the outlet id.
-- =====================================================================

drop policy menu_images_owner_manager_write on storage.objects;
create policy menu_images_owner_manager_write on storage.objects
  for insert with check (
    bucket_id = 'menu-images' and has_role('owner','manager')
    and (storage.foldername(name))[1] = my_outlet()::text
  );

drop policy menu_images_owner_manager_update on storage.objects;
create policy menu_images_owner_manager_update on storage.objects
  for update using (
    bucket_id = 'menu-images' and has_role('owner','manager')
    and (storage.foldername(name))[1] = my_outlet()::text
  );

drop policy menu_images_owner_manager_delete on storage.objects;
create policy menu_images_owner_manager_delete on storage.objects
  for delete using (
    bucket_id = 'menu-images' and has_role('owner','manager')
    and (storage.foldername(name))[1] = my_outlet()::text
  );

-- =====================================================================
-- Cup Shup POS — Storage bucket for menu item photos
-- Part 08. Public read (menu images render on-screen for staff and
-- customers without an auth header — nothing sensitive about a photo of
-- a burger); writes restricted to owner/manager, matching who's allowed
-- to edit the menu itself (0005_menu_functions.sql).
-- =====================================================================

insert into storage.buckets (id, name, public)
values ('menu-images', 'menu-images', true)
on conflict (id) do nothing;

create policy menu_images_public_read on storage.objects
  for select using (bucket_id = 'menu-images');

create policy menu_images_owner_manager_write on storage.objects
  for insert with check (bucket_id = 'menu-images' and has_role('owner','manager'));

create policy menu_images_owner_manager_update on storage.objects
  for update using (bucket_id = 'menu-images' and has_role('owner','manager'));

create policy menu_images_owner_manager_delete on storage.objects
  for delete using (bucket_id = 'menu-images' and has_role('owner','manager'));

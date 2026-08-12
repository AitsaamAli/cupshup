-- =====================================================================
-- Cup Shup POS — Dining Tables Seed
-- Part 16. dining_tables existed since Part 03 but was never seeded —
-- the table picker built in this part needs something to show. A
-- dedicated table-management screen (add/remove/rename tables) isn't
-- part of this part's brief, so this is a reasonable starting layout
-- for a single outlet; more can be added the same way (or a future
-- part can build a proper CRUD screen) without any code change here.
-- =====================================================================

insert into dining_tables (outlet_id, label, seats, zone) values
  ('00000000-0000-0000-0000-000000000001', 'T1', 2, 'Indoor'),
  ('00000000-0000-0000-0000-000000000001', 'T2', 2, 'Indoor'),
  ('00000000-0000-0000-0000-000000000001', 'T3', 4, 'Indoor'),
  ('00000000-0000-0000-0000-000000000001', 'T4', 4, 'Indoor'),
  ('00000000-0000-0000-0000-000000000001', 'T5', 4, 'Indoor'),
  ('00000000-0000-0000-0000-000000000001', 'T6', 6, 'Indoor'),
  ('00000000-0000-0000-0000-000000000001', 'T7', 2, 'Outdoor'),
  ('00000000-0000-0000-0000-000000000001', 'T8', 2, 'Outdoor'),
  ('00000000-0000-0000-0000-000000000001', 'T9', 4, 'Outdoor'),
  ('00000000-0000-0000-0000-000000000001', 'T10', 6, 'Outdoor')
on conflict (outlet_id, label) do nothing;

-- =====================================================================
-- Cup Shup POS — Part 20. Enables pgTAP for supabase/tests/database/*.sql.
-- Installed into the `extensions` schema, Supabase's own standing
-- convention for keeping extension objects out of `public` — the same
-- schema `pgcrypto` (0001_schema.sql) and every other Supabase-managed
-- extension already lives in on this project.
-- =====================================================================

create extension if not exists pgtap with schema extensions;

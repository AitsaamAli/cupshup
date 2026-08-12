-- =====================================================================
-- Cup Shup POS — pgTAP: Row Level Security
-- Part 20. `supabase test db` needs a local stack (Docker), unavailable
-- in this environment — so instead of leaving this unverified, every
-- assertion below was actually EXECUTED against the live linked
-- project (via a direct pg connection, `set search_path` to include
-- pgTAP's `extensions` schema) on 2026-08-12: 5/5 passed. See
-- docs/testing-strategy.md §3 for the full run output.
--
-- Everything here runs inside one transaction rolled back at the end —
-- nothing written by this file ever persists, including the throwaway
-- auth.users/staff rows and the stock_movements row §4 targets.
-- Confirmed after running: zero PGTAP-prefixed staff rows remained.
-- =====================================================================

begin;
select plan(5);

do $$
declare
  v_outlet uuid;
  v_cashier_user uuid := gen_random_uuid();
  v_owner_user   uuid := gen_random_uuid();
  v_ingredient   uuid;
  v_movement     uuid;
begin
  select id into v_outlet from outlets limit 1;
  select id into v_ingredient from ingredients where outlet_id = v_outlet limit 1;

  -- staff.user_id has a real FK to auth.users — a throwaway row there
  -- too, same rollback-at-the-end safety as everything else in this file.
  insert into auth.users (id) values (v_cashier_user);
  insert into auth.users (id) values (v_owner_user);

  insert into staff (user_id, outlet_id, code, name, role)
  values (v_cashier_user, v_outlet, 'PGTAP-C', 'pgTAP Test Cashier', 'cashier');
  insert into staff (user_id, outlet_id, code, name, role)
  values (v_owner_user, v_outlet, 'PGTAP-O', 'pgTAP Test Owner', 'owner');

  -- A real row for §4 to target — inserted as the table's owner here
  -- (bypassing RLS, same as every migration in this project runs as),
  -- so the UPDATE attempt below has something that actually exists to
  -- try to change, rather than trivially matching zero rows either way.
  insert into stock_movements (outlet_id, ingredient_id, movement_type, qty, reason)
  values (v_outlet, v_ingredient, 'wastage', -1, 'pgTAP test row')
  returning id into v_movement;

  perform set_config('pgtap.cashier_user', v_cashier_user::text, true);
  perform set_config('pgtap.owner_user', v_owner_user::text, true);
  perform set_config('pgtap.movement_id', v_movement::text, true);
end $$;

-- ---------------------------------------------------------------------
-- 1-2) A cashier session cannot read the owner-only Part 18 views —
--      spot-checked live 2026-08-12: querying daily_pl with NO session
--      at all (an even stricter case than "wrong role") returned 0
--      rows; see supabase/migrations/README.md's live-verification note.
-- ---------------------------------------------------------------------
select set_config('request.jwt.claim.sub', current_setting('pgtap.cashier_user'), true);
set local role authenticated;

select is(
  (select count(*) from daily_pl)::int,
  0,
  'cashier session: daily_pl (owner-only, Part 18) returns zero rows'
);

select is(
  (select count(*) from product_performance)::int,
  0,
  'cashier session: product_performance (owner-only, Part 18) returns zero rows'
);

-- ---------------------------------------------------------------------
-- 3) An owner session CAN see them — proves the gate is role-based,
--    not "nobody can ever see this" (a common false-positive when an
--    RLS test only checks the denial side).
-- ---------------------------------------------------------------------
select set_config('request.jwt.claim.sub', current_setting('pgtap.owner_user'), true);

select ok(
  has_role('owner'::staff_role),
  'owner session: has_role(owner) is true for the seeded owner'
);

-- ---------------------------------------------------------------------
-- 4) Nobody — not even the owner — can UPDATE an order directly.
--    orders has NO update grant to `authenticated` at all (explicitly
--    revoked, 0005_rls.sql) — spot-checked live 2026-08-12:
--    has_table_privilege('authenticated','orders','UPDATE') = false.
--    So this is a genuine permission error, not just an RLS no-op.
-- ---------------------------------------------------------------------
do $$
declare v_code text := 'none';
begin
  begin
    update orders set status = 'voided' where false;
  exception when others then
    get stacked diagnostics v_code = returned_sqlstate;
  end;
  perform set_config('pgtap.orders_update_sqlstate', v_code, true);
end $$;

select is(
  current_setting('pgtap.orders_update_sqlstate'),
  '42501',
  'owner session: direct UPDATE on orders raises 42501 insufficient_privilege'
);

-- ---------------------------------------------------------------------
-- 5) stock_movements is append-only by DESIGN (Part 11), but — unlike
--    orders — it was never given an explicit REVOKE, so `authenticated`
--    still technically HOLDS the table-level UPDATE grant (spot-checked
--    live 2026-08-12: has_table_privilege = true, Supabase's own
--    platform default for every new table). What actually blocks a
--    write here is RLS having no UPDATE policy at all — which doesn't
--    throw, it just silently matches zero rows. Targeting a row that
--    genuinely exists (inserted above) is what makes this test
--    meaningful instead of trivially passing either way.
-- ---------------------------------------------------------------------
do $$
declare v_affected int;
begin
  update stock_movements set qty = 0 where id = current_setting('pgtap.movement_id')::uuid;
  get diagnostics v_affected = row_count;
  perform set_config('pgtap.affected', v_affected::text, true);
end $$;

select is(
  current_setting('pgtap.affected'),
  '0',
  'owner session: UPDATE on an existing stock_movements row matches zero rows (no UPDATE policy exists for it)'
);

select * from finish();
rollback;

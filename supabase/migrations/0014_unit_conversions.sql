-- =====================================================================
-- Cup Shup POS — Unit Conversions
-- Part 11. Named explicitly in the brief ("cheese kg mein khareedte
-- hain, recipe gram mein"), though worth being clear about what this
-- table does and doesn't solve:
--
-- The schema already sidesteps the core problem WITHOUT this table.
-- recipe_lines.qty and stock_movements.qty are both `numeric(12,4)`, in
-- the ingredient's own `unit` (0001_schema.sql) — so "150ml of milk" for
-- an ingredient tracked in Litres is simply stored as the decimal 0.150,
-- and "5g of tea" for a kg-tracked ingredient is 0.005. The already-seeded
-- Karak Chai recipe (0006_seed.sql) already does exactly this. No
-- conversion math is REQUIRED for the ledger/recipe math to be correct.
--
-- What this table adds is a UI convenience: letting a form accept "50g"
-- and convert it to 0.050 for a kg-tracked ingredient, instead of asking
-- staff to always do the decimal math themselves. Purely additive —
-- nothing above depends on it existing.
-- =====================================================================

create table unit_conversions (
  id         uuid primary key default gen_random_uuid(),
  from_unit  text not null,
  to_unit    text not null,
  factor     numeric not null check (factor > 0),  -- 1 from_unit = factor * to_unit
  unique (from_unit, to_unit)
);
comment on table unit_conversions is
  'UI convenience only — lets an input form accept "50g" for a kg-tracked ingredient and convert it. The ledger itself never needs conversion: every qty is already stored as a decimal fraction of the ingredient''s own unit.';

insert into unit_conversions (from_unit, to_unit, factor) values
  ('kg', 'g', 1000),
  ('g', 'kg', 0.001),
  ('L', 'ml', 1000),
  ('ml', 'L', 0.001);

alter table unit_conversions enable row level security;
create policy read_unit_conversions on unit_conversions for select using (auth.uid() is not null);
-- No write policy from the client: this is fixed reference data (metric
-- conversions don't change), maintained by migration like tax_rates'
-- history, not edited through the app.

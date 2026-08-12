-- =====================================================================
-- Cup Shup POS — Stock Variance View
-- Part 11: "yeh sabse ahem screen hai." This is a subset of the
-- project's full reference 0002_functions.sql — that file bundles
-- stock_variance together with daily_pl/product_performance (Part 18's
-- reporting views), but Part 11's own brief explicitly names this
-- report and gives its formula, so it's extracted now rather than
-- waiting for Part 18. Same "safe because it has zero forward
-- dependency" reasoning as every other early extraction — see
-- supabase/migrations/README.md.
--
-- One addition beyond the reference definition: unexplained_variance_paisa,
-- converting the count_adjustment quantity into rupees using each
-- ingredient's own moving_avg_cost_paisa — Part 11's brief explicitly
-- asks for the variance in rupees ("Rupees mein bhi dikhao"), which the
-- reference view (written with Part 18's needs in mind) didn't include.
--
-- SECURITY NOTE — a real finding, not hypothetical: a plain `create
-- view` is owned by whichever role runs the migration (Supabase's
-- migration runner, which has BYPASSRLS). Postgres applies RLS using
-- the VIEW OWNER's exemption in that case, not the querying user's —
-- meaning a plain view here would silently show every outlet's stock
-- data to any authenticated staff member, not just their own,
-- contradicting this project's own outlet-scoping rule (docs/
-- architecture.md rule #5). `security_invoker = true` (Postgres 15+)
-- fixes this: the view then evaluates RLS as the actual querying user,
-- correctly filtered by read_ingredients/read_movements (Part 04). This
-- migration also retroactively fixes ingredient_stock (Part 03's
-- reference view), which has the exact same latent issue — currently
-- invisible only because this deployment has a single outlet.
-- =====================================================================

create or replace view stock_variance
with (security_invoker = true)
as
select
  i.id as ingredient_id,
  i.outlet_id,
  i.name,
  i.unit,
  i.moving_avg_cost_paisa,
  -- Theoretical use: how much SHOULD have been consumed, per the
  -- recipe, based on what actually sold (settle_order()'s own
  -- 'sale_depletion' movements).
  coalesce(sum(m.qty) filter (where m.movement_type = 'sale_depletion'), 0) as theoretical_used,
  -- Declared loss: shrinkage staff actually reported (wastage + staff meals).
  coalesce(sum(m.qty) filter (where m.movement_type in ('wastage','staff_meal')), 0) as declared_loss,
  -- Every physical-count correction ever recorded for this ingredient.
  -- Each one already IS "counted minus what the ledger expected" at
  -- that moment (record_stock_count(), 0012_inventory_functions.sql) —
  -- summed over time, this is the running unexplained variance.
  coalesce(sum(m.qty) filter (where m.movement_type = 'count_adjustment'), 0) as count_adjustment,
  coalesce(sum(m.qty), 0) as current_stock,
  round(
    coalesce(sum(m.qty) filter (where m.movement_type = 'count_adjustment'), 0)
    * i.moving_avg_cost_paisa
  )::bigint as unexplained_variance_paisa
from ingredients i
left join stock_movements m on m.ingredient_id = i.id
group by i.id;

-- Same visibility as the rest of inventory reporting (Part 04's
-- read_movements policy already scopes stock_movements by outlet_id;
-- this view inherits that through its join, now that it's
-- security_invoker). No separate grant needed beyond what a normal
-- authenticated staff member already has.

-- Retroactive fix for the same issue on Part 03's ingredient_stock view.
alter view ingredient_stock set (security_invoker = true);

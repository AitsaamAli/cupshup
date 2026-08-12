-- =====================================================================
-- Cup Shup POS — Part 18: Reports, Dashboard & Master P&L — views
--
-- All plain views (not materialised), all `security_invoker = true`
-- (the standing rule since Part 11's ingredient_stock finding). The
-- brief's own performance note suggests materialised views — deliberately
-- NOT done here: a materialised view needs something to refresh it
-- (pg_cron, or a manual button), and this project has neither Docker nor
-- pg_cron available in this environment to schedule one. Every table
-- these views read is already indexed on the join columns that matter
-- (business_day_id, order_id — see 0001_schema.sql), so a plain view at
-- this outlet's actual data volume is fast enough; the day this stops
-- being true, a materialised view + pg_cron refresh is the fix, not a
-- reason to add operational complexity today for a problem that isn't
-- here yet.
--
-- OWNER-ONLY VIEWS — a real gate, not just a UI one. Postgres RLS
-- policies attach to TABLES, not views, and every authenticated staff
-- session shares the one `authenticated` Postgres role — so `grant`/
-- `revoke` alone can never distinguish "owner" from "cashier" the way
-- the brief's "P&L sirf Owner ko (RLS + PIN dono se)" demands. The
-- reference file's own `revoke all ... ; grant select ... to
-- authenticated` for daily_pl/product_performance/stock_variance
-- (0005_rls.sql, still commented out) would NOT have achieved that — it
-- only blocks anon, not other staff roles. Every view below that's
-- meant to be owner-exclusive instead embeds `and has_role('owner')`
-- directly in its WHERE clause: has_role() reads the querying session's
-- own auth.uid() (same as every RLS policy already does), so a non-owner
-- querying the view — whether through this app's UI or a raw REST call —
-- gets zero rows back, not just a hidden button.
--
-- Split: aggregate totals (revenue, gross profit, tax) are manager+
-- (owner/manager/supervisor) — the Dashboard's own audience, and the
-- brief's Dashboard table already includes "Net profit" and "Asli gross
-- profit" for that tier. What's owner-only is anything that's PER-ITEM
-- margin (reveals exact recipe costing), PER-PERSON (cash/void
-- accountability, reprints), or otherwise strategic (labour cost %,
-- ingredient cost trend) — matching exactly which reports the brief
-- lists under "Master P&L (sirf Owner)" vs. "Dashboard (Manager)".
-- =====================================================================

-- ---------------------------------------------------------------------
-- DAILY P&L — manager+. Reference shape (0002_functions.sql), extended
-- with voided_value_paisa for the Dashboard's "void count aur value"
-- tile — the reference only counted voided orders, not their value.
-- ---------------------------------------------------------------------
create or replace view daily_pl
with (security_invoker = true)
as
select o.outlet_id, bd.business_date,
       count(*) filter (where o.status = 'settled')                                as orders,
       coalesce(sum(o.subtotal_paisa - o.discount_paisa) filter (where o.status='settled'), 0) as revenue_paisa,
       coalesce(sum(o.cogs_paisa) filter (where o.status='settled'), 0)            as cogs_paisa,
       coalesce(sum(o.tax_paisa) filter (where o.status='settled'), 0)             as tax_paisa,
       coalesce(sum(o.subtotal_paisa - o.discount_paisa - o.cogs_paisa)
                filter (where o.status='settled'), 0)                              as gross_profit_paisa,
       count(*) filter (where o.status = 'voided')                                 as voided_orders,
       coalesce(sum(o.total_paisa) filter (where o.status = 'voided'), 0)          as voided_value_paisa
from orders o
join business_days bd on bd.id = o.business_day_id
where has_role('owner', 'manager', 'supervisor')
group by o.outlet_id, bd.business_date;

-- ---------------------------------------------------------------------
-- MENU ENGINEERING — owner-only. Reference shape, unchanged formula:
-- real per-item margin from unit_cost_paisa, the exact fix for the old
-- flat-40%-profit-rate bug this whole part exists to correct.
-- ---------------------------------------------------------------------
create or replace view product_performance
with (security_invoker = true)
as
select o.outlet_id, bd.business_date, oi.menu_item_id, oi.name_snapshot,
       sum(oi.qty)                                                    as qty,
       sum(oi.line_total_paisa)                                       as revenue_paisa,
       sum(round(oi.unit_cost_paisa * oi.qty))                        as cogs_paisa,
       sum(oi.line_total_paisa - round(oi.unit_cost_paisa * oi.qty))  as margin_paisa
from order_items oi
join orders o on o.id = oi.order_id
join business_days bd on bd.id = o.business_day_id
where o.status = 'settled' and oi.status <> 'voided' and has_role('owner')
group by o.outlet_id, bd.business_date, oi.menu_item_id, oi.name_snapshot;

-- ---------------------------------------------------------------------
-- Manager-tier revenue breakdown, without cost/margin — the "top items"
-- and "category revenue" Dashboard charts. Deliberately a separate view
-- from product_performance rather than the same one with a wider grant:
-- revenue alone is far less sensitive than the exact margin percentage,
-- which reveals this outlet's real recipe costing.
-- ---------------------------------------------------------------------
create or replace view item_revenue_daily
with (security_invoker = true)
as
select o.outlet_id, bd.business_date, oi.menu_item_id, oi.name_snapshot,
       sum(oi.qty)              as qty,
       sum(oi.line_total_paisa) as revenue_paisa
from order_items oi
join orders o on o.id = oi.order_id
join business_days bd on bd.id = o.business_day_id
where o.status = 'settled' and oi.status <> 'voided' and has_role('owner', 'manager', 'supervisor')
group by o.outlet_id, bd.business_date, oi.menu_item_id, oi.name_snapshot;

create or replace view category_revenue_daily
with (security_invoker = true)
as
select o.outlet_id, bd.business_date, mc.id as category_id, mc.name as category_name,
       sum(oi.qty)              as qty,
       sum(oi.line_total_paisa) as revenue_paisa
from order_items oi
join orders o on o.id = oi.order_id
join business_days bd on bd.id = o.business_day_id
join menu_items mi on mi.id = oi.menu_item_id
join menu_categories mc on mc.id = mi.category_id
where o.status = 'settled' and oi.status <> 'voided' and has_role('owner', 'manager', 'supervisor')
group by o.outlet_id, bd.business_date, mc.id, mc.name;

-- ---------------------------------------------------------------------
-- HOURLY SALES — the staffing heatmap. Hour is extracted in the
-- outlet's own timezone (same source outlets.timezone that
-- business_date_of() uses, Part 06) so the heatmap lines up with when
-- staff actually experienced the rush, not UTC.
-- ---------------------------------------------------------------------
create or replace view hourly_sales
with (security_invoker = true)
as
select o.outlet_id, bd.business_date,
       extract(hour from o.created_at at time zone ot.timezone)::int as hour_of_day,
       count(*)                                                      as orders,
       coalesce(sum(o.subtotal_paisa - o.discount_paisa), 0)         as revenue_paisa
from orders o
join business_days bd on bd.id = o.business_day_id
join outlets ot on ot.id = o.outlet_id
where o.status = 'settled' and has_role('owner', 'manager', 'supervisor')
group by o.outlet_id, bd.business_date, extract(hour from o.created_at at time zone ot.timezone);

-- ---------------------------------------------------------------------
-- PAYMENT MIX + TAX SUMMARY — manager+. Split by tax_class (cash 16% /
-- digital 8%, Part 05) is exactly what the PRA return export needs, and
-- exactly what the Dashboard's "GST collected, 16%/8% breakdown alag"
-- row needs — same source data, two different groupings.
-- ---------------------------------------------------------------------
create or replace view payment_mix_daily
with (security_invoker = true)
as
select bd.outlet_id, bd.business_date, p.method,
       count(*)                        as payments,
       coalesce(sum(p.amount_paisa), 0) as amount_paisa
from payments p
join orders o on o.id = p.order_id
join business_days bd on bd.id = o.business_day_id
where has_role('owner', 'manager', 'supervisor')
group by bd.outlet_id, bd.business_date, p.method;

create or replace view tax_summary_daily
with (security_invoker = true)
as
select bd.outlet_id, bd.business_date, p.class,
       count(*)                         as payments,
       coalesce(sum(p.base_paisa), 0)   as base_paisa,
       coalesce(sum(p.tax_paisa), 0)    as tax_paisa,
       coalesce(sum(p.amount_paisa), 0) as amount_paisa
from payments p
join orders o on o.id = p.order_id
join business_days bd on bd.id = o.business_day_id
where has_role('owner', 'manager', 'supervisor')
group by bd.outlet_id, bd.business_date, p.class;

-- ---------------------------------------------------------------------
-- CASH VARIANCE BY CASHIER — owner-only. shifts.cashier_id/variance_paisa
-- already existed (Part 13); this is the first report to group them by
-- person instead of by day. Rs 500 = 50000 paisa, the brief's own
-- per-shift threshold (§4).
-- ---------------------------------------------------------------------
create or replace view cash_variance_by_cashier
with (security_invoker = true)
as
select bd.outlet_id, bd.business_date, s.cashier_id, st.name as cashier_name,
       count(*)                                                      as shifts,
       coalesce(sum(s.variance_paisa), 0)                            as total_variance_paisa,
       coalesce(round(avg(s.variance_paisa)), 0)::bigint              as avg_variance_paisa,
       count(*) filter (where abs(coalesce(s.variance_paisa, 0)) > 50000) as shifts_over_threshold
from shifts s
join business_days bd on bd.id = s.business_day_id
join staff st on st.id = s.cashier_id
where s.closed_at is not null and has_role('owner')
group by bd.outlet_id, bd.business_date, s.cashier_id, st.name;

-- ---------------------------------------------------------------------
-- VOID ANALYSIS BY CASHIER — owner-only. Attributed to the cashier who
-- RANG UP the order (orders.created_by), not the manager who authorised
-- the void (order_voids.authorised_by) — "ek cashier ke zyada voids"
-- means the person whose orders keep needing voiding, not whoever
-- happened to approve it. Covers both whole-order voids and single-line
-- voids (order_voids.order_item_id not null), valued at the line's own
-- total in the partial case rather than the whole order's.
-- ---------------------------------------------------------------------
create or replace view void_analysis_by_cashier
with (security_invoker = true)
as
select bd.outlet_id, bd.business_date, o.created_by as cashier_id, st.name as cashier_name,
       count(*) as void_count,
       coalesce(sum(
         case when ov.order_item_id is null then o.total_paisa else oi.line_total_paisa end
       ), 0) as void_value_paisa
from order_voids ov
join orders o on o.id = ov.order_id
join business_days bd on bd.id = o.business_day_id
join staff st on st.id = o.created_by
left join order_items oi on oi.id = ov.order_item_id
where has_role('owner')
group by bd.outlet_id, bd.business_date, o.created_by, st.name;

-- ---------------------------------------------------------------------
-- REPRINT SUMMARY — owner-only. Reads invoice_prints
-- (0026_reports_schema.sql) — empty until Part 19 actually calls
-- record_invoice_print() from a Print button, same as every other
-- forward-declared report in this project.
-- ---------------------------------------------------------------------
create or replace view reprint_summary
with (security_invoker = true)
as
select o.outlet_id, bd.business_date, ip.printed_by, st.name as staff_name,
       count(*) filter (where ip.is_reprint) as reprint_count,
       count(*)                              as total_prints
from invoice_prints ip
join orders o on o.id = ip.order_id
join business_days bd on bd.id = o.business_day_id
left join staff st on st.id = ip.printed_by
where has_role('owner')
group by o.outlet_id, bd.business_date, ip.printed_by, st.name;

-- ---------------------------------------------------------------------
-- LABOUR COST — owner-only. Sums ONLY the amortised amount from
-- categories flagged is_labour_cost (0026_reports_schema.sql) — reuses
-- daily_expenses_amortized (Part 14) rather than re-deriving the
-- amortisation formula a second time.
-- ---------------------------------------------------------------------
create or replace view labour_cost_daily
with (security_invoker = true)
as
select dea.outlet_id, dea.expense_date as business_date,
       coalesce(sum(dea.amortized_amount_paisa), 0) as labour_cost_paisa
from daily_expenses_amortized dea
join expense_categories ec on ec.id = dea.category_id
where ec.is_labour_cost and has_role('owner')
group by dea.outlet_id, dea.expense_date;

-- ---------------------------------------------------------------------
-- INGREDIENT COST TREND — owner-only. "Ingredient cost 10% barha" (§4)
-- needs a BEFORE number, which moving_avg_cost_paisa alone doesn't keep
-- — it only ever holds the current value. Approximates "before" as the
-- average purchase unit cost from 30-90 days ago; null (no purchases in
-- that window) means "not enough history to flag", handled by the flag
-- function in lib/reports.ts rather than by faking a number here.
-- ---------------------------------------------------------------------
create or replace view ingredient_cost_trend
with (security_invoker = true)
as
select i.id as ingredient_id, i.outlet_id, i.name,
       i.moving_avg_cost_paisa as current_cost_paisa,
       (
         select round(avg(pl.unit_cost_paisa))::bigint
         from purchase_lines pl
         join purchases p on p.id = pl.purchase_id
         where pl.ingredient_id = i.id
           and p.created_at >= now() - interval '90 days'
           and p.created_at <  now() - interval '30 days'
       ) as prior_cost_paisa
from ingredients i
where i.active and has_role('owner');

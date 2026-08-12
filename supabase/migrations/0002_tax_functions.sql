-- =====================================================================
-- Cup Shup POS — 0002 Tax & Invoice-Numbering Functions
-- Part 05: the tax engine. Rates themselves live in 0004_seed.sql's
-- `tax_rates` table — NEVER in application code — because the Punjab
-- Finance Act changes the rate yearly, and an old invoice must always
-- keep recalculating at the rate that was valid on the day it was made.
--
-- This file is a deliberate SUBSET of the project's full reference
-- `0002_functions.sql` (which also contains the order engine, payment
-- settlement, business-day open/close, and reporting views — those are
-- Parts 06/09/10/13's job, built one part at a time). Extracting just
-- the tax + invoice-numbering pieces here is safe because neither one
-- calls into anything outside what Part 03's schema already created
-- (tax_rates, payment_method_tax_class, invoice_counters, outlets).
--
-- When Part 09/10/13 land, the remaining functions from the full
-- reference file arrive in their own later-numbered migration — they
-- redeclare these same three functions identically along the way
-- (`create or replace function` makes that a harmless no-op), so
-- nothing here needs to be touched or renumbered later.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Tax rate lookup — by class, valid on a given date.
-- A payment made today looks up today's rate; re-displaying an invoice
-- from six months ago looks up the rate that was active back then.
-- ---------------------------------------------------------------------
create or replace function tax_rate_bp(p_class tax_class, p_on date default current_date)
returns int language sql stable as $$
  select rate_bp from tax_rates
  where class = p_class
    and effective_from <= p_on
    and (effective_to is null or effective_to > p_on)
  order by effective_from desc
  limit 1;
$$;

-- Maps a payment method to its tax class (cash vs digital), so the
-- caller never has to hardcode "is JazzCash digital?" anywhere.
create or replace function class_of_method(p_method payment_method)
returns tax_class language sql stable as $$
  select class from payment_method_tax_class where method = p_method;
$$;

-- ---------------------------------------------------------------------
-- Sequential, gapless invoice numbering: CS-20260812-0001
-- Replaces the prototype's "CS-" + last 6 digits of a millisecond
-- timestamp, which repeated every ~16 minutes and produced duplicate
-- invoice numbers within a single shift.
-- security definer + a row lock via the UPSERT below means two
-- terminals settling at the same instant still get distinct numbers.
-- ---------------------------------------------------------------------
create or replace function next_invoice_no(p_outlet uuid, p_date date)
returns text language plpgsql security definer set search_path = public as $$
declare n bigint; pfx text;
begin
  insert into invoice_counters (outlet_id, business_date, last_no) values (p_outlet, p_date, 1)
  on conflict (outlet_id, business_date)
    do update set last_no = invoice_counters.last_no + 1
  returning last_no into n;
  select invoice_prefix into pfx from outlets where id = p_outlet;
  -- CS-20260812-0001  : sequential, gapless, no timestamp collisions
  return pfx || '-' || to_char(p_date, 'YYYYMMDD') || '-' || lpad(n::text, 4, '0');
end $$;

-- =====================================================================
-- Cup Shup POS — menu_item_prices.price_period: allow same-day re-price
-- =====================================================================
-- Found while writing the pgTAP test for 0044_order_type_pricing.sql,
-- not caused by it — this is a pre-existing bug in change_item_price()
-- (and equally affects 0044's new set_item_order_type_price(), same
-- close-out-then-insert shape). Both always use current_date for BOTH
-- the closed-out row's effective_to and the new row's effective_from.
-- Calling either RPC a SECOND time on the same calendar day — e.g. a
-- manager fixing a typo'd price minutes after entering it — makes
-- effective_to = effective_from on the row being closed out, which this
-- table's own price_period constraint (`effective_to > effective_from`)
-- then rejects outright: a raw constraint-violation error surfaced to
-- the user on their second, CORRECTIVE edit, of all things.
--
-- Relaxing to `>=` fixes it with no change to historical-price query
-- semantics. current_price_paisa()'s own condition is `effective_from
-- <= p_on and (effective_to is null or effective_to > p_on)` — a row
-- with effective_to = effective_from now matches p_on = that same date
-- on NEITHER side (effective_from<=p_on needs p_on>=D, effective_to>p_on
-- needs p_on<D — contradictory), so it's correctly treated as
-- superseded the instant it's closed, exactly as it always was; the
-- only thing that changes is the constraint no longer errors on it.
-- =====================================================================

alter table menu_item_prices drop constraint price_period;
alter table menu_item_prices add constraint price_period
  check (effective_to is null or effective_to >= effective_from);

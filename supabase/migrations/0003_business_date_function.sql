-- =====================================================================
-- Cup Shup POS — Business-date function
-- Part 06: fixes the prototype's local/UTC-mixing bug that booked
-- 12 Aug 02:00 PKT orders under 2026-08-10 instead of 2026-08-11.
--
-- Same subset story as 0002_tax_functions.sql: this one function has zero
-- dependency on anything else in the schema (pure date arithmetic), so it
-- is safe to land now rather than waiting for the rest of the full
-- reference `0002_functions.sql`. See that file's own header comment, and
-- supabase/migrations/README.md, for the full ordering explanation.
-- =====================================================================

-- Converts a moment in time into the TRADING DAY it belongs to.
-- Cup Shup's day runs 3pm -> 3am, so a sale at 02:00 belongs to the
-- business day that started at 3pm the PREVIOUS calendar evening.
--
--   `ts at time zone tz`         — reinterpret the instant as wall-clock
--                                   time in Asia/Karachi (this is the step
--                                   the old JS code got wrong: it read
--                                   local hours but then formatted in UTC)
--   `- make_interval(hours=>15)` — shift back by the day-start hour
--   `::date`                     — keep only the calendar date
--
-- Examples (Asia/Karachi, start_hour = 15):
--   2026-08-11 20:00 PKT -> minus 15h -> 2026-08-11 05:00 -> 2026-08-11
--   2026-08-12 02:00 PKT -> minus 15h -> 2026-08-11 11:00 -> 2026-08-11
--   2026-08-11 14:00 PKT -> minus 15h -> 2026-08-10 23:00 -> 2026-08-10
create or replace function business_date_of(
  ts timestamptz,
  tz text default 'Asia/Karachi',
  start_hour int default 15
) returns date language sql stable as $$
  select ((ts at time zone tz) - make_interval(hours => start_hour))::date;
$$;

comment on function business_date_of(timestamptz, text, int) is
  'Converts a UTC instant into the Cup Shup trading day (3pm-3am, Asia/Karachi) it belongs to. The single source of truth for "which business day is this" — every table with a business_date/business_day_id derives it from here, never from client-side date math.';

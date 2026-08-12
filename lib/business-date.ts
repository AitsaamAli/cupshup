/**
 * Business-date helpers — the 3pm–3am trading day.
 *
 * THIS FILE IS DISPLAY-ONLY. The authoritative business date for any
 * financial record is always computed by Postgres's `business_date_of()`
 * (see supabase/migrations/0002_business_date_function.sql), using the
 * server's clock. Nothing in this file should ever be used to decide
 * which business day an order belongs to — only to *show* a date to
 * staff before the server has weighed in (e.g. "today's business date is
 * ..." on a screen), or in tests that check the two implementations agree.
 *
 * This is exactly the function that was broken in the old prototype:
 *
 *   function businessDateFor(d) {
 *     const dt = new Date(d);
 *     if (dt.getHours() < 15) dt.setDate(dt.getDate() - 1);
 *     return dt.toISOString().slice(0, 10);   // <-- bug
 *   }
 *
 * `getHours()` reads LOCAL time (Pakistan, UTC+5). `toISOString()` then
 * converts back to UTC. Mixing the two silently shifts the date backwards
 * — a 2am order lands on the wrong calendar day, misfiling exactly the
 * cafe's busiest hours (3pm–3am means midnight–3am is peak, not off-hours).
 */

/**
 * Converts a moment in time into the trading day it belongs to, mirroring
 * Postgres's `business_date_of(ts, tz, start_hour)` exactly:
 *
 *   1. Read the wall-clock date/time as seen in `tz` (via Intl, so this
 *      is correct for any timezone — including ones that observe DST —
 *      without hand-rolled UTC-offset arithmetic).
 *   2. Treat those wall-clock numbers as if they were UTC ("fake UTC").
 *      This lets step 3 use plain millisecond arithmetic with no further
 *      timezone reinterpretation — exactly what `(ts at time zone tz) -
 *      interval` does in Postgres.
 *   3. Subtract `startHour` hours.
 *   4. Keep only the resulting calendar date.
 *
 * @param ts        The instant to classify (Date, or an ISO string with
 *                   an explicit offset — never a bare "local time" string).
 * @param tz         IANA timezone name. Defaults to Asia/Karachi.
 * @param startHour  Hour the trading day starts on. Defaults to 15 (3pm).
 * @returns          The business date as "YYYY-MM-DD".
 */
export function businessDateOf(
  ts: Date | string,
  tz: string = "Asia/Karachi",
  startHour: number = 15
): string {
  const date = typeof ts === "string" ? new Date(ts) : ts;
  if (Number.isNaN(date.getTime())) {
    throw new Error(`businessDateOf: invalid timestamp "${String(ts)}"`);
  }

  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(date);

  const get = (type: string): number =>
    Number(parts.find((p) => p.type === type)?.value);

  // "Fake UTC": the wall-clock numbers in `tz`, reinterpreted as if they
  // were already a UTC timestamp. From here on, arithmetic is just plain
  // millisecond math — no DST, no offset lookups, no surprises.
  const wallAsUtcMs = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour"),
    get("minute"),
    get("second")
  );

  const shifted = new Date(wallAsUtcMs - startHour * 60 * 60 * 1000);

  const yyyy = shifted.getUTCFullYear();
  const mm = String(shifted.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(shifted.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

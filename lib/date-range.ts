/**
 * Local-calendar-date helpers for report date-range pickers. Uses the
 * Date object's own local getters (getFullYear/getMonth/getDate), never
 * toISOString() — that reads UTC, which for Pakistan (UTC+5) silently
 * shows YESTERDAY's date for the first five hours after local midnight.
 * The exact same class of bug business_date_of() (Part 06) exists to
 * prevent for order timestamps; these are separate from that function
 * (which is server-side and outlet-timezone-aware) — just the UI's own
 * "what does today's date picker default to" convenience, using the
 * browser's local clock, which is good enough for a default a person
 * can still adjust by hand.
 */
function toLocalIso(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function todayIso(d: Date = new Date()): string {
  return toLocalIso(d);
}

export function daysAgoIso(days: number, d: Date = new Date()): string {
  const copy = new Date(d);
  copy.setDate(copy.getDate() - days);
  return toLocalIso(copy);
}

export function startOfMonthIso(d: Date = new Date()): string {
  return toLocalIso(new Date(d.getFullYear(), d.getMonth(), 1));
}

# app/kds

Kitchen Display System — Part 17. Shows orders the instant they're sent
from POS (Supabase Realtime, not manual refresh), lets kitchen/bar staff
move items through pending → preparing → ready, and lets Chef toggle the
"86" (out of stock) flag right from a ticket.

See `docs/kitchen-display.md` for the full design writeup: station
routing, why "All ready" only completes a ticket once every station's
items are done, recall, and the screen's own requirements (forced dark
mode, 64×64px touch targets, no idle timeout, reconnect-and-catch-up).

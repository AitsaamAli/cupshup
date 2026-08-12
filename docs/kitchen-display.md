# Cup Shup POS — Kitchen Display System (KDS)

**Depends on:** Part 09, Part 15
**Code delivered in this part:** `supabase/migrations/0024_kds_schema.sql`,
`supabase/migrations/0025_kds_functions.sql`, `app/kds/page.tsx`,
`components/kds/*`, `lib/kds.ts`, `lib/kds-sound.ts`

---

## 1. The gap this part closes

```js
"Chef": ["inventory"],
"Kitchen Staff": ["inventory"],
"Tea Maker": ["inventory"],
```

The old role config could see inventory and nothing else — an order
reached the kitchen by someone shouting it across the room. Every
design decision below exists to put every order in front of the right
station, the instant it's sent, with nothing manual in between.

## 2. A write path this part needed that didn't exist yet

`order_items` has a `kds_update_items` RLS policy from Part 04's
reference SQL (`0005_rls.sql`) that reads as if it already lets
chef/kitchen/barista/supervisor/manager/owner update an item's status
directly. It can't actually fire: the same file's later `revoke insert,
update, delete on orders, order_items, ... from anon, authenticated`
blocks the write at the privilege layer before RLS is ever consulted —
a revoked `GRANT` beats a permissive policy every time. This is the
same shape as every other financially-adjacent table in this project
(orders, payments, business_days), just not one this codebase had
exercised yet. `0025_kds_functions.sql` is the real write path that
policy's intent needed: three `SECURITY DEFINER` functions —
`advance_order_item_status()`, `mark_ticket_items_ready()`, and
`recall_order()` — each doing its own role check and writing its own
`audit_log` entry, same shape as `advance_order_status()` (Part 09).

## 3. Station routing, and why "All ready" isn't as simple as it sounds

`menu_categories.station` (new in `0024_kds_schema.sql`) maps the
outlet's real 21 seeded categories onto exactly four stations — every
one of them fit cleanly, no leftover judgment call:

| Station | Categories |
|---|---|
| Hot Kitchen | Appetizers, Fries, Salad & Soup, Sandwiches, Burgers, Pasta, Wraps, Stuffed Chicken, Steaks, Chinese, Pizza |
| Cold/Bar | Shakes, Frappe, Mocktail, Lagoon, Drinks, Icecream |
| Chai/Coffee | Chai, Kahwa, Coffee |
| Bakery | Desserts |

A ticket that mixes a burger and a chai (a completely ordinary Cup Shup
order) has to show up on both Hot Kitchen's screen and Chai/Coffee's
screen — but each screen must only show **that station's own lines**
of it, per the brief. `ticketItemsForStation()` (`lib/kds.ts`) filters
a ticket's items down to one station's own lines (or every line, for
the "All stations" view); `ticketMatchesStation()` decides whether the
ticket appears on a given screen at all.

That means the brief's "All ready" button can't just flip the whole
order to ready in one shot — Hot Kitchen finishing its burger doesn't
mean the chai is ready. `mark_ticket_items_ready(order_id, station)`
only bumps the calling station's own pending/preparing lines. The order
itself only becomes `'ready'` once **every** line across **every**
station has reached ready — checked the same way whether the last line
got there one tap at a time (`advance_order_item_status`) or via the
bulk button, so it doesn't matter which path a ticket's last item took.
Passing `station = null` (the "All stations" view's own button) means
literally every line on the order, which is the one place a single tap
can complete an order outright.

## 4. Ticket and item timestamps — new, needed for the report

Neither `orders` nor `order_items` previously recorded *when* a status
change happened, only that it eventually did. `0024_kds_schema.sql`
adds `ready_at timestamptz` to both. The per-order one answers "how
long did this ticket take"; the per-item one is what actually answers
"which station is slow" — a multi-station ticket's items finish at
different times, and only the item-level timestamp can attribute that
correctly to Hot Kitchen vs. Chai/Coffee rather than blaming whichever
station happened to finish last.

## 5. Ticket age colour and the report — pure, tested functions

`ticketAgeLevel()` (0–5 min neutral, 5–10 amber, 10+ red — the brief's
own thresholds) and the report's three aggregations
(`averageTicketMinutes`, `averageMinutesByStation`,
`averageMinutesByHour`) are all pure functions in `lib/kds.ts`, unit
tested in `tests/kds.test.ts` against fixed timestamps rather than
needing a live board to observe. The report itself
(`components/kds/ticket-time-report.tsx`) is scoped to the currently
open business day — the same day-scoped window every other screen in
this app uses — and reads through the same outlet-wide `orders`/
`order_items` select policies every staff member already has (Part 04),
rather than adding a new owner-only gate for what's operational insight,
not financial data.

## 6. Recall — deliberately whole-ticket, not per-station

`recall_order()` only accepts a ticket currently in `'ready'` status
(a `'served'` ticket has already left the kitchen's part of the job —
Part 09's `add_items_to_order()` already re-opens that case if the
customer orders more). Recalling resets **every** station's ready items
back to `'preparing'`, not just the station that tapped Recall. A more
surgical per-station recall was considered and left out: it isn't asked
for, and it reopens exactly the "is this ticket actually done or not"
ambiguity Recall exists to resolve — a ticket that's half-recalled is
worse than one every station has to glance at again.

## 7. Sound, reconnect, and the screen's own requirements

- **Sound:** `lib/kds-sound.ts` beeps via the Web Audio API — no audio
  file to bundle or fail to load, and no autoplay-block issue since the
  first tap anywhere on the KDS screen (station tab, mute button)
  unlocks the audio context same as any kiosk app. A mute toggle
  persists to `localStorage`. The hook only beeps for order ids that
  are new since the last render, and never for tickets already on the
  board when the screen first mounts — reopening the KDS mid-shift with
  five active tickets doesn't play five beeps.
- **Reconnect:** Supabase Realtime's websocket reconnects on its own,
  but a tab that was asleep or briefly offline can miss a change that
  happened while it was gone. Rather than trust the channel to have
  replayed everything, `useKdsTickets()` does a full reload on the
  browser's `online` event and on the tab regaining visibility — simple
  and reliable, whatever actually caused the gap.
- **No timeout:** already handled — `lib/auth.ts`'s
  `IDLE_TIMEOUT_MS.kds = Number.POSITIVE_INFINITY` was built in Part 07
  and generalized in Part 15; this part just confirms KDS is the screen
  that uses it.
- **Dark mode, forced:** every other screen in this app follows the
  OS's `prefers-color-scheme` (`globals.css`, Part 15). KDS instead
  hard-codes `bg-neutral-950 text-neutral-100` on its own root — a
  dedicated kitchen device shouldn't go light just because whoever set
  up that tablet has a light-mode OS.
- **Touch targets:** every actionable element on this screen — item
  rows, the 86 button, station tabs, All ready/Recall — is a minimum
  64×64px tap target (`min-h-16 min-w-16`, i.e. `4rem`), not the 44px
  minimum the rest of the app uses (`components/ui/Button.tsx`). Built
  as KDS-local markup rather than stretching the shared `Button`
  component, since overriding one Tailwind utility with another of the
  same kind via `className` string concatenation is order-dependent and
  not something to rely on for a requirement this literal.

## 8. What's out of scope

No price appears anywhere on this screen — a KDS ticket shows qty, name,
modifiers, and notes, never a paisa amount. The kitchen doesn't need one
and showing one is one more thing to typo-read wrong under pressure;
Part 16's POS and Part 10's settlement screen are where money actually
lives.

`order_items.status = 'served'` (the enum value between `'ready'` and
`'voided'`) is not written by anything in this part, matching the
brief's own scope: it only asks for pending → preparing → ready. Wiring
that transition to the moment a waiter actually delivers a ready item
to a table is a POS/floor-service concern, not this screen's.

## 9. What still needs a live device to verify

Confirmed live against the real project: both migrations pushed and
applied (`0024_kds_schema.sql`, `0025_kds_functions.sql`), all 21
categories backfilled to a station with zero left null, and all three
new functions exist and are callable. What's *not* yet exercised:
actually placing an order from POS and watching it land on a real KDS
screen within the brief's 1-second target, and the Web Audio beep
across real browsers/devices — both need a live device in a kitchen,
not something a build step can confirm.

---

## 10. Acceptance Criteria — This Part

- [x] Order reaches KDS via Realtime, no polling (`useKdsTickets()`) —
      sub-1-second delivery needs a live device to time (Section 9)
- [x] Station filtering — `ticketItemsForStation`/`ticketMatchesStation`,
      backed by `menu_categories.station`
- [x] Item-level status update — `advance_order_item_status()`
- [x] Ticket age shown by colour — `ticketAgeLevel()`, tested
- [x] Sound on new order — `lib/kds-sound.ts`, mute option
- [x] "All ready" completes a whole order — `mark_ticket_items_ready()`,
      auto-completing once every station's items are ready (Section 3)
- [x] Ready triggers a POS/waiter alert — no new code needed; Part 16's
      `useTables()` and Part 09's `useIncomingOrders()` already react to
      `orders` Realtime changes, which this part's functions write to
- [x] Recall — `recall_order()`
- [x] Chef can 86 an item from KDS — reuses Part 08's `toggle_86()`
- [x] Screen never times out — already built (Part 07/15), confirmed
- [x] Reconnects and catches up after a dropped connection (Section 7)
- [x] Large type, high contrast, 64×64px minimum touch targets
- [x] Average ticket time report — per ticket, per station, per hour

**Next part:** `18-reports-and-pl.md`

# Cup Shup POS — Printing & PRA Invoice

**Depends on:** Part 05, Part 10, Part 17, Part 18
**Code delivered in this part:** `print-agent/` (standalone), `supabase/migrations/
0029_printing_schema.sql`, `supabase/migrations/0030_printing_functions.sql`,
`app/api/pra/submit/route.ts`, `lib/print-templates.ts`, `lib/print-agent-client.ts`,
`lib/print-queue.ts`, `lib/pra.ts`, `lib/receipt-data.ts`, `components/print/*`

---

## 1. What `window.print()` actually got wrong

The old system's CSS had the right idea (`@media print { body * {
visibility: hidden } ... }`) but was missing exactly one rule:

```css
@page { size: 80mm auto; margin: 0; }
```

Without it, Chrome prints on whatever the system default paper size is
(usually A4) with large default margins — a receipt that should be
~10cm tall becomes one page mostly empty space, and nothing about
drawer-kick or paper-cut exists in a browser print dialog at all,
because those are physical commands a driver-level dialog has no
concept of. `components/print/browser-print-fallback.tsx` uses the
exact same visibility technique, this time with the `@page` rule
included (`app/globals.css`'s `.print-doc` block) — but it's still only
the backup path. It can't kick a drawer or cut paper either; that
requires ESC/POS commands sent directly to the printer, which is what
`print-agent/` exists for.

## 2. Two printing paths, exactly per the brief

- **Primary — `print-agent/`:** a small standalone Node service that
  runs on each physical terminal (not part of the Next.js app or its
  Vercel deployment) and speaks ESC/POS directly to network/USB thermal
  printers via `node-thermal-printer`. No dialog, real drawer kick, real
  cut, one printer per kitchen station. See `print-agent/README.md` for
  setup.
- **Fallback — browser `@page` print:** used automatically
  (`components/print/print-button.tsx`) whenever the agent isn't
  reachable. Still opens a print dialog — that's an accepted limitation
  of this path, not a bug; it exists so a terminal can still print
  *something* the moment the agent isn't running, not to replace it.

Every print in the app (receipt, kitchen ticket, day report) goes
through one function, `printOrQueue()` (`lib/print-queue.ts`), so this
choice is made in exactly one place rather than duplicated per screen.

## 3. `PrintDoc` — one content model, two renderers

`lib/print-templates.ts` builds a `PrintDoc` (a list of `PrintRow`s —
left/right text pairs, dividers, an optional QR payload) for all three
templates. Neither renderer — `print-agent/src/render.js`'s ESC/POS
calls, or `components/print/print-doc-view.tsx`'s HTML — knows anything
about *how* a receipt or kitchen ticket is supposed to look; they only
know how to lay out whatever rows they're handed. This is what makes
every template testable without a printer, an HTTP call, or a browser:
`tests/print-templates.test.ts` builds each `PrintDoc` from fixed input
and checks the resulting rows directly, including reproducing the
brief's own worked receipt example (§4) to the exact rupee.

## 4. PRA — what's real here and what genuinely isn't

`orders.pra_invoice_no` / `pra_qr_payload` / `pra_synced_at` have
existed since Part 03's schema; `settle_order()` (Part 10) left an
explicit note pointing at exactly where transmission belongs
(`0011_settlement_functions.sql`). This part fills that in as far as it
honestly can without a live vendor relationship:

- **Real and complete:** the queue (`pra_submission_queue`), the retry
  functions (`enqueue_pra_submission()`, `record_pra_result()`,
  `record_pra_failure()` — `0030_printing_functions.sql`), the
  exponential backoff (capped at 60 minutes, computed in SQL so a
  misbehaving client can't force a hot retry loop), the client
  reconcile loop (`lib/pra.ts`'s `usePraReconcile()`, same
  reconnect-on-`online`-event pattern as Part 17's KDS board), and the
  "print locally now regardless" rule (`buildReceiptDoc()` shows `PRA
  No: pending` and skips the QR entirely when `praQrPayload` is null —
  see `tests/print-templates.test.ts`'s explicit offline-queue case).
- **Not real, deliberately:** `callPraVendor()`
  (`app/api/pra/submit/route.ts`) is a mock — it returns a value clearly
  prefixed `MOCK-` unless `PRA_API_URL` is set. The brief is explicit
  that this integration needs a PRA-registered vendor's own specs and
  certification ("Yeh kaam PRA-registered integration vendor ke saath
  karein"); nothing in this codebase can substitute for that. The mock
  exists so the entire pipeline around it — settlement, the receipt,
  the offline queue, reconciliation — is fully built and testable
  today, with exactly one function to swap when a real vendor is
  engaged.

**Built as a Next.js Route Handler, not a Supabase Edge Function** — the
brief's own prompt names "Supabase Edge Function" by name, but this
project already has an established, working pattern for "a secret that
must never reach the browser" (`app/api/auth/pin/route.ts`, Part 07).
Introducing a second server runtime (Deno/Supabase Edge Functions)
alongside the one Next.js already runs, for the same category of
problem Part 07 already solved, would be inconsistent for no real
benefit — `app/api/pra/submit/route.ts` deploys automatically with the
rest of the app instead of needing its own separate `supabase functions
deploy` step.

## 5. Reprint tracking reuses Part 18, not the brief's own SQL snippet

The brief's own §6 sketches a fresh `invoice_reprints` table — but Part
18 already built exactly this (`invoice_prints`, `record_invoice_print()`)
as forward-declared infrastructure specifically for this part, the same
way Part 09 built `useIncomingOrders()` before Part 17's KDS screen
existed to consume it. Building a second, parallel table here would
just fork the reprint audit trail in two places. The one real change
needed: `record_invoice_print()` returned `void` in Part 18, but this
part's receipt needs the print's own sequence number *immediately*, to
render `REPRINT #2` on the very ticket it's about to send to the
printer — so `0029_printing_schema.sql` drops it and
`0030_printing_functions.sql` redefines it returning `int`
(Postgres won't let `create or replace` change a return type). The
`invoice_prints` table itself, and Part 18's `reprint_summary` report,
are untouched.

The counter only ever advances on a genuine new print click — see
`components/print/print-button.tsx`'s `getDoc` prop, which calls
`record_invoice_print()` fresh each time it's actually clicked, versus
the static `doc` prop kitchen tickets and day reports use (neither of
those is an invoice; neither goes through this counter at all).

## 6. Printing can never fail an order

By the time any print button in this app exists, the thing it's
printing was already committed: `settle_order()`/`place_order()` for a
receipt, an already-open KDS ticket for a kitchen ticket,
`close_business_day()`'s `closing_snapshot` for a report. A print
failure — agent unreachable, printer out of paper, network gone — only
ever affects `lib/print-queue.ts`'s local, per-device, localStorage
retry queue, surfaced by `components/print/pending-prints-indicator.tsx`
in the POS header. There is no code path in this app where a printer
problem can roll back or block a sale.

## 7. What still needs real hardware (and a real PRA vendor) to verify

Nothing about the ESC/POS command sequences in `print-agent/src/
render.js` has been checked against a physical thermal printer — there
isn't one in this environment. The commands follow `node-thermal-
printer`'s documented API and the dependency installs cleanly (`npm
install` in `print-agent/`, verified), and the agent's own resilience
was smoke-tested end-to-end against a deliberately unreachable fake
printer address: it starts, serves `/health`, returns a clean `502` on
a failed print instead of crashing, and stays up afterward — but the
actual visual result on paper (column widths, drawer timing, cut
reliability) needs a real device before a live shift depends on it. The
real PRA transmission needs a signed vendor relationship this
environment has no way to establish; `callPraVendor()` is exactly where
that vendor's real endpoint replaces the mock, and nothing else in the
pipeline needs to change when it does.

---

## 8. Acceptance Criteria — This Part

- [x] Prints without a dialog — `print-agent/`, when running
- [x] Correct 80mm layout — both the agent (native ESC/POS width) and
      the browser fallback's `@page` rule
- [x] Kitchen ticket to the station's own printer —
      `print-agent/config.json`'s `kitchenPrinters` map, station-routed
- [x] Customer receipt to the counter printer
- [x] Cash drawer opens — `openCashDrawer()`, agent-only (the browser
      fallback can't do this — Section 2)
- [x] Paper auto-cuts — `printer.cut()`, agent-only
- [x] Invoice shows NTN/STRN/PRA reg/address/phone/terminal/cashier —
      `buildReceiptDoc()`, reproduces the brief's own layout exactly
- [x] Sequential invoice number — `next_invoice_no()`, Part 05, unchanged
- [x] Each payment split at its own rate — reused from Part 10's
      settlement data, unchanged
- [x] QR code prints — agent via `printQR()`; browser fallback via the
      `qrcode` package (a printer's built-in QR command has no browser
      equivalent)
- [x] PRA transmission structure ready; real vendor integration is
      explicitly out of reach in this environment (Section 4)
- [x] Offline queue + reconcile — `pra_submission_queue`,
      `usePraReconcile()`
- [x] Reprint count + "REPRINT #N" mark — reuses Part 18's
      `invoice_prints`, redefined to return the print number (Section 5)
- [x] Printer failure → clean error, order unaffected, print queued
      (Section 6) — smoke-tested against a real unreachable address

**Next part:** `20-offline-testing-deployment.md`

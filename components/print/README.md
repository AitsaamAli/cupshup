# components/print

Printing UI — Part 19.

- `print-button.tsx` — the one print button every screen uses. Tries
  the local print agent first (no dialog); falls back to
  `browser-print-fallback.tsx` if the agent isn't reachable. Accepts
  either a static `doc` (kitchen ticket, day report) or a `getDoc`
  callback built fresh at click time (the receipt — see
  `lib/receipt-data.ts`'s `recordInvoicePrint()`, which the "REPRINT
  #N" marker depends on being called exactly once per real click).
- `browser-print-fallback.tsx` — the backup path (brief §2a): the
  browser's own print dialog, with the `@page: 80mm` rule the old
  system's version of this technique was missing (`app/globals.css`).
- `print-doc-view.tsx` — renders a `PrintDoc` (`lib/print-templates.ts`)
  as HTML for the fallback path, including the PRA QR code (the
  `qrcode` package — a printer's own built-in QR command has no browser
  equivalent).
- `pending-prints-indicator.tsx` — this device's local retry queue
  (`lib/print-queue.ts`), shown in the POS header. A print failure never
  fails the order it belongs to; this is where "printer band ho to ...
  queue mein aa jaye" becomes visible so a stuck ticket doesn't silently
  never reach the kitchen.

See `docs/printing-and-pra-invoice.md` for the full design — why
printing has two paths, how `PrintDoc` stays renderer-agnostic, and what
still needs real hardware to verify.

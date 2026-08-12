# Cup Shup POS — Offline Mode

**Depends on:** Part 08, Part 09, Part 13
**Code delivered in this part:** `lib/offline-db.ts`, `lib/offline-network.ts`,
`lib/offline-orders.ts`, `public/sw.js`, `components/service-worker-registration.tsx`,
`components/pos/offline-indicator.tsx`

---

## 1. The old bug, and the real one found while fixing it

The brief's own example — an order that only ever lived in memory,
gone on refresh — is the headline bug. Building the fix surfaced a
second, quieter one already living in this codebase: `useMenu()`
(Part 08) and `useBusinessDay()` (Part 13) never checked whether their
Supabase queries actually succeeded. A dead connection doesn't throw —
verified empirically against this project's real `supabase-js` version,
not assumed — it resolves normally with `data: null`. `castRows(null)`
turns that into `[]`, so a network failure and "this outlet genuinely
has zero menu items" were indistinguishable. For `useBusinessDay()`
that's worse than an empty item grid: `day === null` reads as "no open
day," and POS's own day-closed screen would then refuse to let a
cashier take ANY order while genuinely offline — exactly backwards from
"POS ko chalte rehna hai." Both hooks now check the query's own `error`
field, and fall back to the last cached value (IndexedDB) instead of
silently going empty.

## 2. How a network failure is actually detected

```
supabase.rpc("place_order", {...})
  -> resolves with { data: null, error: { message: "TypeError: fetch failed" } }
```

Not a thrown exception — a normal, successful-looking resolution whose
`error.message` happens to contain fetch-failure text. `isNetworkError()`
(`lib/offline-network.ts`) checks that text (Chrome: "Failed to fetch",
Safari: "Load failed", Firefox: "NetworkError...", Node/undici — what
Postgrest's own error actually contains: "TypeError: fetch failed") on
either a real `Error` or a plain `{ message }`-shaped object, since by
the time an error reaches most of this app's code it's already been
wrapped into an `OrderError` (a real `Error` instance) whose `.message`
carries that same text straight through. This one function is the
single source of truth every offline-queueing decision in this app goes
through — get it wrong and either real orders never queue, or real
rejections (day closed, item 86'd) get mistaken for a connectivity
problem and retried forever against the same rejection.

## 3. What's cached, and — just as important — what isn't

| Cached in IndexedDB (`lib/offline-db.ts`) | Deliberately NOT cached |
|---|---|
| Menu snapshot (categories/items/prices/modifiers) | Card payment authorisation |
| Business day status (open/closed) | PRA fiscal number / QR |
| Queued new orders (`place_order()` attempts) | Live stock levels |
| — | Adding items to an already-open table order |

The right half of that table is the brief's own explicit list (§1) plus
one this build actually found: `add_items_to_order()` ("send more" to a
table that already has an open order) has no idempotency-key concept at
all — confirmed in `tests/orders.test.ts`'s own comment on it, written
back in Part 09. Queuing it offline would mean a retry after
reconnecting could genuinely insert the same items twice, with no
server-side guard against it. Rather than build a new idempotency
mechanism for one RPC this late in the build, the honest choice was to
not queue it: offline, POS blocks "Send more" on an existing order with
a plain message and lets a brand NEW order be queued instead (which
`place_order()`'s idempotency key, Part 09, already makes provably safe
to retry). A customer ordering dessert mid-offline-outage gets a second
ticket instead of one merged order — a real but minor limitation,
clearly better than a silent duplicate charge risk.

## 4. The queue: pending vs. rejected

A queued order isn't just "retry until it works." `useSyncOfflineOrders()`
(`lib/offline-orders.ts`) drains the queue oldest-first on reconnect,
and every attempt lands in exactly one of three buckets
(`classifySyncAttempt()`, pure and unit-tested):

- **synced** — deleted from the queue, done.
- **offline** — still no connection; the loop stops there rather than
  burning through the rest of the queue against the same dead
  connection.
- **rejected** — the SERVER said no (the business day closed while this
  terminal was offline, the item got 86'd in the meantime, ...). Marked
  `rejected`, kept visible in the POS header's "N orders couldn't sync"
  panel, and never auto-retried again — retrying changes nothing about
  *why* it was rejected. A manager reviews and dismisses it once it's
  been handled with the customer. Silently discarding it, or silently
  retrying it forever, were both considered and rejected — see
  `tests/offline-orders.test.ts` for the exact rejected-vs-offline
  distinction this depends on.

## 5. Service worker — what it caches, and the one thing it must never touch

`public/sw.js` is hand-written, loading Workbox from its own CDN at
runtime rather than adding a build-time dependency like `next-pwa` —
that package and Next.js 15's App Router have a real, documented
history of breaking each other on upgrades, and one plain file this
project fully controls was judged safer than a generated one it
doesn't. It caches exactly two things: content-hashed static assets
(`/_next/static/*`, cache-first — safe forever, the URL itself changes
whenever the content does) and page navigations (network-first with a
cached fallback, so a terminal that already opened `/pos` once can
still open it with no connection at all).

It explicitly does **not** intercept anything to `*.supabase.co`. A
generic HTTP cache has no idea an order was just placed or a business
day just closed — transparently serving a stale API response would be
actively wrong, not just outdated. That distinction is exactly why
`lib/offline-db.ts`'s IndexedDB cache exists as a *second*, separate
mechanism: it's the app's own code deciding, per query, what "acceptably
stale" means for that specific piece of data, instead of a generic
caching layer deciding for it.

## 6. A second bug this part's own service worker caught in review

`middleware.ts` (Part 07) redirects any unauthenticated request to
`/login` — correct for every real page, wrong for `/sw.js` itself: a
service worker registers before any staff member has logged in, so the
very first registration request would have been redirected to
`/login`'s HTML instead of served the actual JavaScript, silently
breaking registration with a MIME-type error. Fixed by excluding
`sw.js`/`manifest.json` from the middleware's matcher, alongside the
static-asset extensions it already excluded.

## 7. What still needs a real offline test to verify

Confirmed live and in the build: the network-failure detection was
verified empirically against a real (if deliberately unreachable) host,
not assumed from documentation; `npm run build`/`lint`/`test` all pass
with every hook above wired through the offline path. What hasn't been
exercised: a real terminal with its WiFi actually turned off, taking a
real order, watching it queue, turning WiFi back on, and watching it
sync — the Playwright E2E suite (`e2e/offline.spec.ts`,
`docs/testing-strategy.md`) is written to do exactly this and needs a
running dev server plus real seeded staff/day state to execute, neither
of which exist as a persistent fixture in this environment yet.

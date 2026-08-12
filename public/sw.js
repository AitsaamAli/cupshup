// Cup Shup POS — service worker, Part 20.
//
// Loads Workbox from its own CDN rather than adding a build-time
// dependency (e.g. next-pwa) — Next.js 15's App Router and Workbox's
// webpack plugin have a real, documented history of breaking each
// other on upgrades, and this project would rather have one plain,
// readable file it fully controls than a generated one it doesn't.
// Workbox itself is still genuinely used, per the brief — just loaded
// at runtime instead of bundled at build time.
//
// WHAT THIS CACHES, ON PURPOSE:
//   - The app shell (JS/CSS/fonts under /_next/static) — cache-first,
//     since these are content-hashed and never change under the same
//     URL.
//   - Page navigations (e.g. opening /pos with no connection) —
//     network-first with a cache fallback, so a terminal that already
//     visited a screen can still OPEN it offline.
//
// WHAT THIS DELIBERATELY DOES NOT CACHE:
//   - Anything to/from Supabase (*.supabase.co) — menu data, orders,
//     business day status, and everything else that must be either
//     genuinely fresh or explicitly and knowingly stale. That
//     distinction is exactly what lib/offline-db.ts's IndexedDB cache
//     (menu/day snapshots) and lib/offline-orders.ts's order queue are
//     for — a generic HTTP cache has no idea an order was just placed
//     or that a business day just closed, and serving a stale API
//     response transparently would be actively wrong, not just stale.
//     Supabase requests are left completely alone here; the app's own
//     code decides what to do when one fails.

importScripts("https://storage.googleapis.com/workbox-cdn/releases/7.1.0/workbox-sw.js");

if (self.workbox) {
  const { registerRoute } = workbox.routing;
  const { CacheFirst, NetworkFirst } = workbox.strategies;
  const { ExpirationPlugin } = workbox.expiration;

  workbox.core.setCacheNameDetails({ prefix: "cupshup" });

  // Content-hashed static assets — safe to keep essentially forever.
  registerRoute(
    ({ url }) => url.pathname.startsWith("/_next/static/"),
    new CacheFirst({
      cacheName: "cupshup-static",
      plugins: [new ExpirationPlugin({ maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 * 30 })],
    })
  );

  // Page navigations — try the network (so a staff member always gets
  // the latest deploy when online), fall back to whatever was last
  // cached for that exact URL when there's no connection at all.
  registerRoute(
    ({ request }) => request.mode === "navigate",
    new NetworkFirst({
      cacheName: "cupshup-pages",
      networkTimeoutSeconds: 4,
      plugins: [new ExpirationPlugin({ maxEntries: 30, maxAgeSeconds: 60 * 60 * 24 })],
    })
  );

  // Explicitly NOT registered as a route at all — Supabase requests
  // (*.supabase.co) fall through to the browser's normal, uncached
  // fetch behaviour. See the file header for why.
} else {
  console.error("Cup Shup service worker: Workbox failed to load from CDN — offline app-shell caching is inactive.");
}

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

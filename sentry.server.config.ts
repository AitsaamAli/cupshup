// Part 20 — Sentry, server side (API routes, RSC). Same "inert until
// configured" pattern as instrumentation-client.ts.
import * as Sentry from "@sentry/nextjs";

const dsn = process.env.SENTRY_DSN;

if (dsn) {
  Sentry.init({ dsn, tracesSampleRate: 0.1 });
}

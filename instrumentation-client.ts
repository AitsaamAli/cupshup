// Part 20 — Sentry, browser side. Inert (no-op) unless
// NEXT_PUBLIC_SENTRY_DSN is actually set — same "safe to ship, silent
// until configured" pattern as the PRA mock (Part 19, app/api/pra/submit).
import * as Sentry from "@sentry/nextjs";

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    tracesSampleRate: 0.1,
    // Session replay is deliberately OFF — a POS screen's session can
    // include a customer's phone number (Part 16 delivery lookup) and
    // menu prices; nothing here should record screen content by default.
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,
  });
}

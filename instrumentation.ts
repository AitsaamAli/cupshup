// Next.js's own instrumentation hook — loads sentry.server.config.ts
// for server-side error/performance capture. instrumentation-client.ts
// (browser side) is picked up automatically, no registration needed.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }
}

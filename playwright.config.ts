import { defineConfig, devices } from "@playwright/test";

/**
 * Part 20. Runs against a real `next dev` server (webServer below spins
 * one up automatically) talking to the real linked Supabase project —
 * there's no mocking layer for E2E by design, the whole point is
 * exercising the real RLS/RPC stack a unit test mocks away. See
 * docs/testing-strategy.md §5 for what staff/day fixtures each spec
 * needs before it can actually run, and which specs in this repo have
 * and haven't been executed yet.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false, // shared business-day/shift state — specs are not independent
  retries: 0,
  workers: 1,
  reporter: "list",
  globalSetup: "./e2e/global-setup.ts",
  globalTeardown: "./e2e/global-teardown.ts",
  use: {
    baseURL: "http://localhost:3000",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000",
    reuseExistingServer: true,
    timeout: 60_000,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});

import { defineConfig } from "vitest/config";
import path from "path";

// Mirrors tsconfig.json's "@/*": ["./*"] path alias — needed because app
// code (lib/orders.ts, lib/menu.ts, ...) imports via "@/...", and Vitest
// doesn't read tsconfig paths on its own.
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "."),
    },
  },
  test: {
    // e2e/*.spec.ts are Playwright specs (Part 20, npm run test:e2e) —
    // Vitest's default include pattern otherwise picks them up too and
    // fails trying to run Playwright's test()/describe() through Vitest.
    exclude: ["node_modules/**", "e2e/**"],
  },
});

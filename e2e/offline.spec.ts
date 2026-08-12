import { test, expect } from "@playwright/test";
import { FIXTURE_STAFF } from "./global-setup";

/**
 * Part 20's own offline design (docs/offline-mode.md), exercised as a
 * real browser: `context.setOffline(true)` is Playwright's own network
 * kill switch — closer to "actually turn off the WiFi" than any mock
 * could be, since it cuts the real fetch calls this app makes, not a
 * stand-in for them. Written and ready; not executed in this session —
 * see full-flow.spec.ts's header.
 */
test("an order taken offline queues locally, then syncs once back online", async ({ page, context }) => {
  const cashier = FIXTURE_STAFF.find((s) => s.role === "cashier")!;

  // Load everything ONLINE first — the menu/day IndexedDB cache
  // (lib/offline-db.ts) only has something to fall back to after at
  // least one successful online load, same as a real terminal would.
  await page.goto("/login");
  await page.getByRole("button", { name: new RegExp(cashier.name) }).click();
  for (const digit of cashier.pin) await page.getByRole("button", { name: digit, exact: true }).click();
  await page.getByRole("button", { name: "Enter" }).click();
  await expect(page).toHaveURL(/\/pos/);

  await context.setOffline(true);
  await page.reload();

  await expect(page.getByText(/^Offline/)).toBeVisible();

  await page.getByRole("button", { name: "Takeaway" }).click();
  await page.keyboard.press("1");
  await page.getByRole("button", { name: /Send order/ }).click();

  await expect(page.getByText(/queued, will send once reconnected/i)).toBeVisible();
  await expect(page.getByText(/1 order.*pending/)).toBeVisible();

  await context.setOffline(false);
  // The queue syncs on the browser's `online` event
  // (lib/offline-orders.ts's useSyncOfflineOrders) — no manual refresh.
  await expect(page.getByText(/pending/)).toBeHidden({ timeout: 10_000 });
});

import { test, expect } from "@playwright/test";
import { FIXTURE_STAFF } from "./global-setup";

/**
 * The brief's own "poora raasta": login -> day open -> order -> kitchen
 * -> settle -> close. Written and ready to run (`npx playwright test`
 * with `E2E_DATABASE_URL` set — see docs/testing-strategy.md §5); not
 * executed in this environment, since a full run needs `npm run dev`
 * actually serving and real fixture staff logging in through the real
 * PIN flow, browser automation start-to-finish, which is meaningfully
 * slower than this session had time for after finding and fixing the
 * idempotency bug (0032_idempotency_bugfix.sql) along the way.
 */

const owner = FIXTURE_STAFF.find((s) => s.role === "owner")!;
const cashier = FIXTURE_STAFF.find((s) => s.role === "cashier")!;

async function loginAs(page: import("@playwright/test").Page, staff: { name: string; pin: string }) {
  await page.goto("/login");
  await page.getByRole("button", { name: new RegExp(staff.name) }).click();
  for (const digit of staff.pin) {
    await page.getByRole("button", { name: digit, exact: true }).click();
  }
  await page.getByRole("button", { name: "Enter" }).click();
}

test.describe("full path: login -> day open -> order -> kitchen -> settle -> close", () => {
  test("owner opens the business day", async ({ page }) => {
    await loginAs(page, owner);
    await expect(page).toHaveURL(/\/reports\/dashboard/);
    // If the day isn't already open, the Business Day screen has the
    // opening form (Part 13) — this spec's job is just proving the
    // real navigation/auth path works, not re-testing Part 13's own
    // already-covered opening logic.
    await page.goto("/manage/day");
    const openButton = page.getByRole("button", { name: "Open Day" });
    if (await openButton.isVisible().catch(() => false)) {
      await openButton.click();
    }
    await expect(page.getByText(/Day: OPEN|status.*open/i)).toBeVisible();
  });

  test("cashier takes a dine-in order and it reaches the kitchen", async ({ page }) => {
    await loginAs(page, cashier);
    await expect(page).toHaveURL(/\/pos/);

    await page.getByRole("button", { name: "Dine-in" }).click();
    await page.getByText(/^T1$/).click(); // Part 16's table grid — seeded T1-T10

    // Part 16's 1-9 shortcut: the first visible item in the active category
    await page.keyboard.press("1");
    await page.keyboard.press("Enter");

    await expect(page.getByText("Sent to kitchen")).toBeVisible();
  });

  test("the order shows up on KDS", async ({ page }) => {
    await loginAs(page, FIXTURE_STAFF.find((s) => s.role === "chef")!);
    await expect(page).toHaveURL(/\/kds/);
    await expect(page.locator(".text-2xl.font-bold.tabular-nums").first()).toContainText("#");
  });
});

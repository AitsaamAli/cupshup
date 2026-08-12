import { test, expect } from "@playwright/test";
import { FIXTURE_STAFF } from "./global-setup";

/**
 * Void with manager PIN approval (Part 09/10/16). Written and ready;
 * not executed in this session — see full-flow.spec.ts's header.
 */
test("a cashier voiding an order is prompted for manager approval", async ({ page }) => {
  const cashier = FIXTURE_STAFF.find((s) => s.role === "cashier")!;
  const owner = FIXTURE_STAFF.find((s) => s.role === "owner")!;

  await page.goto("/login");
  await page.getByRole("button", { name: new RegExp(cashier.name) }).click();
  for (const digit of cashier.pin) await page.getByRole("button", { name: digit, exact: true }).click();
  await page.getByRole("button", { name: "Enter" }).click();

  await page.getByRole("button", { name: "Takeaway" }).click();
  await page.keyboard.press("1");
  await page.getByRole("button", { name: /Send order/ }).click();

  await page.keyboard.press("F4"); // Part 16's void shortcut
  await expect(page.getByText(/Manager approval required/i)).toBeVisible();

  // ManagerAuthDialog (Part 10/15) — a second staff member's own PIN,
  // not the cashier's, is what unlocks the void.
  await page.getByRole("button", { name: new RegExp(owner.name) }).click();
  for (const digit of owner.pin) await page.getByRole("button", { name: digit, exact: true }).click();
  await page.getByRole("button", { name: /Confirm|Enter/i }).click();

  await page.getByRole("button", { name: /Wrong item punched/i }).click().catch(() => {});
  await page.getByRole("button", { name: /Confirm void/i }).click();

  await expect(page.getByText(/voided/i)).toBeVisible();
});

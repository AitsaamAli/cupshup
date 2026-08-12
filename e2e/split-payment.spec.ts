import { test, expect } from "@playwright/test";
import { FIXTURE_STAFF } from "./global-setup";

/**
 * Split payment at settlement — each method taxed at its own rate
 * (Part 10). Written and ready; not executed in this session — see
 * full-flow.spec.ts's header for why, and docs/testing-strategy.md §5
 * for exactly what running the whole suite needs.
 */
test("settling a bill split across cash and card taxes each portion independently", async ({ page }) => {
  const cashier = FIXTURE_STAFF.find((s) => s.role === "cashier")!;
  await page.goto("/login");
  await page.getByRole("button", { name: new RegExp(cashier.name) }).click();
  for (const digit of cashier.pin) await page.getByRole("button", { name: digit, exact: true }).click();
  await page.getByRole("button", { name: "Enter" }).click();

  await page.getByRole("button", { name: "Takeaway" }).click();
  await page.keyboard.press("1");
  await page.getByRole("button", { name: /Send order/ }).click();
  await page.getByRole("button", { name: /Settle/i }).click();

  await page.getByRole("button", { name: "+ Add split" }).click();
  const splitRows = page.locator("text=Method").locator("..");
  await splitRows.nth(1).getByLabel("Method").selectOption("card");

  const amountFields = page.getByLabel(/Amount \(Rs, pre-tax\)/);
  await amountFields.nth(0).fill("1000");
  await amountFields.nth(1).fill("407");

  await expect(page.getByText(/Tax: Rs 160\.00/)).toBeVisible();
  await expect(page.getByText(/Tax: Rs 33\.00/)).toBeVisible();

  await page.getByRole("button", { name: "Settle" }).click();
  await expect(page.getByText(/settled/i)).toBeVisible();
});

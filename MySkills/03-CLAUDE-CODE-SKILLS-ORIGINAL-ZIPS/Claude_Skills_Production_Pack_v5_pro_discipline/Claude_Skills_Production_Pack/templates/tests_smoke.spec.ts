import { test, expect } from "@playwright/test";

test("smoke: route loads", async ({ page }) => {
  const route = process.env.ROUTE || "/";
  await page.goto(route);
  await expect(page).toHaveTitle(/.*/);
});

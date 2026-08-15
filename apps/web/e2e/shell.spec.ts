import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const appOrigin = `http://127.0.0.1:${process.env.PORT ?? "3000"}`;

test.beforeEach(async ({ page }) => {
  await page.route("**/auth/me", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: {
        "Access-Control-Allow-Origin": appOrigin,
        "Access-Control-Allow-Credentials": "true",
      },
      body: JSON.stringify({
        id: "00000000-0000-0000-0000-000000000001",
        email: "jerryxiang24@gmail.com",
        is_library_public: false,
      }),
    });
  });
  await page.goto("/settings");
});

test("renders an accessible responsive authenticated shell", async ({ page }, testInfo) => {
  await expect(page.getByRole("link", { name: "Add Recipe" })).toBeVisible();
  const navigationMenu = page.getByRole("button", { name: "Open navigation menu" });
  if (testInfo.project.name === "desktop") {
    await expect(navigationMenu).toBeHidden();
  } else {
    await expect(navigationMenu).toBeVisible();
    await navigationMenu.click();
  }
  await expect(page.getByRole("link", { name: "Library" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Planner" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Shopping" })).toBeVisible();
  const results = await new AxeBuilder({ page }).include("header").analyze();
  expect(results.violations).toEqual([]);
  await expect(page.locator("header")).toHaveScreenshot("authenticated-shell.png", {
    animations: "disabled",
  });
});

test("closes the account menu with Escape and restores focus", async ({ page }) => {
  const account = page.getByRole("button", { name: /Account/ });
  await account.click();
  await expect(page.getByRole("link", { name: "Settings" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(account).toBeFocused();
});

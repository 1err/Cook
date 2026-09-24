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
  await expect(page.getByRole("heading", { level: 1, name: "Settings", exact: true })).toBeVisible();
  if (testInfo.project.name === "desktop") {
    const geometry = await page.locator("header > div").evaluate((inner) => {
      const rect = inner.getBoundingClientRect();
      const main = document.querySelector("main")!.getBoundingClientRect();
      return {
        headingFont: parseFloat(getComputedStyle(document.querySelector("h1")!).fontSize),
        left: rect.left,
        right: window.innerWidth - rect.right,
        width: rect.width,
        mainWidth: main.width,
        mainLeft: main.left,
        rootFont: parseFloat(getComputedStyle(document.documentElement).fontSize),
        headerHeight: inner.parentElement!.getBoundingClientRect().height,
      };
    });
    expect(geometry.width).toBeCloseTo(1024, 0);
    expect(geometry.mainWidth).toBeCloseTo(1024, 0);
    expect(Math.abs(geometry.mainLeft - geometry.left)).toBeLessThanOrEqual(1);
    expect(geometry.rootFont).toBe(16);
    expect(geometry.headerHeight).toBeGreaterThanOrEqual(56);
    expect(geometry.headerHeight).toBeLessThanOrEqual(57);
    expect(geometry.headingFont).toBe(32);
    expect(Math.abs(geometry.left - geometry.right)).toBeLessThanOrEqual(1);
  }
  if (testInfo.project.name === "phone") {
    const headerHeight = await page.locator("header").evaluate((header) => header.getBoundingClientRect().height);
    expect(headerHeight).toBeGreaterThanOrEqual(72);
    expect(headerHeight).toBeLessThanOrEqual(73);
    expect(await page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).fontSize))).toBe(16);
  }
  await expect(page.getByRole("link", { name: "Add Recipe" })).toBeVisible();
  const navigationMenu = page.getByRole("button", { name: "Open navigation menu" });
  if (testInfo.project.name !== "tablet") {
    await expect(navigationMenu).toBeHidden();
  } else {
    await expect(navigationMenu).toBeVisible();
    const closedHeaderHeight = await page.locator("header").evaluate((header) => header.getBoundingClientRect().height);
    await navigationMenu.click();
    const openHeaderHeight = await page.locator("header").evaluate((header) => header.getBoundingClientRect().height);
    expect(Math.abs(openHeaderHeight - closedHeaderHeight)).toBeLessThanOrEqual(1);
  }
  if (testInfo.project.name === "phone") {
    const navLayout = await page.getByRole("navigation", { name: "Main", exact: true }).evaluate((nav) => ({
      bottom: nav.getBoundingClientRect().bottom,
      position: getComputedStyle(nav).position,
      viewportBottom: window.innerHeight,
    }));
    expect(navLayout.position).toBe("fixed");
    expect(Math.abs(navLayout.bottom - navLayout.viewportBottom)).toBeLessThanOrEqual(1);
  }
  await expect(page.getByRole("link", { name: "Library" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Planner" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Cook" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Shopping" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Main", exact: true }).getByRole("link")).toHaveText(["Library", "Planner", "Shopping", "Cook"]);
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

test("uses the editorial serif family for the brand and page title", async ({ page }) => {
  const brand = page.locator('a[aria-label="Chef World"] span:last-child');
  const pageTitle = page.getByRole("heading", { level: 1 });
  await expect(brand).toHaveCount(1);
  await expect(pageTitle).toBeVisible();
  const fontFamilies = {
    brand: await brand.evaluate((element) => getComputedStyle(element).fontFamily),
    pageTitle: await pageTitle.evaluate((element) => getComputedStyle(element).fontFamily),
  };

  expect(fontFamilies.brand).toMatch(/^"?Source Serif 4/);
  expect(fontFamilies.pageTitle).toMatch(/^"?Source Serif 4/);
});

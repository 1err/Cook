import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const publicPages = [
  ["/", /A little closer/],
  ["/about", "About Chef World"],
  ["/privacy", "Privacy Notice"],
  ["/terms", "Terms of Use"],
  ["/contact", "Contact Chef World"],
] as const;

async function expiredSession(page: Page) {
  await page.route("**/auth/me", (route) => route.fulfill({
    status: 401,
    headers: { "Access-Control-Allow-Origin": `http://127.0.0.1:${process.env.PORT ?? "3000"}`, "Access-Control-Allow-Credentials": "true" },
    contentType: "application/json",
    body: JSON.stringify({ detail: "Not authenticated" }),
  }));
  await page.route("**/auth/logout", (route) => route.fulfill({ status: 200, body: "{}" }));
}

for (const [path, title] of publicPages) {
  test(`public ${path} stays readable without an account and has an accessible responsive layout`, async ({ page }) => {
    await expiredSession(page);
    await page.addInitScript(() => localStorage.setItem("cooking-ui-language", "zh"));
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const response = await page.goto(path);
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`${path === "/" ? "/" : path}$`));
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page.getByRole("button", { name: "中文", exact: true })).toHaveCount(0);
    await expect(page.getByRole("banner").getByRole("link", { name: "Open app", exact: true })).toHaveAttribute("href", "/library");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    if (path === "/") await page.getByRole("main").getByRole("link", { name: "Open app", exact: true }).hover();
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
    expect(results.violations, JSON.stringify(results.violations)).toEqual([]);
    expect(errors).toEqual([]);
  });
}

test("consistent page navigation and a direct app entrance work", async ({ page }) => {
  await expiredSession(page);
  await page.goto("/");
  const mainNav = page.getByRole("navigation", { name: "Main", exact: true });
  const footerNav = page.getByRole("navigation", { name: "Site information", exact: true });
  const expected = [["Home", "/"], ["About", "/about"], ["Contact", "/contact"], ["Privacy", "/privacy"], ["Terms", "/terms"]];
  for (const nav of [mainNav, footerNav]) {
    expect(await nav.locator("a").evaluateAll((links) => links.map((link) => [link.textContent, link.getAttribute("href")]))).toEqual(expected);
    await expect(nav.getByRole("link", { name: "Home", exact: true })).toHaveAttribute("aria-current", "page");
  }
  await mainNav.getByRole("link", { name: "About", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("About Chef World");
  await expect(mainNav.getByRole("link", { name: "About", exact: true })).toHaveAttribute("aria-current", "page");
  await footerNav.getByRole("link", { name: "Contact", exact: true }).click();
  await expect(page).toHaveURL(/\/contact$/);
  await expect(page.getByRole("link", { name: "jerryxiang24@gmail.com" }).first()).toHaveAttribute("href", "mailto:jerryxiang24@gmail.com");
  await page.getByRole("banner").getByRole("link", { name: "Open app", exact: true }).click();
  await expect(page).toHaveURL(/\/login\?redirect=%2Flibrary/);
});

test("English public pages preserve the user's Chinese app preference", async ({ page }) => {
  await expiredSession(page);
  await page.addInitScript(() => localStorage.setItem("cooking-ui-language", "zh"));
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(/A little closer/);
  expect(await page.evaluate(() => localStorage.getItem("cooking-ui-language"))).toBe("zh");
  await expect(page.getByRole("list", { name: "From recipe to dinner" }).getByRole("listitem")).toHaveText(["01Save a recipe", "02Plan a meal", "03Buy groceries", "04Cook with guidance"]);
  await page.getByRole("main").getByRole("link", { name: "Open app", exact: true }).click();
  await expect(page).toHaveURL(/\/login\?redirect=%2Flibrary/);
  await expect(page.locator("html")).toHaveAttribute("lang", "zh");
  expect(await page.evaluate(() => localStorage.getItem("cooking-ui-language"))).toBe("zh");
  await page.getByRole("navigation", { name: "Site information", exact: true }).getByRole("link", { name: "Home", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
});

test("public content works without the backend and without JavaScript", async ({ page, browser, baseURL }) => {
  await page.route("**/auth/me", (route) => route.abort());
  await page.goto("/privacy");
  await expect(page.getByRole("heading", { level: 1, name: "Privacy Notice" })).toBeVisible();
  await page.getByRole("navigation", { name: "Main", exact: true }).getByRole("link", { name: "Home", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: /A little closer/ })).toBeVisible();
  const context = await browser.newContext({ javaScriptEnabled: false, baseURL });
  try {
    const staticPage = await context.newPage();
    await staticPage.goto("/");
    await expect(staticPage.getByRole("heading", { level: 1, name: /A little closer/ })).toBeVisible();
    await staticPage.getByRole("navigation", { name: "Main", exact: true }).getByRole("link", { name: "Privacy", exact: true }).click();
    await expect(staticPage.getByRole("heading", { level: 1, name: "Privacy Notice" })).toBeVisible();
  } finally {
    await context.close();
  }
});

test("private workspace requires sign-in and auth pages retain the original photo and public policies", async ({ page }) => {
  await expiredSession(page);
  await page.goto("/library");
  await expect(page).toHaveURL(/\/login\?redirect=%2Flibrary/);
  for (const path of ["/login", "/register"]) {
    await page.goto(path);
    const heroPhoto = page.locator(".auth-hero__img");
    await expect(heroPhoto).toHaveAttribute("src", "/brand/login-original.jpg");
    await expect.poll(() => heroPhoto.evaluate((element) => {
      const image = element as HTMLImageElement;
      return image.complete && image.naturalWidth > 0;
    })).toBe(true);
    await expect(page.getByRole("link", { name: "Privacy", exact: true })).toHaveAttribute("href", "/privacy");
    await expect(page.getByRole("link", { name: "Terms", exact: true })).toHaveAttribute("href", "/terms");
    await expect(page.getByRole("link", { name: "Contact", exact: true })).toHaveAttribute("href", "/contact");
  }
});

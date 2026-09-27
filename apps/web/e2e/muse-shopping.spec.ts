import AxeBuilder from "@axe-core/playwright";
import { mkdir } from "node:fs/promises";
import { expect, test, type Locator, type Page, type Route, type TestInfo } from "@playwright/test";
import { API_BASE } from "./api";

type Product = { name: string; price: string; image: string; url: string };
type ShoppingItem = { name: string; suggested_purchase: string; category: string };
const appOrigin = `http://127.0.0.1:${process.env.PORT ?? "3000"}`;
const screenshotDirectory = "/private/tmp/chef-muse-review-ui-20260926/screenshots";
const products: Record<string, Product[]> = {
  Tofu: [{ name: "Firm tofu 350 g", price: "$2.50", image: "", url: "https://www.sayweee.com/product/tofu" }],
  Rice: [
    { name: "Jasmine rice bag", price: "$5.00", image: "", url: "https://www.sayweee.com/product/rice" },
    { name: "Brown rice bag", price: "$6.00", image: "", url: "https://www.sayweee.com/product/brown-rice" },
  ],
  Ginger: [],
};
const items: ShoppingItem[] = [
  { name: "Tofu", suggested_purchase: "600 g", category: "Other" },
  { name: "Rice", suggested_purchase: "2 cups", category: "Pantry & Dry Goods" },
  { name: "Ginger", suggested_purchase: "1 knob", category: "Produce" },
];

async function fulfillJson(route: Route, body: unknown, status = 200) {
  await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body), headers: {
    "Access-Control-Allow-Origin": appOrigin,
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Headers": "Content-Type, X-Cw-Visitor, X-Cw-Session, X-Cw-Event-Id, X-Cw-Source, X-Cw-Medium, X-Cw-Campaign, X-Cw-Referrer",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  } });
}

async function prepare(page: Page, options: { tofuAmount?: string; longList?: boolean } = {}) {
  const manyItems: ShoppingItem[] = Array.from({ length: 25 }, (_, index) => ({
    name: `Pantry ingredient ${String(index + 1).padStart(2, "0")}`,
    suggested_purchase: "600 g", category: "Pantry & Dry Goods",
  }));
  const state = {
    items: options.longList ? manyItems : items.map((item) => item.name === "Tofu" ? { ...item, suggested_purchase: options.tofuAmount ?? "600 g" } : { ...item }),
    products: (options.longList ? Object.fromEntries(manyItems.map((item, index) => [item.name, [{
      name: `Wholegrain pantry ingredient ${String(index + 1).padStart(2, "0")} — family kitchen selection 350 g`,
      price: "$2.50", image: "", url: `https://www.sayweee.com/product/pantry-${index + 1}`,
    }]])) : products) as Record<string, Product[]>,
    failRefine: false, refineRequests: 0, unexpected: [] as string[],
  };
  await page.addInitScript(() => localStorage.setItem("cooking-ui-language", "en"));
  // Every API request uses local fixture data; these tests never contact a retailer.
  await page.route(`${API_BASE}/**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const now = new Date();
    const expires = new Date(now.getTime() + 3_600_000).toISOString();
    if (request.method() === "OPTIONS") return fulfillJson(route, {});
    if (url.pathname === "/analytics/events") return fulfillJson(route, { ok: true }, 202);
    if (url.pathname === "/auth/me") return fulfillJson(route, { id: "muse-test", email: "muse-test@example.com", email_verified: true, email_verification_required: false, is_library_public: false });
    if (url.pathname === "/shopping-list") return fulfillJson(route, state.items.map(({ name, suggested_purchase }) => ({ name, total_quantity: suggested_purchase })));
    if (url.pathname === "/shopping-list/refine") {
      state.refineRequests += 1;
      return state.failRefine
        ? fulfillJson(route, { detail: "Fixture shopping-list refresh failed" }, 503)
        : fulfillJson(route, { purchase_items: state.items, likely_pantry: [], remove: [] });
    }
    if (url.pathname === "/meal-plan" || url.pathname === "/recipes") return fulfillJson(route, []);
    if (url.pathname === "/store-products/batch") {
      const { queries } = request.postDataJSON() as { queries: string[] };
      return fulfillJson(route, { server_time: now.toISOString(), entries: queries.map((query) => ({ query, status: state.products[query]?.length ? "fresh" : "missing", products: state.products[query] ?? [], expires_at: state.products[query]?.length ? expires : null })) });
    }
    if (url.pathname === "/store-products") {
      const matches = state.products[url.searchParams.get("query") ?? ""] ?? [];
      return fulfillJson(route, { products: matches, expires_at: matches.length ? expires : null, server_time: now.toISOString() });
    }
    state.unexpected.push(`${request.method()} ${url.pathname}`);
    return route.abort();
  });
  await page.goto("/shopping-list?week=2026-09-21");
  await page.getByRole("button", { name: "Prepare smart shopping list" }).click();
  await page.getByRole("button", { name: "Load top picks from Weee" }).click();
  await expect(page.getByRole("button", { name: `Review Weee cart (${options.longList ? 25 : 2})` })).toBeVisible();
  return state;
}

async function openReview(page: Page) {
  await page.getByRole("button", { name: "Prepare with Muse", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Prepare with Muse", exact: true });
  await expect(dialog).toBeVisible();
  return dialog;
}

function productDetails(dialog: Locator, name: string) {
  return dialog.getByLabel(`Details for ${name}`, { exact: true });
}

function preferences(dialog: Locator) {
  return dialog.getByLabel("Shopping preferences", { exact: true });
}

async function expectNoHorizontalOverflow(page: Page, dialog: Locator) {
  const geometry = await dialog.evaluate((element) => ({ scroll: element.scrollWidth, client: element.clientWidth }));
  expect(geometry.scroll).toBeLessThanOrEqual(geometry.client + 1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
}

async function screenshot(page: Page, info: TestInfo, state: string) {
  await mkdir(screenshotDirectory, { recursive: true });
  await page.screenshot({ path: `${screenshotDirectory}/${state}-${info.project.name}.png`, animations: "disabled" });
}

async function copiedRequest(page: Page, dialog: Locator) {
  await dialog.getByRole("button", { name: "Confirm quantities & copy", exact: true }).click();
  await expect(dialog.getByRole("status")).toHaveText("Copied. Open Muse and paste your request.");
  await expect(dialog.getByRole("button", { name: "Copy again", exact: true })).toBeEnabled();
  await expect(dialog.getByRole("link", { name: "Open Muse", exact: true })).toHaveAttribute("href", "https://muse.ai/");
  return page.evaluate(() => navigator.clipboard.readText());
}

test("reviews collapsed details and preferences, copies exact products, and preserves manual cart progress", async ({ page, context }, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const state = await prepare(page);
  await page.getByRole("radio", { name: "Choose Brown rice bag for cart" }).check();
  const dialog = await openReview(page);
  await expect(dialog.getByRole("checkbox")).toHaveCount(0);
  await expect(dialog.getByRole("spinbutton", { name: "Total packs of Firm tofu 350 g" })).toHaveValue("2");
  await expect(dialog.getByText("Calculated", { exact: true })).toBeVisible();
  await expect(dialog.getByText(/600 g on your list.*350 g per pack/)).toBeHidden();
  await expect(dialog.getByRole("textbox", { name: "Package size for Firm tofu 350 g" })).toBeHidden();
  await productDetails(dialog, "Firm tofu 350 g").click();
  await expect(dialog.getByText(/600 g on your list.*350 g per pack/)).toBeVisible();
  await expect(dialog.getByRole("textbox", { name: "Package size for Firm tofu 350 g" })).toBeVisible();
  await productDetails(dialog, "Brown rice bag").click();
  await dialog.getByRole("textbox", { name: "Package size for Brown rice bag" }).fill("4 cups");
  await expect(dialog.getByRole("spinbutton", { name: "Total packs of Brown rice bag" })).toHaveValue("1");
  await expect(dialog.getByRole("textbox", { name: /Budget for these products/ })).toBeHidden();
  await preferences(dialog).click();
  await dialog.getByRole("textbox", { name: /Budget for these products/ }).fill("25.00");
  await dialog.getByRole("radio", { name: "Skip it and tell me" }).check();
  const text = await copiedRequest(page, dialog);
  expect(text).toContain('"totalPacksInCart":2');
  expect(text).toContain('"reviewedPackageSize":"4 cups"');
  expect(text).toContain("https://www.sayweee.com/product/brown-rice");
  expect(text).not.toContain("https://www.sayweee.com/product/rice\"");
  expect(text).toContain("$25.00");
  expect(text).toContain("do not substitute");
  expect(text).toContain('"name":"Ginger"');
  expect(text).toContain("Stop before checkout");
  await expectNoHorizontalOverflow(page, dialog);
  await screenshot(page, info, "review-copied");
  await dialog.getByRole("button", { name: "Close Muse shopping review" }).click();
  await expect(page.getByRole("button", { name: "Prepare with Muse", exact: true })).toBeFocused();
  await page.getByRole("button", { name: "Review Weee cart (2)" }).click();
  await expect(page.getByText("0 marked as added", { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
  expect(state.unexpected).toEqual([]);
});

test("confirms estimates and starting counts through the primary copy action and resets copied feedback after edits", async ({ page, context }, info) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await prepare(page, { tofuAmount: "约600 g" });
  const dialog = await openReview(page);
  await expect(dialog.getByText("Estimate", { exact: true })).toBeVisible();
  await expect(dialog.getByText("Check amount", { exact: true })).toBeVisible();
  await expect(dialog.getByRole("spinbutton", { name: "Total packs of Jasmine rice bag" })).toHaveValue("1");
  await expect(dialog.getByRole("checkbox")).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "Confirm quantities & copy", exact: true })).toBeEnabled();
  const request = await copiedRequest(page, dialog);
  expect(request).toContain('"quantitySource":"estimated"');
  expect(request).toContain('"quantitySource":"starting"');
  expect(request).toContain("not proof that one pack is enough");
  await preferences(dialog).click();
  await dialog.getByRole("textbox", { name: /Budget for these products/ }).fill("25");
  await expect(dialog.getByRole("status")).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "Confirm quantities & copy", exact: true })).toBeEnabled();
  const updated = await copiedRequest(page, dialog);
  expect(updated).toContain("$25.00");
  expect(updated).not.toBe(request);
  await expectNoHorizontalOverflow(page, dialog);
  await screenshot(page, info, "estimates-copied");
});

test("excludes pantry items, preserves deliberate counts, and resets on a changed week", async ({ page }) => {
  await prepare(page);
  await page.getByRole("checkbox", { name: "Mark Rice as already have" }).check();
  let dialog = await openReview(page);
  await expect(dialog.getByRole("spinbutton")).toHaveCount(1);
  await expect(dialog.getByRole("spinbutton")).toHaveValue("2");
  await dialog.getByRole("spinbutton").fill("3");
  await dialog.getByRole("button", { name: "Close Muse shopping review" }).click();
  dialog = await openReview(page);
  await expect(dialog.getByRole("spinbutton")).toHaveValue("3");
  await productDetails(dialog, "Firm tofu 350 g").click();
  await dialog.getByRole("button", { name: "Use suggested quantity for Firm tofu 350 g" }).click();
  await expect(dialog.getByRole("spinbutton")).toHaveValue("2");
  await dialog.getByRole("button", { name: "Close Muse shopping review" }).click();
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await page.getByRole("button", { name: "Prepare smart shopping list" }).click();
  await page.getByRole("button", { name: "Load top picks from Weee" }).click();
  await expect(page.getByRole("button", { name: "Review Weee cart (2)" })).toBeVisible();
  dialog = await openReview(page);
  await expect(dialog.getByRole("spinbutton", { name: "Total packs of Firm tofu 350 g" })).toHaveValue("2");
});

test("focuses invalid quantities and collapsed budget fields without copying", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await prepare(page);
  await page.evaluate(() => navigator.clipboard.writeText("muse-review-unchanged"));
  const dialog = await openReview(page);
  const quantity = dialog.getByRole("spinbutton", { name: "Total packs of Firm tofu 350 g" });
  await quantity.fill("0");
  await dialog.getByRole("button", { name: "Fix quantities", exact: true }).click();
  await expect(quantity).toBeFocused();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("muse-review-unchanged");
  await quantity.fill("2");
  await preferences(dialog).click();
  const budget = dialog.getByRole("textbox", { name: /Budget for these products/ });
  await budget.fill("-1");
  await preferences(dialog).click();
  await expect(budget).toBeHidden();
  await dialog.getByRole("button", { name: "Fix budget", exact: true }).click();
  await expect(budget).toBeVisible();
  await expect(budget).toBeFocused();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("muse-review-unchanged");
  await budget.fill("25");
  expect(await copiedRequest(page, dialog)).toContain("$25.00");
});

test("keeps stale refresh errors actionable and resets product choices after a successful update", async ({ page }) => {
  const state = await prepare(page);
  await page.getByRole("radio", { name: "Choose Brown rice bag for cart" }).check();
  const dialog = await openReview(page);
  await dialog.getByRole("spinbutton", { name: "Total packs of Firm tofu 350 g" }).fill("7");
  await page.evaluate(() => {
    localStorage.setItem("plannerWeekFingerprint:2026-09-21:user:muse-test", "changed-in-another-planner-tab");
    window.dispatchEvent(new Event("focus"));
  });
  state.failRefine = true;
  await dialog.getByRole("button", { name: "Update shopping list", exact: true }).click();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("alert").filter({ hasText: /failed|could not|couldn’t|unable/i })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Update shopping list", exact: true })).toBeEnabled();
  expect(state.refineRequests).toBe(2);
  state.failRefine = false;
  state.items = state.items.map((item) => item.name === "Tofu" ? { ...item, suggested_purchase: "900 g" } : item);
  await page.evaluate(() => localStorage.removeItem("plannerWeekFingerprint:2026-09-21:user:muse-test"));
  await dialog.getByRole("button", { name: "Update shopping list", exact: true }).click();
  await expect(dialog).toBeHidden();
  await page.getByRole("button", { name: "Load top picks from Weee" }).click();
  await expect(page.getByRole("button", { name: "Review Weee cart (2)" })).toBeVisible();
  const refreshedDialog = await openReview(page);
  await expect(refreshedDialog.getByRole("spinbutton", { name: "Total packs of Firm tofu 350 g" })).toHaveValue("3");
  await expect(refreshedDialog.getByRole("spinbutton", { name: "Total packs of Jasmine rice bag" })).toBeVisible();
  await expect(refreshedDialog.getByRole("spinbutton", { name: "Total packs of Brown rice bag" })).toHaveCount(0);
  expect(state.refineRequests).toBe(3);
});

test("keeps the footer actionable through a 25-product review without horizontal overflow", async ({ page, context }, info) => {
  test.setTimeout(60_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const state = await prepare(page, { longList: true });
  const dialog = await openReview(page);
  const confirm = dialog.getByRole("button", { name: "Confirm quantities & copy", exact: true });
  await expect(dialog.getByRole("spinbutton")).toHaveCount(25);
  await expect(confirm).toBeInViewport({ ratio: 1 });
  await expectNoHorizontalOverflow(page, dialog);
  await screenshot(page, info, "long-list-top");
  await dialog.getByRole("spinbutton").last().scrollIntoViewIfNeeded();
  await expect(confirm).toBeInViewport({ ratio: 1 });
  await expectNoHorizontalOverflow(page, dialog);
  await screenshot(page, info, "long-list-bottom");
  const accessibility = await new AxeBuilder({ page }).include("dialog[open]").withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  expect(accessibility.violations).toEqual([]);
  const request = await copiedRequest(page, dialog);
  const dataLine = request.split("\n").find((line) => line.startsWith("SHOPPING_DATA_JSON = "))!;
  const data = JSON.parse(dataLine.slice("SHOPPING_DATA_JSON = ".length));
  expect(data.products).toHaveLength(25);
  expect(data.products.every((product: { totalPacksInCart: number }) => product.totalPacksInCart === 2)).toBe(true);
  expect(data.products.map((product: { url: string }) => product.url)).toEqual(state.items.map((_, index) => `https://www.sayweee.com/product/pantry-${index + 1}`));
  await expect(dialog.getByRole("link", { name: "Open Muse", exact: true })).toBeInViewport({ ratio: 1 });
  await expectNoHorizontalOverflow(page, dialog);
  await screenshot(page, info, "long-list-copied");
  expect(errors).toEqual([]);
  expect(state.unexpected).toEqual([]);
});

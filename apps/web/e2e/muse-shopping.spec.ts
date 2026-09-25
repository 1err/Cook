import { expect, test, type Page } from "@playwright/test";
import { API_BASE } from "./api";

const products = {
  Tofu: [{ name: "Firm tofu 350 g", price: "$2.50", image: "", url: "https://www.sayweee.com/product/tofu" }],
  Rice: [
    { name: "Jasmine rice bag", price: "$5.00", image: "", url: "https://www.sayweee.com/product/rice" },
    { name: "Brown rice bag", price: "$6.00", image: "", url: "https://www.sayweee.com/product/brown-rice" },
  ],
  Ginger: [],
};
const items = [
  { name: "Tofu", suggested_purchase: "600 g", category: "Other" },
  { name: "Rice", suggested_purchase: "2 cups", category: "Pantry & Dry Goods" },
  { name: "Ginger", suggested_purchase: "1 knob", category: "Produce" },
];

async function prepare(page: Page) {
  await page.route(`${API_BASE}/**`, async (route) => {
    const url = new URL(route.request().url());
    const now = new Date(); const expires = new Date(now.getTime() + 3_600_000).toISOString();
    let body: unknown;
    if (url.pathname === "/auth/me") body = { id: "muse-test", email: "muse-test@example.com", is_library_public: false };
    else if (url.pathname === "/shopping-list") body = items.map(({ name, suggested_purchase }) => ({ name, total_quantity: suggested_purchase }));
    else if (url.pathname === "/shopping-list/refine") body = { purchase_items: items, likely_pantry: [], remove: [] };
    else if (url.pathname === "/meal-plan" || url.pathname === "/recipes") body = [];
    else if (url.pathname === "/store-products/batch") {
      const { queries } = route.request().postDataJSON();
      body = { server_time: now.toISOString(), entries: queries.map((query: keyof typeof products) => ({ query, status: products[query]?.length ? "fresh" : "missing", products: products[query] ?? [], expires_at: products[query]?.length ? expires : null })) };
    } else if (url.pathname === "/store-products") {
      const matches = products[url.searchParams.get("query") as keyof typeof products] ?? [];
      body = { products: matches, expires_at: matches.length ? expires : null, server_time: now.toISOString() };
    } else { await route.abort(); return; }
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(body), headers: {
      "Access-Control-Allow-Origin": `http://127.0.0.1:${process.env.PORT ?? "3000"}`,
      "Access-Control-Allow-Credentials": "true",
    } });
  });
  await page.goto("/shopping-list?week=2026-09-21");
  await page.getByRole("button", { name: "Prepare smart shopping list" }).click();
  await page.getByRole("button", { name: "Load top picks from Weee" }).click();
  await expect(page.getByRole("button", { name: "Review Weee cart (2)" })).toBeVisible();
}

test("reviews quantities, copies exact selected products, and preserves manual cart progress", async ({ page, context }, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await prepare(page);
  await page.getByRole("radio", { name: "Choose Brown rice bag for cart" }).check();
  await page.getByRole("button", { name: "Prepare with Muse" }).click();
  const dialog = page.getByRole("dialog", { name: "A little less to do." });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Copy for Muse" })).toBeDisabled();
  await expect(dialog.getByRole("spinbutton", { name: "Total packs of Firm tofu 350 g" })).toHaveValue("2");
  await expect(dialog.getByText("Suggested: 2 packs", { exact: true })).toBeVisible();
  await expect(dialog.getByText("600 g on your list · 350 g per pack")).toBeVisible();
  await expect(dialog.getByText(/Package size isn’t listed/)).toBeVisible();
  await dialog.getByRole("textbox", { name: "Package size for Brown rice bag" }).fill("4 cups");
  await expect(dialog.getByRole("spinbutton", { name: "Total packs of Brown rice bag" })).toHaveValue("1");
  await dialog.getByRole("textbox", { name: /Budget for these products/ }).fill("25.00");
  await dialog.getByRole("radio", { name: "Skip it and tell me" }).check();
  await dialog.getByRole("button", { name: "Copy for Muse" }).click();
  await expect(dialog.getByRole("status")).toContainText("Request copied");
  const text = await page.evaluate(() => navigator.clipboard.readText());
  expect(text).toContain('"totalPacksInCart":2');
  expect(text).toContain('"reviewedPackageSize":"4 cups"');
  expect(text).toContain("https://www.sayweee.com/product/brown-rice");
  expect(text).not.toContain("https://www.sayweee.com/product/rice\"");
  expect(text).toContain("$25.00");
  expect(text).toContain("do not substitute");
  expect(text).toContain('"name":"Ginger"');
  expect(text).toContain("Stop before checkout");
  const metrics = await dialog.evaluate((element) => ({ scroll: element.scrollWidth, client: element.clientWidth }));
  expect(metrics.scroll).toBeLessThanOrEqual(metrics.client + 1);
  await expect(dialog.getByRole("link", { name: /Open Muse/ })).toHaveAttribute("href", "https://muse.ai/");
  await page.screenshot({ path: `/tmp/chef-world-muse-e2e-${info.project.name}.png` });
  await dialog.getByRole("button", { name: "Close Muse shopping review" }).click();
  await expect(page.getByRole("button", { name: "Prepare with Muse" })).toBeFocused();
  await page.getByRole("button", { name: "Review Weee cart (2)" }).click();
  await expect(page.getByText("0 marked as added", { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test("excludes pantry items and resets changed products and weeks", async ({ page }) => {
  await prepare(page);
  await page.getByRole("checkbox", { name: "Mark Rice as already have" }).check();
  await page.getByRole("button", { name: "Prepare with Muse" }).click();
  const dialog = page.getByRole("dialog", { name: "A little less to do." });
  await expect(dialog.getByRole("spinbutton")).toHaveCount(1);
  await expect(dialog.getByRole("spinbutton")).toHaveValue("2");
  await dialog.getByRole("spinbutton").fill("3");
  await dialog.getByRole("button", { name: "Close Muse shopping review" }).click();
  await page.getByRole("button", { name: "Prepare with Muse" }).click();
  await expect(dialog.getByRole("spinbutton")).toHaveValue("3");
  await dialog.getByRole("button", { name: "Use suggested quantity for Firm tofu 350 g" }).click();
  await expect(dialog.getByRole("spinbutton")).toHaveValue("2");
  await dialog.getByRole("button", { name: "Close Muse shopping review" }).click();
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await page.getByRole("button", { name: "Prepare smart shopping list" }).click();
  await page.getByRole("button", { name: "Load top picks from Weee" }).click();
  await expect(page.getByRole("button", { name: "Review Weee cart (2)" })).toBeVisible();
  await page.getByRole("button", { name: "Prepare with Muse" }).click();
  await expect(dialog.getByRole("spinbutton", { name: "Total packs of Firm tofu 350 g" })).toHaveValue("2");
});

import { recipePageFixture } from "./recipePageFixture";
import { expect, test, type Page, type Route } from "@playwright/test";

const appOrigin = `http://127.0.0.1:${process.env.PORT ?? "3000"}`;

function thumbnail(width: number, height: number, color: string) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="${width}" height="${height}" fill="${color}"/></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

const recipes = [
  ["Aubergine clay pot", 640, 850, "#a85136"],
  ["Braised pork", 640, 700, "#7d8a58"],
  ["Chicken stew", 640, 600, "#c17c4f"],
  ["Eggplant tofu", 640, 200, "#a94731"],
  ["Five-spice soy-braised beef", 640, 400, "#8a553c"],
  ["Mapo tofu", 640, 560, "#87564a"],
  ["Scallion eggs", 640, 360, "#b2442e"],
].map(([title, width, height, color], index) => ({
  id: `recipe-${index + 1}`,
  title,
  thumbnail_url: thumbnail(Number(width), Number(height), String(color)),
  ingredients: [
    { name: "First ingredient", quantity: "1" },
    { name: "Second ingredient", quantity: "2" },
    { name: "Third ingredient", quantity: "3" },
  ],
  library_tags: ["chinese", index % 2 ? "weeknight" : "main_dish"],
  total_time_minutes: 45,
}));

const publicRecipes = [
  ["Clay pot rice", 480, 700, "#87564a"],
  ["Scallion noodles", 720, 400, "#556d58"],
  ["Crispy tofu", 600, 600, "#bb704e"],
  ["Red-braised pork", 520, 760, "#9a4337"],
  ["Tea-smoked tofu", 640, 480, "#6f7651"],
].map(([title, width, height, color], index) => ({
  id: `public-${index + 1}`,
  title,
  thumbnail_url: thumbnail(Number(width), Number(height), String(color)),
  ingredients: [{ name: `Hidden public ingredient ${index + 1}`, quantity: "1" }],
  library_tags: ["chinese", index % 2 ? "weeknight" : "main_dish"],
  total_time_minutes: 35 + index * 5,
}));

async function fulfillJson(route: Route, body: unknown) {
  await route.fulfill({
    status: 200,
    contentType: "application/json",
    headers: {
      "Access-Control-Allow-Origin": appOrigin,
      "Access-Control-Allow-Credentials": "true",
    },
    body: JSON.stringify(body),
  });
}

async function installFixtures(page: Page) {
  await page.route("**/auth/me", (route) => fulfillJson(route, {
    id: "00000000-0000-0000-0000-000000000001", email: "library@example.com", is_library_public: false,
  }));
  // These summaries exercise the UI only. Ingredient matching is covered by real PostgreSQL tests.
  await page.route("**/recipes/search/page?*", (route) => {
    const params = new URL(route.request().url()).searchParams;
    const scope = params.get("scope");
    const rows = scope === "mine" ? recipes : scope === "catalog" ? publicRecipes : [...recipes, ...publicRecipes];
    const result = recipePageFixture(rows, route.request().url());
    const items = result.items.map(row => ({ ...row, is_owned: row.id.startsWith("recipe-"),
      matched_ingredients: [], remaining_ingredients: params.get("include_ingredients") === "true" ? ["Garlic", "Ginger"] : null,
    }));
    return fulfillJson(route, { ...result, items, total_count: items.length });
  });
  await page.route("**/recipes/ingredient-options", route => fulfillJson(route, []));
}

async function expectLayout(page: Page, titles: string[], columns: number) {
  const cards = page.getByRole("list", { name: "Recipe library", exact: true }).getByRole("listitem");
  await expect(cards).toHaveCount(titles.length);
  await expect(cards.getByRole("heading", { level: 2 })).toHaveText(titles);
  await expect(async () => {
    const metrics = await cards.evaluateAll(items => items.map(item => {
      const b = item.getBoundingClientRect(); return { x: b.x, y: b.y, right: b.right, bottom: b.bottom };
    }));
    expect(new Set(metrics.map(x => Math.round(x.x))).size).toBe(Math.min(columns, titles.length));
    for (const [i, card] of metrics.entries()) for (const other of metrics.slice(i + 1)) {
      expect(card.right <= other.x || other.right <= card.x || card.bottom <= other.y || other.bottom <= card.y).toBe(true);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }).toPass();
}

const sortedTitles = (rows: typeof recipes) => rows.map(x => String(x.title)).sort((a, b) => a.localeCompare(b));
const allTitles = sortedTitles([...recipes, ...publicRecipes]);

test.beforeEach(async ({ page }) => { await installFixtures(page); await page.goto("/library"); });

test("shows the unified collection with compact photo rows on phones", async ({ page }, testInfo) => {
  const columns = testInfo.project.name === "desktop" ? 3 : testInfo.project.name === "tablet" ? 2 : 1;
  await expectLayout(page, allTitles, columns);
  await expect(page.getByRole("tab", { name: "All recipes", exact: true })).toHaveAttribute("aria-selected", "true");
  const metrics = await page.getByRole("listitem").evaluateAll(cards => cards.map(card => {
    const image = card.querySelector("img")!.parentElement!.getBoundingClientRect();
    const title = card.querySelector("h2")!.getBoundingClientRect();
    return { width: image.width, height: image.height, imageRight: image.right, titleX: title.x, ratio: image.width / image.height };
  }));
  if (testInfo.project.name === "phone") {
    expect(metrics.every(x => x.width === 88 && x.height === 88 && x.titleX >= x.imageRight)).toBe(true);
  } else expect(metrics.every(x => Math.abs(x.ratio - 1.6) < .02)).toBe(true);
  await expect(page.getByText("First ingredient", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Aubergine clay pot", exact: true })).toHaveAttribute("href", "/recipe/recipe-1");
  await expect(page.getByRole("link", { name: "Clay pot rice", exact: true })).toHaveAttribute("href", "/library/public/public-1");
  expect(await page.locator("a button").count()).toBe(0);
});

test("keeps collection and search state when switching between name and ingredients", async ({ page }) => {
  await page.getByRole("tab", { name: "My library", exact: true }).click();
  await expectLayout(page, sortedTitles(recipes), (page.viewportSize()!.width > 840 ? 3 : page.viewportSize()!.width > 640 ? 2 : 1));
  await page.getByRole("searchbox").fill("braised");
  await expect(page.getByRole("listitem")).toHaveCount(2);
  const mode = page.getByRole("combobox", { name: "Search by", exact: true });
  await mode.selectOption("ingredients");
  const input = page.getByRole("combobox", { name: "Search ingredients", exact: true });
  await input.fill("chicken"); await input.press("Enter");
  await page.getByRole("button", { name: "Match any", exact: true }).click();
  await page.getByRole("tab", { name: "Public library", exact: true }).click();
  await expect(page.getByRole("listitem")).toHaveCount(publicRecipes.length);
  await mode.selectOption("name");
  await expect(page.getByRole("searchbox")).toHaveValue("braised");
  await expect(page.getByRole("listitem")).toHaveCount(1);
  await mode.selectOption("ingredients");
  await expect(page.getByRole("button", { name: "Match any", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "Remove chicken", exact: true })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Public library", exact: true })).toHaveAttribute("aria-selected", "true");
});

test("adapts the same collection across desktop, tablet and narrow phones", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "One page exercises resizing at every breakpoint.");
  for (const [width, columns] of [[1440, 3], [1100, 3], [820, 2], [390, 1], [320, 1], [1440, 3]]) {
    await page.setViewportSize({ width, height: 1000 }); await expectLayout(page, allTitles, columns);
  }
});

test("retains title and category filtering with clear empty-result recovery", async ({ page }) => {
  await page.getByRole("tab", { name: "My library", exact: true }).click();
  const search = page.getByRole("searchbox");
  await search.fill("braised"); await expect(page.getByRole("listitem")).toHaveCount(2);
  await search.fill("nothing matches this recipe"); await expect(page.getByText("No matches", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Clear search", exact: true }).click();
  await expect(page.getByRole("listitem")).toHaveCount(recipes.length);
  await page.getByRole("button", { name: "Filter recipes by tag", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Weeknight", exact: true }).click(); await search.click();
  await expect(page.getByRole("listitem").getByRole("heading", { level: 2 })).toHaveText(["Braised pork", "Eggplant tofu", "Mapo tofu"]);
});

test("reveals the remaining ingredient names by hover or tap and dismisses with Escape", async ({ page }, testInfo) => {
  await page.getByRole("combobox", { name: "Search by", exact: true }).selectOption("ingredients");
  const card = page.getByRole("list", { name: "Recipe library", exact: true }).getByRole("listitem").filter({ hasText: "Aubergine clay pot" });
  const more = card.getByRole("button", { name: "2 more ingredients", exact: true });
  if (testInfo.project.name === "phone") await more.tap(); else await more.hover();
  const popup = page.getByRole("tooltip");
  await expect(popup.getByRole("listitem")).toHaveText(["Garlic", "Ginger"]);
  const bounds = await popup.boundingBox();
  expect(bounds).not.toBeNull(); expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  if (testInfo.project.name !== "phone") { await popup.hover(); await expect(popup).toBeVisible(); }
  await page.keyboard.press("Escape"); await expect(popup).toHaveCount(0);
  await page.getByRole("combobox", { name: "Search by", exact: true }).focus();
  await more.focus(); await expect(popup).toBeVisible();
  await page.keyboard.press("Escape"); await expect(popup).toHaveCount(0);
});

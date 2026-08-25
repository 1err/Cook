import { expect, test, type Page, type Route } from "@playwright/test";

const appOrigin = `http://127.0.0.1:${process.env.PORT ?? "3000"}`;

function thumbnail(width: number, height: number, color: string) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="${width}" height="${height}" fill="${color}"/></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

const recipes = [
  ["Hot pot chicken", 500, 680, "#a85136"],
  ["Steamed beef", 640, 360, "#7d8a58"],
  ["Eggplant clay pot", 620, 420, "#c17c4f"],
  ["Tomato beef brisket", 540, 540, "#a94731"],
  ["Braised beef", 640, 400, "#8a553c"],
  ["Mapo tofu", 560, 700, "#b2442e"],
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
  await page.route("**/auth/me", (route) =>
    fulfillJson(route, {
      id: "00000000-0000-0000-0000-000000000001",
      email: "library@example.com",
      is_library_public: false,
    }),
  );
  await page.route("**/recipes/catalog", (route) => fulfillJson(route, publicRecipes));
  await page.route("**/recipes", (route) => fulfillJson(route, recipes));
}

test.beforeEach(async ({ page }) => {
  await installFixtures(page);
  await page.goto("/library");
});

test("uses a compact responsive waterfall for personal recipes", async ({ page }, testInfo) => {
  const expectedColumns = testInfo.project.name === "desktop" ? "3" : testInfo.project.name === "tablet" ? "2" : "1";
  const grid = page.getByRole("list");
  await expect(grid.getByRole("listitem")).toHaveCount(recipes.length);
  await expect(grid).toHaveCSS("column-count", expectedColumns);

  const cardMetrics = await grid.getByRole("listitem").evaluateAll((cards) =>
    cards.map((card) => {
      const media = card.querySelector<HTMLElement>("[class*='_media_']")!;
      const title = card.querySelector<HTMLElement>("h2")!;
      return {
        cardHeight: card.getBoundingClientRect().height,
        mediaHeight: media.getBoundingClientRect().height,
        titleHeight: title.getBoundingClientRect().height,
      };
    }),
  );

  await expect(grid.locator("[data-testid='recipe-ingredients']")).toHaveCount(0);
  await expect(grid.getByText("First ingredient")).toHaveCount(0);
  expect(new Set(cardMetrics.map(({ mediaHeight }) => Math.round(mediaHeight))).size).toBeGreaterThan(2);
  expect(Math.max(...cardMetrics.map(({ titleHeight }) => titleHeight))).toBeLessThan(64);
  expect(Math.max(...cardMetrics.map(({ cardHeight }) => cardHeight))).toBeLessThan(760);
});

test("uses the same natural waterfall rhythm for the public library", async ({ page }, testInfo) => {
  await page.getByRole("tab", { name: "Public library" }).click();

  const expectedColumns = testInfo.project.name === "desktop" ? "3" : testInfo.project.name === "tablet" ? "2" : "1";
  const grid = page.getByRole("list");
  await expect(grid.getByRole("listitem")).toHaveCount(publicRecipes.length);
  await expect(grid).toHaveCSS("column-count", expectedColumns);
  await expect(grid.getByText(/Hidden public ingredient/)).toHaveCount(0);

  const metrics = await grid.getByRole("listitem").evaluateAll((cards) =>
    cards.map((card) => {
      const media = card.querySelector<HTMLElement>("[class*='_publicMedia_']")!;
      const body = card.querySelector<HTMLElement>("[class*='_publicBody_']")!;
      return {
        mediaHeight: Math.round(media.getBoundingClientRect().height),
        bodyMinHeight: getComputedStyle(body).minHeight,
      };
    }),
  );

  expect(new Set(metrics.map(({ mediaHeight }) => mediaHeight)).size).toBeGreaterThan(2);
  expect(metrics.every(({ bodyMinHeight }) => bodyMinHeight === "0px")).toBe(true);

  if (testInfo.project.name === "desktop") {
    await expect(page).toHaveScreenshot("public-library-waterfall.png", {
      animations: "disabled",
      fullPage: true,
    });
  }
});

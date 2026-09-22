import { recipePageFixture } from "./recipePageFixture";
import { expect, test, type Page, type Route } from "@playwright/test";

const appOrigin = `http://127.0.0.1:${process.env.PORT ?? "3000"}`;

function thumbnail(width: number, height: number, color: string) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="${width}" height="${height}" fill="${color}"/></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

const recipes = [
  ["Aubergine clay pot", 640, 350, "#a85136"],
  ["Braised pork", 640, 400, "#7d8a58"],
  ["Chicken stew", 640, 450, "#c17c4f"],
  ["Dumplings", 640, 850, "#a94731"],
  ["Egg fried rice", 640, 750, "#8a553c"],
  ["Five-spice soy-braised beef", 640, 160, "#87564a"],
  ["Mapo tofu", 640, 500, "#b2442e"],
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
  await page.route("**/recipes/catalog/page?*", (route) => fulfillJson(route, recipePageFixture(publicRecipes, route.request().url())));
  await page.route("**/recipes/page?*", (route) => fulfillJson(route, recipePageFixture(recipes, route.request().url())));
}

async function expectWaterfall(page: Page, titles: string[], columnCount: number) {
  const cards = page.getByRole("list").getByRole("listitem");
  await expect(cards).toHaveCount(titles.length);
  await expect.poll(async () => cards.evaluateAll((items) => items.every((item) =>
    Array.from(item.querySelectorAll("img")).every((image) => image.complete),
  ))).toBe(true);

  const rowGap = await page.getByRole("list").evaluate((grid) => parseFloat(getComputedStyle(grid).rowGap));
  await expect(async () => {
    const metrics = await cards.evaluateAll((items) => items.map((item) => {
      const box = item.getBoundingClientRect();
      return { title: item.querySelector("h2")?.textContent, x: box.x, y: box.y, bottom: box.bottom };
    }));
    const columns = [...new Set(metrics.map(({ x }) => Math.round(x)))].sort((a, b) => a - b);
    expect(columns).toHaveLength(Math.min(columnCount, titles.length));
    const nextTop = columns.map(() => Math.min(...metrics.map(({ y }) => y)));
    for (const [index, title] of titles.entries()) {
      const card = metrics.find((item) => item.title === title)!;
      const column = index % columns.length;
      expect(Math.abs(card.x - columns[column]), `${title} should keep its left-to-right column`).toBeLessThan(1);
      expect(Math.abs(card.y - nextTop[column]), `${title} should sit just below the previous card`).toBeLessThan(1);
      nextTop[column] = card.bottom + rowGap;
    }
  }).toPass({ timeout: 5000 });
}

async function expectNaturalPhotos(page: Page) {
  const photos = await page.getByRole("list").locator("img").evaluateAll((images) => images.map((element) => {
    const image = element as HTMLImageElement;
    const box = image.getBoundingClientRect();
    return { displayed: box.width / box.height, original: image.naturalWidth / image.naturalHeight };
  }));
  for (const photo of photos) expect(Math.abs(photo.displayed - photo.original)).toBeLessThan(0.02);
}

test.beforeEach(async ({ page }) => {
  await installFixtures(page);
  await page.goto("/library");
});

test("uses four compact desktop columns with natural photos and left-to-right order", async ({ page }, testInfo) => {
  const expectedColumns = testInfo.project.name === "desktop" ? 4 : 2;
  const grid = page.getByRole("list");
  await expectWaterfall(page, recipes.map(({ title }) => String(title)), expectedColumns);


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
  await expectNaturalPhotos(page);
  expect(cardMetrics.every(({ mediaHeight }) => mediaHeight > 30)).toBe(true);
  expect(Math.max(...cardMetrics.map(({ titleHeight }) => titleHeight))).toBeLessThan(64);
  expect(Math.max(...cardMetrics.map(({ cardHeight }) => cardHeight))).toBeLessThan(760);
});

test("preserves original photo proportions and ordered columns in the public library", async ({ page }, testInfo) => {
  await page.getByRole("tab", { name: "Public library" }).click();

  const expectedColumns = testInfo.project.name === "desktop" ? 4 : 2;
  const grid = page.getByRole("list");
  await expectWaterfall(page, ["Clay pot rice", "Crispy tofu", "Red-braised pork", "Scallion noodles"], expectedColumns);
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

  await expectNaturalPhotos(page);
  expect(metrics.every(({ bodyMinHeight }) => bodyMinHeight === "0px")).toBe(true);

  if (testInfo.project.name === "desktop") {
    await expect(page).toHaveScreenshot("public-library-waterfall.png", {
      animations: "disabled",
      fullPage: true,
    });
  }
});

test("keeps column order and prevents overlap when a portrait image finishes loading", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "One desktop run exercises delayed image sizing.");
  await page.setViewportSize({ width: 1100, height: 1000 });
  let releaseImage!: () => void;
  const imageReady = new Promise<void>((resolve) => { releaseImage = resolve; });
  await page.route("**/late-library-thumbnail.svg", async (route) => {
    await imageReady;
    await route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="1600"><rect width="640" height="1600" fill="#87564a"/></svg>',
    });
  });
  await page.route("**/recipes", (route) => fulfillJson(route, recipes.map((recipe, index) =>
    index === 5 ? { ...recipe, thumbnail_url: "/late-library-thumbnail.svg" } : recipe,
  )));
  await page.goto("/library", { waitUntil: "domcontentloaded" });
  const cards = page.getByRole("list").getByRole("listitem");
  await expect(cards).toHaveCount(7);
  await expect(page.getByRole("list")).toHaveAttribute("data-layout", "masonry");
  await page.evaluate(() => document.fonts.ready);
  try {
    const before = await cards.evaluateAll((items) => items.map((item) => {
      const box = item.getBoundingClientRect();
      return { x: box.x, y: box.y };
    }));
    releaseImage();
    await expectWaterfall(page, recipes.map(({ title }) => String(title)), 3);
    const after = await cards.evaluateAll((items) => items.map((item) => {
      const box = item.getBoundingClientRect();
      return { x: box.x, y: box.y };
    }));
    after.forEach((position, index) => {
      expect(Math.abs(position.x - before[index].x)).toBeLessThanOrEqual(1);
      // Vertical offsets may grow to show the full image; columns remain stable.
    });
  } finally {
    releaseImage();
  }
});

test("reflows between four, three and two columns without changing reading order", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "One page exercises each responsive breakpoint.");
  const titles = recipes.map(({ title }) => String(title));
  for (const [width, columns] of [[1440, 4], [1100, 3], [820, 2], [390, 2], [1440, 4]]) {
    await page.setViewportSize({ width, height: 1000 });
    await expectWaterfall(page, titles, columns);
    await expect(page.getByRole("list").getByRole("heading", { level: 2 })).toHaveText(titles);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
});

test("reflows matching recipes after search and tag filtering", async ({ page }, testInfo) => {
  const columns = testInfo.project.name === "desktop" ? 4 : 2;
  const search = page.getByRole("searchbox");
  await search.fill("braised");
  await expectWaterfall(page, ["Braised pork", "Five-spice soy-braised beef"], columns);
  await search.fill("nothing matches this recipe");
  await expect(page.getByRole("list")).toHaveCount(0);
  await search.fill("");
  await page.getByRole("button", { name: "Filter recipes" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Weeknight", exact: true }).click();
  await search.click();
  await expectWaterfall(page, ["Braised pork", "Dumplings", "Five-spice soy-braised beef"], columns);
});

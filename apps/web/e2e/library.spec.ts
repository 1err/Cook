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

function searchFixture(rows: typeof recipes, url: string, scope: string | null) {
  const result = recipePageFixture(rows, url);
  const include = new URL(url).searchParams.get("include_ingredients") === "true";
  return { ...result, total_count: result.items.length, items: result.items.map(row => ({ ...row,
    is_owned: scope === "mine", matched_ingredients: [], remaining_ingredients: include ? ["Garlic", "Ginger"] : null,
  })) };
}

async function installFixtures(page: Page) {
  await page.route("**/auth/me", route => fulfillJson(route, {
    id: "00000000-0000-0000-0000-000000000001", email: "library@example.com", is_library_public: false,
  }));
  // Fixture summaries exercise navigation/layout; real PostgreSQL tests cover ingredient matching.
  await page.route("**/recipes/search/page?*", route => {
    const url = route.request().url(); const scope = new URL(url).searchParams.get("scope");
    return fulfillJson(route, searchFixture(scope === "catalog" ? publicRecipes : recipes, url, scope));
  });
  await page.route("**/recipes/ingredient-options", route => fulfillJson(route, []));
}

async function expectWaterfall(page: Page, titles: string[], columnCount: number) {
  const cards = page.getByRole("list").getByRole("listitem");
  await expect(cards).toHaveCount(titles.length);
  await expect.poll(async () => cards.evaluateAll((items) => items.every((item) =>
    Array.from(item.querySelectorAll("img")).every((image) => image.complete),
  ))).toBe(true);

  const grid = page.getByRole("list");
  const rowGap = await grid.evaluate((element) => parseFloat(getComputedStyle(element).rowGap));
  await expect(async () => {
    const metrics = await cards.evaluateAll((items) => items.map((item) => {
      const box = item.getBoundingClientRect();
      return { title: item.querySelector("h2")?.textContent, x: box.x, y: box.y, bottom: box.bottom };
    }));
    const columns = [...new Set(metrics.map(({ x }) => Math.round(x)))].sort((a, b) => a - b);
    expect(columns).toHaveLength(Math.min(columnCount, titles.length));
    const top = Math.min(...metrics.map(({ y }) => y));
    const nextTop = columns.map(() => top);
    for (const title of titles) {
      const card = metrics.find((item) => item.title === title)!;
      const column = nextTop.reduce((shortest, bottom, index) =>
        bottom < nextTop[shortest] ? index : shortest, 0);
      expect(Math.abs(card.x - columns[column]), `${title} should use the left-most shortest column`).toBeLessThan(1);
      expect(Math.abs(card.y - nextTop[column]), `${title} should sit directly below that column`).toBeLessThan(1);
      nextTop[column] = card.bottom + rowGap;
    }
    const gridHeight = await grid.evaluate((element) => element.getBoundingClientRect().height);
    expect(Math.abs(gridHeight - (Math.max(...nextTop) - rowGap - top))).toBeLessThan(1);
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

test("uses four compact desktop columns and places the fifth recipe in the shortest column", async ({ page }, testInfo) => {
  const expectedColumns = testInfo.project.name === "desktop" ? 4 : 2;
  const grid = page.getByRole("list");
  await expectWaterfall(page, recipes.map(({ title }) => String(title)), expectedColumns);

  if (testInfo.project.name === "desktop") {
    const positions = await grid.getByRole("listitem").evaluateAll((cards) => cards.map((card) => {
      const box = card.getBoundingClientRect();
      return { title: card.querySelector("h2")?.textContent, x: box.x, y: box.y };
    }));
    const eggplant = positions.find(({ title }) => title === "Eggplant tofu")!;
    const beef = positions.find(({ title }) => title === "Five-spice soy-braised beef")!;
    expect(beef.x).toBeCloseTo(eggplant.x, 0);
    expect(beef.y).toBeGreaterThan(eggplant.y);
  }


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

  await expect(page.getByRole("tab", { name: "My library", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("tab", { name: "Friends", exact: true })).toHaveAttribute("href", "/library/friends");
  await expect(page.getByRole("tab", { name: "All recipes", exact: true })).toHaveCount(0);
  await expect(grid.locator("[data-testid='recipe-ingredients']")).toHaveCount(0);
  await expect(grid.getByText("First ingredient")).toHaveCount(0);
  await expectNaturalPhotos(page);
  expect(cardMetrics.every(({ mediaHeight }) => mediaHeight > 30)).toBe(true);
  expect(Math.max(...cardMetrics.map(({ titleHeight }) => titleHeight))).toBeLessThan(64);
  expect(Math.max(...cardMetrics.map(({ cardHeight }) => cardHeight))).toBeLessThan(760);
});

test("preserves natural photos and shortest-column placement in the public library", async ({ page }, testInfo) => {
  await page.goto("/library?view=public");
  await expect(page.getByRole("tab", { name: "Public library" })).toHaveAttribute("aria-selected", "true");

  const expectedColumns = testInfo.project.name === "desktop" ? 4 : 2;
  const grid = page.getByRole("list");
  await expectWaterfall(page, ["Clay pot rice", "Crispy tofu", "Red-braised pork", "Scallion noodles", "Tea-smoked tofu"], expectedColumns);
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


});

test("recomputes shortest columns without overlap when a portrait image finishes loading", async ({ page }, testInfo) => {
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
  await page.route("**/recipes/search/page?*", route => fulfillJson(route, searchFixture(recipes.map((recipe, index) =>
    index === 4 ? { ...recipe, thumbnail_url: "/late-library-thumbnail.svg" } : recipe,
  ), route.request().url(), "mine")));
  await page.goto("/library", { waitUntil: "domcontentloaded" });
  const cards = page.getByRole("list").getByRole("listitem");
  await expect(cards).toHaveCount(7);
  await expect(page.getByRole("list")).toHaveAttribute("data-layout", "masonry");
  await page.evaluate(() => document.fonts.ready);
  try {
    releaseImage();
    await expectWaterfall(page, recipes.map(({ title }) => String(title)), 3);
    const after = await cards.evaluateAll((items) => items.map((item) => {
      const box = item.getBoundingClientRect();
      return { bottom: box.bottom, right: box.right, title: item.querySelector("h2")?.textContent, x: box.x, y: box.y };
    }));
    for (const [index, card] of after.entries()) {
      for (const other of after.slice(index + 1)) {
        const separated = card.right <= other.x || other.right <= card.x || card.bottom <= other.y || other.bottom <= card.y;
        expect(separated, `${card.title} should not overlap ${other.title}`).toBe(true);
      }
    }
  } finally {
    releaseImage();
  }
});

test("recomputes shortest columns at four, three and two-column breakpoints", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "One page exercises each responsive breakpoint.");
  const titles = recipes.map(({ title }) => String(title));
  for (const [width, columns] of [[1440, 4], [1100, 3], [820, 2], [390, 2], [320, 2], [1440, 4]]) {
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
  await page.getByRole("button", { name: "Filter recipes by tag", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Weeknight", exact: true }).click();
  await search.click();
  await expectWaterfall(page, ["Braised pork", "Eggplant tofu", "Mapo tofu"], columns);
});


test("preserves ingredient controls and compact details within the waterfall", async ({ page }, testInfo) => {
  const mode = page.getByRole("combobox", { name: "Search by", exact: true });
  await page.getByRole("searchbox").fill("braised");
  await expect(page.getByRole("listitem")).toHaveCount(2);
  await mode.selectOption("ingredients");
  const input = page.getByRole("combobox", { name: "Search ingredients", exact: true });
  await input.fill("chicken"); await input.press("Enter");
  const request = page.waitForRequest(r => new URL(r.url()).pathname === "/recipes/search/page" && new URL(r.url()).searchParams.get("match") === "any");
  await page.getByRole("button", { name: "Match any", exact: true }).click();
  expect(new URL((await request).url()).searchParams.getAll("ingredients")).toEqual(["chicken"]);
  await expectWaterfall(page, recipes.map(x=>String(x.title)), testInfo.project.name === "desktop" ? 4 : 2);
  const more = page.getByRole("listitem").filter({ hasText: "Aubergine clay pot" }).getByRole("button", { name: "2 more ingredients", exact: true });
  expect(await more.evaluate(button => button.closest("a"))).toBeNull();
  if (testInfo.project.name === "phone") await more.tap(); else await more.hover();
  const popup = page.getByRole("tooltip"); await expect(popup.getByRole("listitem")).toHaveText(["Garlic", "Ginger"]);
  if (testInfo.project.name !== "phone") { await popup.hover(); await expect(popup).toBeVisible(); }
  await page.keyboard.press("Escape"); await expect(popup).toHaveCount(0);
  await page.getByRole("tab", { name: "Public library", exact: true }).click();
  await expect(page.getByRole("listitem")).toHaveCount(publicRecipes.length);
  await expect(page.getByRole("button", { name: "Remove chicken", exact: true })).toBeVisible();
  await mode.selectOption("name"); await expect(page.getByRole("searchbox")).toHaveValue("braised");
  await expect(page.getByRole("listitem")).toHaveCount(1);
  await mode.selectOption("ingredients"); await expect(page.getByRole("button", { name: "Match any", exact: true })).toHaveAttribute("aria-pressed", "true");
});

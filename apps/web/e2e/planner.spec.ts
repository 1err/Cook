import { expect, test, type Page, type Route } from "@playwright/test";

const appOrigin = `http://127.0.0.1:${process.env.PORT ?? "3000"}`;
const weekDates = [
  "2026-08-10",
  "2026-08-11",
  "2026-08-12",
  "2026-08-13",
  "2026-08-14",
  "2026-08-15",
  "2026-08-16",
];

const inlineRecipeThumbnail =
  "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxNjAgOTAiPjxyZWN0IHdpZHRoPSIxNjAiIGhlaWdodD0iOTAiIHJ4PSIxMiIgZmlsbD0iI2I5NWYzZCIvPjxjaXJjbGUgY3g9IjgwIiBjeT0iNDUiIHI9IjI4IiBmaWxsPSIjZjdkYmM5Ii8+PHBhdGggZD0iTTU2IDQ1aDQ4IiBzdHJva2U9IiM2ZDM1MjQiIHN0cm9rZS13aWR0aD0iOCIgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIi8+PC9zdmc+";

const recipes = Array.from({ length: 24 }, (_, index) => {
  const number = String(index + 1).padStart(2, "0");
  return {
    id: `recipe-${number}`,
    title: `Recipe ${number} with a descriptive two-line title`,
    source_url: null,
    thumbnail_url: index === 0 ? inlineRecipeThumbnail : null,
    ingredients: [{ name: `Ingredient ${number}`, quantity: "1 cup" }],
    raw_extraction_text: null,
    library_tags: index % 2 === 0 ? ["weeknight"] : ["main_dish"],
    library_category: index % 2 === 0 ? "weeknight" : "main_dish",
    is_public_catalog: false,
    catalog_source_recipe_id: null,
    description: null,
    total_time_minutes: 30,
    steps: [{ text: `Cook recipe ${number}.` }],
    tips: [],
    equipment: [],
  };
});

type MealPlanDay = {
  date: string;
  breakfast: string[];
  lunch: string[];
  dinner: string[];
};

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": appOrigin,
    "Access-Control-Allow-Credentials": "true",
  };
}

async function fulfillJson(route: Route, body: unknown) {
  await route.fulfill({
    status: 200,
    contentType: "application/json",
    headers: corsHeaders(),
    body: JSON.stringify(body),
  });
}

async function installPlannerFixtures(page: Page) {
  const plans = new Map<string, MealPlanDay>([
    [
      weekDates[0],
      {
        date: weekDates[0],
        breakfast: ["recipe-01"],
        lunch: ["recipe-02", "recipe-03"],
        dinner: ["recipe-04", "recipe-05", "recipe-06"],
      },
    ],
    [
      weekDates[1],
      {
        date: weekDates[1],
        breakfast: ["recipe-07", "recipe-08", "recipe-09", "recipe-10"],
        lunch: [],
        dinner: [],
      },
    ],
  ]);

  await page.route("**/auth/me", (route) =>
    fulfillJson(route, {
      id: "00000000-0000-0000-0000-000000000001",
      email: "planner@example.com",
      is_library_public: false,
    }),
  );
  await page.route("**/recipes", (route) => fulfillJson(route, recipes));
  await page.route("**/meal-plan?*", (route) => fulfillJson(route, [...plans.values()]));
  await page.route("**/meal-plan/*", async (route) => {
    if (route.request().method() !== "PUT") {
      await route.fallback();
      return;
    }
    const date = route.request().url().split("/").at(-1) ?? "";
    const slots = route.request().postDataJSON() as Omit<MealPlanDay, "date">;
    const saved = { date, ...slots };
    plans.set(date, saved);
    await fulfillJson(route, saved);
  });
}

test.beforeEach(async ({ page }) => {
  await installPlannerFixtures(page);
  await page.goto("/planner?week=2026-08-10");
});

test("renders a day-by-meal matrix with compact multi-recipe states", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Desktop matrix geometry is verified once.");

  await expect(page.getByRole("table", { name: "Weekly meal plan" })).toBeVisible();
  await expect(page.getByTestId("planner-day-row")).toHaveCount(7);
  await expect(page.getByTestId("planner-meal-slot")).toHaveCount(21);
  await expect(page.getByRole("columnheader", { name: "Breakfast" })).toBeVisible();

  for (const [slotIndex, layout] of [
    ["0", "one"],
    ["1", "two"],
    ["2", "three"],
  ] as const) {
    await expect(
      page
        .locator(`[data-date="2026-08-10"][data-slot-index="${slotIndex}"]`)
        .getByRole("region"),
    ).toHaveAttribute("data-recipe-layout", layout);
  }

  const overflowSlot = page.locator('[data-date="2026-08-11"][data-slot-index="0"]');
  await expect(overflowSlot.getByRole("region")).toHaveAttribute("data-recipe-layout", "overflow");
  await expect(
    overflowSlot.getByRole("button", { name: "2 more: Breakfast 2026-08-11" }),
  ).toBeVisible();
  await expect(overflowSlot.getByRole("button", { name: /Open Recipe 07/ })).toBeVisible();
  await expect(overflowSlot.getByRole("button", { name: /Open Recipe 08/ })).toBeVisible();
  await expect(overflowSlot.getByRole("button", { name: /Open Recipe 09/ })).toHaveCount(0);

  const workspaceMetrics = await page.locator("main").evaluate((main) => {
    const rail = main.querySelector<HTMLElement>(".planner-editorial__sidebar")!;
    const matrix = main.querySelector<HTMLElement>(".planner-matrix")!;
    const board = matrix.parentElement!;
    const mainRect = main.getBoundingClientRect();
    return {
      documentWidth: document.documentElement.scrollWidth,
      leftGutter: mainRect.left,
      matrixBottom: matrix.getBoundingClientRect().bottom,
      railBottom: rail.getBoundingClientRect().bottom,
      rightGutter: window.innerWidth - mainRect.right,
      viewportWidth: window.innerWidth,
      boardBottom: board.getBoundingClientRect().bottom,
    };
  });
  expect(workspaceMetrics.documentWidth).toBeLessThanOrEqual(workspaceMetrics.viewportWidth);
  expect(Math.abs(workspaceMetrics.leftGutter - workspaceMetrics.rightGutter)).toBeLessThanOrEqual(1);
  expect(
    Math.max(
      Math.abs(workspaceMetrics.matrixBottom - workspaceMetrics.railBottom),
      Math.abs(workspaceMetrics.boardBottom - workspaceMetrics.railBottom),
    ),
    JSON.stringify(workspaceMetrics),
  ).toBeLessThanOrEqual(1);

  const mealCardMetrics = await page
    .getByRole("button", { name: /Open Recipe 01/ })
    .evaluate((card) => {
      const body = card.querySelector<HTMLElement>(".planner-meal-card__body")!;
      const image = card.querySelector<HTMLElement>(".planner-meal-card__img")!;
      const title = card.querySelector<HTMLElement>(".planner-meal-card__title")!;
      return {
        bodyWidth: body.getBoundingClientRect().width,
        cardWidth: card.getBoundingClientRect().width,
        columns: getComputedStyle(card).gridTemplateColumns,
        imageDisplay: getComputedStyle(image).display,
        titleWidth: title.getBoundingClientRect().width,
      };
    });
  expect(mealCardMetrics.titleWidth, JSON.stringify(mealCardMetrics)).toBeGreaterThan(80);

  await expect(page).toHaveScreenshot("planner-matrix.png", {
    animations: "disabled",
    fullPage: true,
  });
});

test("preserves picker, remove, drag, and open interactions", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Planner interactions are verified once.");

  const removeRequest = page.waitForRequest(
    (request) => request.method() === "PUT" && request.url().endsWith("/meal-plan/2026-08-11"),
  );
  await page.getByRole("button", { name: /Remove Recipe 07.*breakfast.*2026-08-11/ }).click();
  expect((await removeRequest).postDataJSON().breakfast).toEqual(["recipe-08", "recipe-09", "recipe-10"]);
  await expect(page.getByRole("button", { name: /Remove Recipe 08.*breakfast.*2026-08-11/ })).toBeFocused();

  const emptyBreakfast = page.getByRole("button", {
    name: "Choose a recipe for breakfast on 2026-08-12",
  });
  await emptyBreakfast.click();
  const picker = page.getByRole("dialog", { name: "Choose recipe for meal slot" });
  await expect(picker).toBeVisible();
  await expect(picker.locator(".planner-mobile-picker__close")).toBeFocused();
  const addRequest = page.waitForRequest(
    (request) => request.method() === "PUT" && request.url().endsWith("/meal-plan/2026-08-12"),
  );
  await picker.getByRole("button", { name: /Add Recipe 01/ }).click();
  expect((await addRequest).postDataJSON().breakfast).toEqual(["recipe-01"]);
  await expect(page.locator('[data-date="2026-08-12"][data-slot-index="0"]')).toBeFocused();

  const dragSource = page.locator(".planner-source-card--rail").filter({ hasText: "Recipe 07" });
  const dropTarget = page.locator('[data-date="2026-08-13"][data-slot-index="1"]');
  const dragRequest = page.waitForRequest(
    (request) => request.method() === "PUT" && request.url().endsWith("/meal-plan/2026-08-13"),
  );
  const dataTransfer = await page.evaluateHandle(() => new DataTransfer());
  await dragSource.locator(".planner-drag-card").dispatchEvent("dragstart", { dataTransfer });
  await dropTarget.dispatchEvent("dragover", { dataTransfer });
  await dropTarget.dispatchEvent("drop", { dataTransfer });
  expect((await dragRequest).postDataJSON().lunch).toEqual(["recipe-07"]);

  await page
    .locator('[data-date="2026-08-10"][data-slot-index="1"]')
    .getByRole("button", { name: /Open Recipe 02/ })
    .click();
  await expect(page).toHaveURL(/\/recipe\/recipe-02$/);
});

test("stacks the matrix and keeps the picker usable on phone and tablet", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "desktop", "Responsive stacking runs in phone and tablet projects.");

  await expect(page.getByTestId("planner-day-row")).toHaveCount(7);
  await expect(page.getByTestId("planner-meal-slot")).toHaveCount(21);
  await expect(page.locator(".planner-editorial__sidebar")).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  const firstRow = page.getByTestId("planner-day-row").first();
  expect(
    await firstRow.evaluate((row) => getComputedStyle(row).gridTemplateColumns.split(" ").length),
  ).toBe(1);

  await page.getByRole("button", { name: "Choose a recipe for breakfast on 2026-08-12" }).click();
  const picker = page.getByRole("dialog", { name: "Choose recipe for meal slot" });
  await expect(picker).toBeVisible();
  const pickerLayout = await picker.locator(".planner-mobile-picker__list").evaluate((list) => ({
    display: getComputedStyle(list).display,
    flexDirection: getComputedStyle(list).flexDirection,
  }));
  expect(pickerLayout).toEqual({ display: "flex", flexDirection: "column" });
});

test("switches from stacked rows to the full matrix at the actual breakpoint", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "The exact breakpoint is verified once.");

  await page.setViewportSize({ width: 900, height: 800 });
  await expect(page.locator(".planner-editorial__sidebar")).toBeHidden();
  expect(
    await page.getByTestId("planner-day-row").first().evaluate((row) =>
      getComputedStyle(row).gridTemplateColumns.split(" ").length,
    ),
  ).toBe(1);

  await page.setViewportSize({ width: 901, height: 800 });
  await expect(page.locator(".planner-editorial__sidebar")).toBeVisible();
  expect(
    await page.getByTestId("planner-day-row").first().evaluate((row) =>
      getComputedStyle(row).gridTemplateColumns.split(" ").length,
    ),
  ).toBe(4);
});

test("keeps the Chinese overflow action inside its meal cell", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Narrow translated cell geometry is verified once.");
  await page.getByRole("button", { name: "Account for planner@example.com" }).click();
  await page.getByRole("button", { name: "中文" }).click();

  const slot = page.locator('[data-date="2026-08-11"][data-slot-index="0"]');
  const cue = slot.locator(".planner-slot-overflow-cue");
  await expect(cue).toContainText("另 2 道");
  const metrics = await cue.evaluate((element) => {
    const cueRect = element.getBoundingClientRect();
    const slotRect = element.closest<HTMLElement>("[data-testid='planner-meal-slot']")!.getBoundingClientRect();
    return {
      cueLeft: cueRect.left,
      cueRight: cueRect.right,
      contentFits: element.scrollWidth <= element.clientWidth,
      hasPageOverflow: document.documentElement.scrollWidth > window.innerWidth,
      slotLeft: slotRect.left,
      slotRight: slotRect.right,
    };
  });
  expect(metrics.cueLeft).toBeGreaterThanOrEqual(metrics.slotLeft - 0.5);
  expect(metrics.cueRight).toBeLessThanOrEqual(metrics.slotRight + 0.5);
  expect(metrics.contentFits).toBe(true);
  expect(metrics.hasPageOverflow).toBe(false);
});

import { recipePageFixture } from "./recipePageFixture";
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
  revision: number;
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
        revision: 1,
        breakfast: ["recipe-01"],
        lunch: ["recipe-02", "recipe-03"],
        dinner: ["recipe-04", "recipe-05", "recipe-06"],
      },
    ],
    [
      weekDates[1],
      {
        date: weekDates[1],
        revision: 1,
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
  await page.route("**/recipes/*", (route) => {
    const recipeId = route.request().url().split("/").at(-1);
    return fulfillJson(route, recipes.find((recipe) => recipe.id === recipeId) ?? null);
  });
  await page.route("**/recipes/page?*", (route) => fulfillJson(route, recipePageFixture(recipes, route.request().url())));
  await page.route("**/meal-plan?*", (route) => fulfillJson(route, [...plans.values()]));
  await page.route("**/meal-plan/*", async (route) => {
    if (route.request().method() !== "PUT") {
      await route.fallback();
      return;
    }
    const date = route.request().url().split("/").at(-1) ?? "";
    const { expected_revision, ...slots } = route.request().postDataJSON() as Omit<MealPlanDay, "date" | "revision"> & { expected_revision: number };
    const revision = plans.get(date)?.revision ?? 0;
    if (expected_revision !== revision) {
      await route.fulfill({ status: 409, contentType: "application/json", headers: corsHeaders(), body: JSON.stringify({ detail: { code: "meal_plan_conflict", message: "Plan changed" } }) });
      return;
    }
    const saved = { date, ...slots, revision: revision + 1 };
    plans.set(date, saved);
    await fulfillJson(route, saved);
  });
}

test.beforeEach(async ({ page }) => {
  await installPlannerFixtures(page);
  await page.goto("/planner?week=2026-08-10");
});

test("renders a readable day-card week beside a compact recipe rail", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Desktop day-card geometry is verified once.");

  await expect(page.getByRole("heading", { name: "Recipe Library" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Meal planner" })).toBeVisible();
  await expect(page.getByTestId("planner-day-card")).toHaveCount(7);
  await expect(page.getByTestId("planner-meal-slot")).toHaveCount(21);
  await expect(page.getByRole("heading", { name: "Mon 10" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Sun 16" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Breakfast" })).toHaveCount(7);
  await expect(page.getByRole("heading", { name: "Lunch" })).toHaveCount(7);
  await expect(page.getByRole("heading", { name: "Dinner" })).toHaveCount(7);

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
    overflowSlot.getByRole("button", {
      name: "View all 4 planned recipes for breakfast on 2026-08-11",
    }),
  ).toBeVisible();
  await expect(overflowSlot.getByRole("button", { name: /Open Recipe 07/ })).toBeVisible();
  await expect(overflowSlot.getByRole("button", { name: /Open Recipe 08/ })).toBeVisible();
  await expect(overflowSlot.getByRole("button", { name: /Open Recipe 09/ })).toBeVisible();
  await expect(overflowSlot.getByRole("button", { name: /Open Recipe 10/ })).toHaveCount(0);

  const workspaceMetrics = await page.locator("main").evaluate((main) => {
    const rail = main.querySelector<HTMLElement>(".planner-editorial__sidebar")!;
    const week = main.querySelector<HTMLElement>(".planner-week-grid")!;
    const dayCards = Array.from(week.querySelectorAll<HTMLElement>(".planner-day-card"));
    const railThumbnail = rail.querySelector<HTMLElement>(".planner-drag-card__thumb")!;
    const mainRect = main.getBoundingClientRect();
    return {
      cardColumns: getComputedStyle(week).gridTemplateColumns.split(" ").length,
      clippedDayCards: dayCards.filter((card) => card.scrollHeight > card.clientHeight).length,
      documentWidth: document.documentElement.scrollWidth,
      leftGutter: mainRect.left,
      railWidth: rail.getBoundingClientRect().width,
      railDisplay: getComputedStyle(rail.querySelector<HTMLElement>(".planner-editorial__sidebar-scroll")!).display,
      railThumbnailHeight: railThumbnail.getBoundingClientRect().height,
      railThumbnailWidth: railThumbnail.getBoundingClientRect().width,
      rightGutter: window.innerWidth - mainRect.right,
      viewportWidth: window.innerWidth,
    };
  });
  expect(workspaceMetrics.documentWidth).toBeLessThanOrEqual(workspaceMetrics.viewportWidth);
  expect(workspaceMetrics.railWidth, JSON.stringify(workspaceMetrics)).toBeGreaterThanOrEqual(220);
  expect(workspaceMetrics.railWidth, JSON.stringify(workspaceMetrics)).toBeLessThanOrEqual(270);
  expect(workspaceMetrics.railDisplay).toBe("flex");
  expect(workspaceMetrics.railThumbnailWidth).toBeCloseTo(64, 0);
  expect(workspaceMetrics.railThumbnailHeight).toBeCloseTo(52, 0);
  expect(workspaceMetrics.cardColumns).toBe(3);
  expect(workspaceMetrics.clippedDayCards).toBe(0);
  expect(Math.abs(workspaceMetrics.leftGutter - workspaceMetrics.rightGutter)).toBeLessThanOrEqual(1);
  const mealCardMetrics = await page
    .getByRole("button", { name: /Open Recipe 01/ })
    .evaluate((card) => {
      const body = card.querySelector<HTMLElement>(".planner-meal-card__body")!;
      const image = card.querySelector<HTMLElement>(".planner-meal-card__img")!;
      const title = card.querySelector<HTMLElement>(".planner-meal-card__title")!;
      return {
        bodyWidth: body.getBoundingClientRect().width,
        cardHeight: card.getBoundingClientRect().height,
        columns: getComputedStyle(card).gridTemplateColumns,
        imageDisplay: getComputedStyle(image).display,
        imageHeight: image.getBoundingClientRect().height,
        imageWidth: image.getBoundingClientRect().width,
        titleVisibleRatio: title.clientWidth / title.scrollWidth,
        titleWidth: title.getBoundingClientRect().width,
        titleWhiteSpace: getComputedStyle(title).whiteSpace,
        titleFontSize: parseFloat(getComputedStyle(title).fontSize),
      };
    });
  expect(mealCardMetrics.imageDisplay).toBe("block");
  expect(mealCardMetrics.imageWidth).toBeCloseTo(64, 0);
  expect(mealCardMetrics.imageHeight).toBeCloseTo(52, 0);
  expect(mealCardMetrics.cardHeight).toBeGreaterThanOrEqual(52);
  expect(mealCardMetrics.bodyWidth, JSON.stringify(mealCardMetrics)).toBeGreaterThanOrEqual(100);
  expect(mealCardMetrics.titleVisibleRatio, JSON.stringify(mealCardMetrics)).toBeGreaterThan(0.9);
  expect(mealCardMetrics.titleFontSize).toBeGreaterThanOrEqual(14);
  expect(mealCardMetrics.titleWhiteSpace).toBe("normal");

  await expect(page).toHaveScreenshot("planner-matrix.png", {
    animations: "disabled",
    fullPage: true,
  });
});

test("keeps every planner tag fully inside the recipe rail", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Desktop tag geometry is verified once.");

  await page.getByRole("button", { name: "Filter planner recipes by tag" }).click();
  const panel = page.getByRole("dialog", { name: "Filter planner recipes by tag" });
  await expect(panel).toBeVisible();

  const tagMetrics = await panel.evaluate((element) => {
    const panelRect = element.getBoundingClientRect();
    const railRect = element.closest<HTMLElement>(".planner-editorial__sidebar")!.getBoundingClientRect();
    const options = Array.from(element.querySelectorAll<HTMLElement>(".tag-filter-popover__option"));
    return {
      panelRight: panelRect.right,
      railRight: railRect.right,
      panelScrollWidth: element.scrollWidth,
      panelClientWidth: element.clientWidth,
      clippedLabels: options
        .filter((option) => {
          const optionRect = option.getBoundingClientRect();
          return optionRect.left < panelRect.left || optionRect.right > railRect.right || option.scrollWidth > option.clientWidth;
        })
        .map((option) => option.textContent?.trim()),
    };
  });

  expect(tagMetrics.panelRight, JSON.stringify(tagMetrics)).toBeLessThanOrEqual(tagMetrics.railRight);
  expect(tagMetrics.panelScrollWidth, JSON.stringify(tagMetrics)).toBeLessThanOrEqual(tagMetrics.panelClientWidth);
  expect(tagMetrics.clippedLabels).toEqual([]);
});

test("uses the picker width for its tag menu and separates the first tag group", async (
  { page },
  testInfo,
) => {
  test.skip(
    testInfo.project.name !== "desktop",
    "Desktop picker geometry is verified once.",
  );

  await page.getByRole("button", { name: "Choose a recipe for breakfast on 2026-08-12" }).click();
  const picker = page.getByRole("dialog", { name: "Choose recipe for meal slot" });
  await picker.getByRole("button", { name: "Filter planner recipes by tag" }).click();
  const panel = picker.getByRole("dialog", { name: "Filter planner recipes by tag" });
  await expect(panel).toBeVisible();

  const tagMetrics = await panel.evaluate((element) => {
    const panelRect = element.getBoundingClientRect();
    const sheetRect = element
      .closest<HTMLElement>(".planner-mobile-picker__sheet")!
      .getBoundingClientRect();
    const allOptionRect = element
      .querySelector<HTMLElement>(":scope > .tag-filter-popover__option")!
      .getBoundingClientRect();
    const firstGroupTitleRect = element
      .querySelector<HTMLElement>(".tag-filter-popover__group-title")!
      .getBoundingClientRect();
    const options = Array.from(element.querySelectorAll<HTMLElement>(".tag-filter-popover__option"));
    return {
      clippedLabels: options
        .filter((option) => option.scrollWidth > option.clientWidth)
        .map((option) => option.textContent?.trim()),
      firstGroupGap: firstGroupTitleRect.top - allOptionRect.bottom,
      panelLeft: panelRect.left,
      panelRight: panelRect.right,
      panelWidth: panelRect.width,
      sheetLeft: sheetRect.left,
      sheetRight: sheetRect.right,
    };
  });

  expect(tagMetrics.panelWidth, JSON.stringify(tagMetrics)).toBeGreaterThanOrEqual(600);
  expect(tagMetrics.panelLeft, JSON.stringify(tagMetrics)).toBeGreaterThanOrEqual(tagMetrics.sheetLeft);
  expect(tagMetrics.panelRight, JSON.stringify(tagMetrics)).toBeLessThanOrEqual(tagMetrics.sheetRight);
  expect(tagMetrics.firstGroupGap, JSON.stringify(tagMetrics)).toBeGreaterThanOrEqual(18);
  expect(tagMetrics.firstGroupGap, JSON.stringify(tagMetrics)).toBeLessThanOrEqual(32);
  expect(tagMetrics.clippedLabels).toEqual([]);
});

test("preserves picker, remove, drag, and open interactions", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Planner interactions are verified once.");

  await page.getByRole("button", {
    name: "View all 4 planned recipes for breakfast on 2026-08-11",
  }).click();
  const manager = page.getByRole("dialog", { name: "Manage recipes for meal slot" });
  await expect(manager).toBeVisible();
  for (const number of ["07", "08", "09", "10"]) {
    await expect(manager.getByText(`Recipe ${number} with a descriptive two-line title`)).toBeVisible();
  }
  const removeRequest = page.waitForRequest(
    (request) => request.method() === "PUT" && request.url().endsWith("/meal-plan/2026-08-11"),
  );
  await manager.getByRole("button", { name: /Remove Recipe 09.*breakfast.*2026-08-11/ }).click();
  expect((await removeRequest).postDataJSON().breakfast).toEqual(["recipe-07", "recipe-08", "recipe-10"]);
  await expect(manager.getByText(/Recipe 09 with/)).toHaveCount(0);
  await manager.getByRole("button", { name: "Add recipe" }).click();
  const managedPicker = page.getByRole("dialog", { name: "Choose recipe for meal slot" });
  await expect(managedPicker.getByRole("button", { name: /Added Recipe 07/ })).toBeDisabled();
  await managedPicker.getByRole("button", { name: "Close recipe picker" }).last().click();

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

test("uses responsive day cards and keeps the picker usable on phone and tablet", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "desktop", "Responsive day cards run in phone and tablet projects.");

  await expect(page.getByTestId("planner-day-card")).toHaveCount(7);
  await expect(page.getByTestId("planner-meal-slot")).toHaveCount(21);
  await expect(page.locator(".planner-editorial__sidebar")).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  const cardColumns = await page.locator(".planner-week-grid").evaluate((week) =>
    getComputedStyle(week).gridTemplateColumns.split(" ").length,
  );
  expect(cardColumns).toBe(testInfo.project.name === "phone" ? 1 : 2);
  await expect(page.getByRole("heading", { name: "Mon 10" })).toBeVisible();

  await page.getByRole("button", { name: "Choose a recipe for breakfast on 2026-08-12" }).click();
  const picker = page.getByRole("dialog", { name: "Choose recipe for meal slot" });
  await expect(picker).toBeVisible();
  const pickerLayout = await picker.locator(".planner-mobile-picker__list").evaluate((list) => ({
    display: getComputedStyle(list).display,
    flexDirection: getComputedStyle(list).flexDirection,
  }));
  expect(pickerLayout).toEqual({ display: "flex", flexDirection: "column" });
});

test("switches day-card columns at the responsive breakpoints", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "The card breakpoints are verified once.");

  await page.setViewportSize({ width: 700, height: 800 });
  await expect(page.locator(".planner-editorial__sidebar")).toBeHidden();
  expect(
    await page.locator(".planner-week-grid").evaluate((week) =>
      getComputedStyle(week).gridTemplateColumns.split(" ").length,
    ),
  ).toBe(1);

  await page.setViewportSize({ width: 901, height: 800 });
  await expect(page.locator(".planner-editorial__sidebar")).toBeVisible();
  expect(
    await page.locator(".planner-week-grid").evaluate((week) =>
      getComputedStyle(week).gridTemplateColumns.split(" ").length,
    ),
  ).toBe(2);
  const layout = await page.locator(".planner-editorial__sidebar").evaluate((rail) => {
    const board = rail.parentElement!.querySelector<HTMLElement>(".planner-week-grid")!;
    return {
      railRight: rail.getBoundingClientRect().right,
      boardLeft: board.getBoundingClientRect().left,
      railDisplay: getComputedStyle(rail.querySelector<HTMLElement>(".planner-editorial__sidebar-scroll")!).display,
      pageOverflows: document.documentElement.scrollWidth > window.innerWidth,
    };
  });
  expect(layout.railRight).toBeLessThan(layout.boardLeft);
  expect(layout.railDisplay).toBe("flex");
  expect(layout.pageOverflows).toBe(false);

  await page.setViewportSize({ width: 1181, height: 800 });
  expect(
    await page.locator(".planner-week-grid").evaluate((week) =>
      getComputedStyle(week).gridTemplateColumns.split(" ").length,
    ),
  ).toBe(3);
});

test("keeps the Chinese overflow action inside its meal cell", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Narrow translated cell geometry is verified once.");
  await page.getByRole("button", { name: "Account for planner@example.com" }).click();
  await page.getByRole("button", { name: "中文" }).click();

  const slot = page.locator('[data-date="2026-08-11"][data-slot-index="0"]');
  const cue = slot.locator(".planner-slot-overflow-cue");
  await expect(cue).toContainText("查看全部 4 道");
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

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
  await page.route("**/cooking-session/active", (route) => fulfillJson(route, null));
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
  await page.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, (route) => route.abort());
  await installPlannerFixtures(page);
  await page.goto("/planner?week=2026-08-10");
});

test("keeps Planner pictograms and picker controls usable without external icon fonts", async ({ page }) => {
  await expect(page.getByRole("heading", { name: "Weekly planner" })).toBeVisible();
  await expect(page.getByText(/^(search|filter_alt|expand_more|close|add)$/)).toHaveCount(0);
  const emptySlot = page.getByRole("button", { name: "Choose a recipe for dinner on 2026-08-11" });
  await expect(emptySlot.locator("svg")).toBeVisible();
  await emptySlot.click();

  const picker = page.getByRole("dialog", { name: "Choose recipe for meal slot" });
  await expect(picker).toBeVisible();
  await expect(picker.getByText(/^(search|filter_alt|expand_more|close|add)$/)).toHaveCount(0);
  await picker.getByRole("button", { name: "Filter planner recipes by tag" }).click();
  await expect(picker.getByRole("dialog", { name: "Filter planner recipes by tag" })).toBeVisible();
  await picker.getByRole("button", { name: "Weeknight", exact: true }).click();
  await expect(picker.getByRole("button", { name: "Clear filter" })).toBeVisible();
  await picker.getByRole("button", { name: "Close recipe picker" }).last().click();
  await expect(picker).toBeHidden();
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
    const dayRows = dayCards.map((card) => {
      const cardRect = card.getBoundingClientRect();
      const headerRect = card.querySelector<HTMLElement>(".planner-day-card__header")!.getBoundingClientRect();
      const meals = card.querySelector<HTMLElement>(".planner-day-card__meals")!;
      const mealsRect = meals.getBoundingClientRect();
      const mealRects = Array.from(
        meals.querySelectorAll<HTMLElement>(":scope > .planner-day-card__meal"),
        (meal) => meal.getBoundingClientRect(),
      );
      return {
        bottom: cardRect.bottom,
        headerLeftOfMeals: headerRect.right <= mealsRect.left + 1,
        headerWidth: headerRect.width,
        mealColumns: getComputedStyle(meals).gridTemplateColumns.split(" ").length,
        mealLefts: mealRects.map((rect) => rect.left),
        mealTopSpread: Math.max(...mealRects.map((rect) => rect.top)) - Math.min(...mealRects.map((rect) => rect.top)),
        overflows: card.scrollWidth > card.clientWidth,
        top: cardRect.top,
      };
    });
    return {
      boardAreaWidth: week.parentElement!.parentElement!.getBoundingClientRect().width,
      cardColumns: getComputedStyle(week).gridTemplateColumns.split(" ").length,
      clippedDayCards: dayCards.filter((card) => card.scrollHeight > card.clientHeight).length,
      dayRows,
      documentWidth: document.documentElement.scrollWidth,
      leftGutter: mainRect.left,
      railWidth: rail.getBoundingClientRect().width,
      railDisplay: getComputedStyle(rail.querySelector<HTMLElement>(".planner-editorial__sidebar-scroll")!).display,
      railThumbnailHeight: railThumbnail.getBoundingClientRect().height,
      railThumbnailWidth: railThumbnail.getBoundingClientRect().width,
      rightGutter: window.innerWidth - mainRect.right,
      viewportWidth: window.innerWidth,
      weekWidth: week.getBoundingClientRect().width,
      workspaceColumns: getComputedStyle(rail.parentElement!).gridTemplateColumns,
      workspaceWidth: rail.parentElement!.getBoundingClientRect().width,
    };
  });
  expect(workspaceMetrics.documentWidth).toBeLessThanOrEqual(workspaceMetrics.viewportWidth);
  expect(workspaceMetrics.railWidth, JSON.stringify(workspaceMetrics)).toBeGreaterThanOrEqual(220);
  expect(workspaceMetrics.railWidth, JSON.stringify(workspaceMetrics)).toBeLessThanOrEqual(270);
  expect(workspaceMetrics.railDisplay).toBe("flex");
  expect(workspaceMetrics.railThumbnailWidth).toBeCloseTo(64, 0);
  expect(workspaceMetrics.railThumbnailHeight).toBeCloseTo(52, 0);
  expect(workspaceMetrics.cardColumns).toBe(1);
  expect(workspaceMetrics.clippedDayCards).toBe(0);
  expect(
    workspaceMetrics.dayRows.every((row, index, rows) => index === 0 || row.top > rows[index - 1].bottom),
    JSON.stringify(workspaceMetrics.dayRows),
  ).toBe(true);
  expect(workspaceMetrics.dayRows.every((row) => row.headerLeftOfMeals)).toBe(true);
  expect(workspaceMetrics.dayRows.every((row) => row.headerWidth >= 60 && row.headerWidth <= 72)).toBe(true);
  expect(workspaceMetrics.dayRows.every((row) => row.mealColumns === 3)).toBe(true);
  expect(workspaceMetrics.dayRows.every((row) => row.mealTopSpread <= 1)).toBe(true);
  expect(
    workspaceMetrics.dayRows.every(
      (row) => row.mealLefts[0] < row.mealLefts[1] && row.mealLefts[1] < row.mealLefts[2],
    ),
  ).toBe(true);
  expect(workspaceMetrics.dayRows.every((row) => !row.overflows)).toBe(true);
  expect(Math.abs(workspaceMetrics.leftGutter - workspaceMetrics.rightGutter)).toBeLessThanOrEqual(1);

  expect(
    await page.locator(".planner-day-card__header h2").evaluateAll((headings) =>
      headings.map((heading) => heading.getAttribute("aria-label")),
    ),
  ).toEqual(["Mon 10", "Tue 11", "Wed 12", "Thu 13", "Fri 14", "Sat 15", "Sun 16"]);
  const mealCardMetrics = await page
    .getByRole("button", { name: /Open Recipe 01/ })
    .evaluate((card) => {
      const body = card.querySelector<HTMLElement>(".planner-meal-card__body")!;
      const image = card.querySelector<HTMLElement>(".planner-meal-card__img")!;
      const title = card.querySelector<HTMLElement>(".planner-meal-card__title")!;
      return {
        bodyWidth: body.getBoundingClientRect().width,
        cardWidth: card.getBoundingClientRect().width,
        cardHeight: card.getBoundingClientRect().height,
        columns: getComputedStyle(card).gridTemplateColumns,
        dayCardWidth: card.closest<HTMLElement>(".planner-day-card")!.getBoundingClientRect().width,
        imageDisplay: getComputedStyle(image).display,
        imageHeight: image.getBoundingClientRect().height,
        imageWidth: image.getBoundingClientRect().width,
        recipeRowWidth: card.closest<HTMLElement>(".planner-slot-recipe")!.getBoundingClientRect().width,
        slotWidth: card.closest<HTMLElement>("[data-testid='planner-meal-slot']")!.getBoundingClientRect().width,
        titleVisibleRatio: title.clientWidth / title.scrollWidth,
        titleWidth: title.getBoundingClientRect().width,
        titleWhiteSpace: getComputedStyle(title).whiteSpace,
        titleFontSize: parseFloat(getComputedStyle(title).fontSize),
      };
    });
  expect(mealCardMetrics.imageDisplay).toBe("block");
  expect(mealCardMetrics.imageWidth).toBeCloseTo(56, 0);
  expect(mealCardMetrics.imageHeight).toBeCloseTo(46, 0);
  expect(mealCardMetrics.cardHeight).toBeGreaterThanOrEqual(46);
  expect(
    mealCardMetrics.bodyWidth,
    JSON.stringify({ workspaceMetrics, mealCardMetrics }),
  ).toBeGreaterThanOrEqual(100);
  expect(mealCardMetrics.titleVisibleRatio, JSON.stringify(mealCardMetrics)).toBeGreaterThan(0.9);
  expect(mealCardMetrics.titleFontSize).toBeGreaterThanOrEqual(14);
  expect(mealCardMetrics.titleWhiteSpace).toBe("normal");

  await expect(page).toHaveScreenshot("planner-matrix.png", {
    animations: "disabled",
    fullPage: true,
  });
});

test("anchors the recipe tag popover to the viewport with readable two-column options", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Desktop rail anchoring is verified once.");

  const rail = page.locator(".planner-editorial__sidebar");
  const trigger = rail.getByRole("button", { name: "Filter planner recipes by tag" });
  await expect(trigger).toHaveAccessibleDescription("All tags");
  await trigger.click();
  const panel = page.getByRole("dialog", { name: "Filter planner recipes by tag" });
  await expect(panel).toBeVisible();
  await expect(panel.getByText("Filter recipes", { exact: true })).toBeVisible();
  await expect(panel.getByRole("button", { name: "Done" })).toBeVisible();
  await expect(panel.getByRole("button", { name: "All tags", exact: true })).toHaveAttribute("aria-pressed", "true");

  const tagMetrics = await panel.evaluate((element) => {
    const panelRect = element.getBoundingClientRect();
    const railRect = element.closest<HTMLElement>(".planner-editorial__sidebar")!.getBoundingClientRect();
    const options = Array.from(element.querySelectorAll<HTMLElement>(".tag-filter-popover__option"));
    const optionGroups = Array.from(element.querySelectorAll<HTMLElement>(".tag-filter-popover__group-options"));
    const scrollBody = element.querySelector<HTMLElement>("[class*='scrollBody']")!;
    return {
      bottom: panelRect.bottom,
      groupColumns: optionGroups.map((group) => getComputedStyle(group).gridTemplateColumns.split(" ").length),
      left: panelRect.left,
      panelPosition: getComputedStyle(element).position,
      panelRight: panelRect.right,
      railRight: railRect.right,
      panelScrollWidth: element.scrollWidth,
      panelClientWidth: element.clientWidth,
      scrollBodyOverflow: getComputedStyle(scrollBody).overflowY,
      top: panelRect.top,
      viewportHeight: window.innerHeight,
      viewportWidth: window.innerWidth,
      width: panelRect.width,
      clippedLabels: options
        .filter((option) => {
          const optionRect = option.getBoundingClientRect();
          return optionRect.left < panelRect.left || optionRect.right > panelRect.right || option.scrollWidth > option.clientWidth;
        })
        .map((option) => option.textContent?.trim()),
    };
  });

  expect(tagMetrics.panelPosition).toBe("fixed");
  expect(tagMetrics.width, JSON.stringify(tagMetrics)).toBeCloseTo(360, 0);
  expect(tagMetrics.left, JSON.stringify(tagMetrics)).toBeGreaterThanOrEqual(16);
  expect(tagMetrics.panelRight, JSON.stringify(tagMetrics)).toBeLessThanOrEqual(tagMetrics.viewportWidth - 16);
  expect(tagMetrics.top, JSON.stringify(tagMetrics)).toBeGreaterThanOrEqual(16);
  expect(tagMetrics.bottom, JSON.stringify(tagMetrics)).toBeLessThanOrEqual(tagMetrics.viewportHeight - 12);
  expect(tagMetrics.panelRight, JSON.stringify(tagMetrics)).toBeGreaterThan(tagMetrics.railRight);
  expect(tagMetrics.panelScrollWidth, JSON.stringify(tagMetrics)).toBeLessThanOrEqual(tagMetrics.panelClientWidth);
  expect(tagMetrics.scrollBodyOverflow).toBe("auto");
  expect(tagMetrics.groupColumns.every((columns) => columns === 2)).toBe(true);
  expect(tagMetrics.clippedLabels).toEqual([]);

  await panel.getByRole("button", { name: "Weeknight", exact: true }).click();
  await expect(panel).toBeHidden();
  await expect(trigger).toContainText("Weeknight");
  await expect(trigger).toHaveAccessibleDescription("Weeknight");
  const clearFilter = rail.getByRole("button", { name: "Clear filter" });
  await expect(clearFilter).toBeVisible();
  await trigger.click();
  const reopenedPanel = page.getByRole("dialog", { name: "Filter planner recipes by tag" });
  await expect(reopenedPanel.getByRole("button", { name: "All tags", exact: true })).toHaveAttribute("aria-pressed", "false");
  await expect(reopenedPanel.getByRole("button", { name: "Weeknight", exact: true })).toHaveAttribute("aria-pressed", "true");
  const done = reopenedPanel.getByRole("button", { name: "Done" });
  await done.focus();
  await page.keyboard.press("Tab");
  await expect(reopenedPanel).toBeHidden();
  await expect(clearFilter).toBeFocused();

  await trigger.click();
  await page.getByRole("dialog", { name: "Filter planner recipes by tag" }).getByRole("button", { name: "Done" }).click();
  await expect(trigger).toBeFocused();
});

test("closes an open rail filter when its trigger hides at the responsive breakpoint", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "The desktop rail owns this breakpoint transition.");

  const rail = page.locator(".planner-editorial__sidebar");
  const trigger = rail.getByRole("button", { name: "Filter planner recipes by tag" });
  await trigger.click();
  const panel = page.getByRole("dialog", { name: "Filter planner recipes by tag" });
  await expect(panel).toBeVisible();

  await page.setViewportSize({ width: 700, height: 800 });
  await expect(rail).toBeHidden();
  await expect(panel).toBeHidden();
});

test("keeps the nested picker open when Escape closes its clamped tag popover", async ({ page }) => {
  await page.getByRole("button", { name: "Choose a recipe for breakfast on 2026-08-12" }).click();
  const picker = page.getByRole("dialog", { name: "Choose recipe for meal slot" });
  const trigger = picker.getByRole("button", { name: "Filter planner recipes by tag" });
  await trigger.click();
  const panel = picker.getByRole("dialog", { name: "Filter planner recipes by tag" });
  await expect(panel).toBeVisible();

  const tagMetrics = await panel.evaluate((element) => {
    const panelRect = element.getBoundingClientRect();
    const options = Array.from(element.querySelectorAll<HTMLElement>(".tag-filter-popover__option"));
    return {
      bottom: panelRect.bottom,
      clippedLabels: options
        .filter((option) => option.scrollWidth > option.clientWidth)
        .map((option) => option.textContent?.trim()),
      isNestedInPicker: Boolean(element.closest(".planner-mobile-picker__sheet")),
      panelLeft: panelRect.left,
      panelRight: panelRect.right,
      panelWidth: panelRect.width,
      top: panelRect.top,
      viewportHeight: window.innerHeight,
      viewportWidth: window.innerWidth,
    };
  });

  expect(tagMetrics.isNestedInPicker).toBe(true);
  expect(tagMetrics.panelWidth, JSON.stringify(tagMetrics)).toBeCloseTo(Math.min(360, tagMetrics.viewportWidth - 32), 0);
  expect(tagMetrics.panelLeft, JSON.stringify(tagMetrics)).toBeGreaterThanOrEqual(16);
  expect(tagMetrics.panelRight, JSON.stringify(tagMetrics)).toBeLessThanOrEqual(tagMetrics.viewportWidth - 16);
  expect(tagMetrics.top, JSON.stringify(tagMetrics)).toBeGreaterThanOrEqual(16);
  expect(tagMetrics.bottom, JSON.stringify(tagMetrics)).toBeLessThanOrEqual(tagMetrics.viewportHeight - 12);
  expect(tagMetrics.clippedLabels).toEqual([]);

  const viewport = page.viewportSize()!;
  await page.setViewportSize({ width: viewport.width, height: 260 });
  await expect.poll(async () => panel.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return (
      rect.top >= 16 &&
      rect.bottom <= window.innerHeight - 16 &&
      parseFloat(element.style.maxHeight) <= window.innerHeight - 32
    );
  })).toBe(true);

  await page.keyboard.press("Escape");
  await expect(panel).toBeHidden();
  await expect(picker).toBeVisible();
  await expect(trigger).toBeFocused();
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

  const responsiveLayout = await page.locator(".planner-week-grid").evaluate((week) => {
    const card = week.querySelector<HTMLElement>(".planner-day-card")!;
    const cardRect = card.getBoundingClientRect();
    const headerRect = card.querySelector<HTMLElement>(".planner-day-card__header")!.getBoundingClientRect();
    const meals = card.querySelector<HTMLElement>(".planner-day-card__meals")!;
    const mealsRect = meals.getBoundingClientRect();
    const mealRects = Array.from(
      meals.querySelectorAll<HTMLElement>(":scope > .planner-day-card__meal"),
      (meal) => meal.getBoundingClientRect(),
    );
    const recipeBody = card.querySelector<HTMLElement>(".planner-meal-card__body")!;
    const recipeTitle = card.querySelector<HTMLElement>(".planner-meal-card__title")!;
    return {
      cardColumns: getComputedStyle(week).gridTemplateColumns.split(" ").length,
      cardOverflows: card.scrollWidth > card.clientWidth,
      headerAboveMeals: headerRect.bottom <= mealsRect.top + 1,
      headerLeftOfMeals: headerRect.right <= mealsRect.left + 1,
      mealColumns: getComputedStyle(meals).gridTemplateColumns.split(" ").length,
      mealLeftSpread: Math.max(...mealRects.map((rect) => rect.left)) - Math.min(...mealRects.map((rect) => rect.left)),
      mealTopSpread: Math.max(...mealRects.map((rect) => rect.top)) - Math.min(...mealRects.map((rect) => rect.top)),
      mealsStayInsideCard: mealRects.every((rect) => rect.left >= cardRect.left && rect.right <= cardRect.right + 1),
      recipeBodyWidth: recipeBody.getBoundingClientRect().width,
      recipeTitleFontSize: parseFloat(getComputedStyle(recipeTitle).fontSize),
      recipeTitleOverflowsHorizontally: recipeTitle.scrollWidth > recipeTitle.clientWidth,
    };
  });
  expect(responsiveLayout.cardColumns).toBe(1);
  expect(responsiveLayout.cardOverflows).toBe(false);
  expect(responsiveLayout.mealsStayInsideCard).toBe(true);
  expect(responsiveLayout.recipeBodyWidth, JSON.stringify(responsiveLayout)).toBeGreaterThanOrEqual(100);
  expect(responsiveLayout.recipeTitleFontSize).toBeGreaterThanOrEqual(14);
  expect(responsiveLayout.recipeTitleOverflowsHorizontally).toBe(false);
  if (testInfo.project.name === "phone") {
    expect(responsiveLayout.headerAboveMeals, JSON.stringify(responsiveLayout)).toBe(true);
    expect(responsiveLayout.mealColumns).toBe(1);
    expect(responsiveLayout.mealTopSpread, JSON.stringify(responsiveLayout)).toBeGreaterThan(0);
    expect(responsiveLayout.mealLeftSpread).toBeLessThanOrEqual(1);
  } else {
    expect(responsiveLayout.headerAboveMeals, JSON.stringify(responsiveLayout)).toBe(true);
    expect(responsiveLayout.mealColumns).toBe(3);
    expect(responsiveLayout.mealTopSpread).toBeLessThanOrEqual(1);
    expect(responsiveLayout.mealLeftSpread, JSON.stringify(responsiveLayout)).toBeGreaterThan(0);
  }
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

test("switches day-row internals at the phone breakpoint", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "The day-row breakpoint is verified once.");

  const readLayout = () => page.locator(".planner-week-grid").evaluate((week) => {
    const card = week.querySelector<HTMLElement>(".planner-day-card")!;
    const headerRect = card.querySelector<HTMLElement>(".planner-day-card__header")!.getBoundingClientRect();
    const meals = card.querySelector<HTMLElement>(".planner-day-card__meals")!;
    const mealsRect = meals.getBoundingClientRect();
    const mealRects = Array.from(
      meals.querySelectorAll<HTMLElement>(":scope > .planner-day-card__meal"),
      (meal) => meal.getBoundingClientRect(),
    );
    return {
      cardColumns: getComputedStyle(week).gridTemplateColumns.split(" ").length,
      dayCardOverflows: card.scrollWidth > card.clientWidth,
      headerAboveMeals: headerRect.bottom <= mealsRect.top + 1,
      headerLeftOfMeals: headerRect.right <= mealsRect.left + 1,
      mealColumns: getComputedStyle(meals).gridTemplateColumns.split(" ").length,
      mealTopSpread: Math.max(...mealRects.map((rect) => rect.top)) - Math.min(...mealRects.map((rect) => rect.top)),
      pageOverflows: document.documentElement.scrollWidth > window.innerWidth,
    };
  });

  await page.setViewportSize({ width: 700, height: 800 });
  await expect(page.locator(".planner-editorial__sidebar")).toBeHidden();
  const phoneLayout = await readLayout();
  expect(phoneLayout.cardColumns).toBe(1);
  expect(phoneLayout.headerAboveMeals, JSON.stringify(phoneLayout)).toBe(true);
  expect(phoneLayout.mealColumns).toBe(1);
  expect(phoneLayout.mealTopSpread, JSON.stringify(phoneLayout)).toBeGreaterThan(0);
  expect(phoneLayout.dayCardOverflows).toBe(false);
  expect(phoneLayout.pageOverflows).toBe(false);

  await page.setViewportSize({ width: 701, height: 800 });
  await expect(page.locator(".planner-editorial__sidebar")).toBeHidden();
  const tabletLayout = await readLayout();
  expect(tabletLayout.cardColumns).toBe(1);
  expect(tabletLayout.headerAboveMeals, JSON.stringify(tabletLayout)).toBe(true);
  expect(tabletLayout.mealColumns).toBe(3);
  expect(tabletLayout.mealTopSpread).toBeLessThanOrEqual(1);
  expect(tabletLayout.dayCardOverflows).toBe(false);
  expect(tabletLayout.pageOverflows).toBe(false);

  await page.setViewportSize({ width: 1100, height: 800 });
  await expect(page.locator(".planner-editorial__sidebar")).toBeHidden();
  const wideTabletLayout = await readLayout();
  expect(wideTabletLayout.cardColumns).toBe(1);
  expect(wideTabletLayout.headerAboveMeals, JSON.stringify(wideTabletLayout)).toBe(true);
  expect(wideTabletLayout.mealColumns).toBe(3);
  expect(wideTabletLayout.mealTopSpread).toBeLessThanOrEqual(1);
  expect(wideTabletLayout.dayCardOverflows).toBe(false);
  expect(wideTabletLayout.pageOverflows).toBe(false);

  await page.setViewportSize({ width: 1101, height: 800 });
  await expect(page.locator(".planner-editorial__sidebar")).toBeVisible();
  const desktopLayout = await readLayout();
  expect(desktopLayout.cardColumns).toBe(1);
  expect(desktopLayout.headerLeftOfMeals, JSON.stringify(desktopLayout)).toBe(true);
  expect(desktopLayout.mealColumns).toBe(3);
  expect(desktopLayout.mealTopSpread).toBeLessThanOrEqual(1);
  expect(desktopLayout.dayCardOverflows).toBe(false);
  expect(desktopLayout.pageOverflows).toBe(false);

  const railLayout = await page.locator(".planner-editorial__sidebar").evaluate((rail) => {
    const board = rail.parentElement!.querySelector<HTMLElement>(".planner-week-grid")!;
    return {
      railRight: rail.getBoundingClientRect().right,
      boardLeft: board.getBoundingClientRect().left,
      railDisplay: getComputedStyle(rail.querySelector<HTMLElement>(".planner-editorial__sidebar-scroll")!).display,
    };
  });
  expect(railLayout.railRight).toBeLessThan(railLayout.boardLeft);
  expect(railLayout.railDisplay).toBe("flex");
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

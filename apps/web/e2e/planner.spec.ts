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

test.beforeEach(async ({ page }, testInfo) => {
  if (testInfo.project.name === "desktop") {
    await page.setViewportSize({ width: 1280, height: 800 });
  }
  await installPlannerFixtures(page);
  await page.goto("/planner?week=2026-08-10");
});

test("keeps the full planner in one desktop viewport contract and preserves every planner interaction", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "The fixed viewport contract runs in the desktop project.");
  await expect(page.getByTestId("planner-day-column")).toHaveCount(7);
  await expect(page.getByTestId("planner-meal-slot")).toHaveCount(21);
  const outOfViewport = await page
    .locator(".planner-editorial__day-head, [data-testid='planner-meal-slot']")
    .evaluateAll((elements) =>
      elements.flatMap((element, index) => {
        const rect = element.getBoundingClientRect();
        return rect.top >= 0 && rect.left >= 0 && rect.bottom <= window.innerHeight && rect.right <= window.innerWidth
          ? []
          : [{ index, top: rect.top, right: rect.right, bottom: rect.bottom, left: rect.left }];
      }),
    );
  expect(outOfViewport).toEqual([]);
  const viewportMetrics = await page.evaluate(() => ({
    documentHeight: document.documentElement.scrollHeight,
    documentWidth: document.documentElement.scrollWidth,
    headerHeight: document.querySelector("header")?.getBoundingClientRect().height,
    plannerHeight: document.querySelector(".planner-editorial")?.getBoundingClientRect().height,
    viewportHeight: window.innerHeight,
    viewportWidth: window.innerWidth,
  }));
  expect(viewportMetrics.headerHeight).toBe(72);
  expect(viewportMetrics.documentHeight, JSON.stringify(viewportMetrics)).toBeLessThanOrEqual(
    viewportMetrics.viewportHeight,
  );
  expect(viewportMetrics.documentWidth, JSON.stringify(viewportMetrics)).toBeLessThanOrEqual(
    viewportMetrics.viewportWidth,
  );
  expect(
    await page
      .locator(".planner-editorial__sidebar-scroll")
      .evaluate((node) => node.scrollHeight > node.clientHeight),
  ).toBe(true);

  const plannerMetrics = await page.locator(".planner-editorial").evaluate((planner) => {
    const rect = planner.getBoundingClientRect();
    return {
      leftGutter: rect.left,
      rightGutter: window.innerWidth - rect.right,
      titleSize: Number.parseFloat(
        getComputedStyle(planner.querySelector("h1") as HTMLElement).fontSize,
      ),
      width: rect.width,
    };
  });
  expect(plannerMetrics.width).toBeLessThan(viewportMetrics.viewportWidth);
  expect(Math.abs(plannerMetrics.leftGutter - plannerMetrics.rightGutter)).toBeLessThanOrEqual(1);
  expect(plannerMetrics.titleSize).toBeLessThanOrEqual(38);
  await expect(page.getByRole("link", { name: "New recipe" })).toHaveCount(0);
  await expect(page.locator(".planner-editorial__sidebar-foot")).toHaveCount(0);

  const alignment = await page.evaluate(() => {
    const rail = document.querySelector(".planner-editorial__sidebar")!.getBoundingClientRect();
    const board = document.querySelector(".planner-editorial__grid")!.getBoundingClientRect();
    return { bottomDelta: Math.abs(rail.bottom - board.bottom) };
  });
  expect(alignment.bottomDelta).toBeLessThanOrEqual(1);

  for (const [slotIndex, recipeLayout] of [
    ["0", "one"],
    ["1", "two"],
    ["2", "three"],
  ] as const) {
    const slot = page.locator(`[data-date="2026-08-10"][data-slot-index="${slotIndex}"]`);
    const slotRecipes = slot.getByRole("region");
    await expect(slotRecipes).toHaveAttribute("data-recipe-layout", recipeLayout);
    const metrics = await slotRecipes.evaluate((list) => {
      const listRect = list.getBoundingClientRect();
      const rows = Array.from(list.querySelectorAll<HTMLElement>(".planner-slot-recipe"));
      const first = rows[0]?.getBoundingClientRect();
      const last = rows.at(-1)?.getBoundingClientRect();
      return {
        clientHeight: list.clientHeight,
        consumedHeight: first && last ? last.bottom - first.top : 0,
        rowsVisible: rows.every((row) => {
          const rect = row.getBoundingClientRect();
          return rect.top >= listRect.top && rect.bottom <= listRect.bottom;
        }),
      };
    });
    expect(metrics.rowsVisible).toBe(true);
    expect(Math.abs(metrics.consumedHeight - metrics.clientHeight)).toBeLessThanOrEqual(1);
  }

  const overflowSlot = page.locator('[data-date="2026-08-11"][data-slot-index="0"]');
  const recipeList = overflowSlot.getByRole("region", {
    name: "Breakfast recipes for 2026-08-11",
  });
  const overflowCue = overflowSlot.getByText("1 more", { exact: true });
  await expect(overflowCue).toBeVisible();
  await expect(recipeList).toHaveAccessibleDescription("Scroll for 1 more");
  await expect(
    overflowSlot.getByRole("button", {
      name: "Add another recipe for breakfast on 2026-08-11",
    }),
  ).toBeVisible();
  await expect(
    recipeList.getByRole("button", {
      name: "Open Recipe 09 with a descriptive two-line title for breakfast on 2026-08-11",
    }),
  ).toBeVisible();
  await expect(
    recipeList.getByRole("button", {
      name: "Open Recipe 10 with a descriptive two-line title for breakfast on 2026-08-11",
    }),
  ).toBeAttached();
  const recipeListMetrics = await recipeList.evaluate((list) => {
    const listRect = list.getBoundingClientRect();
    const rows = Array.from(list.querySelectorAll<HTMLElement>(".planner-slot-recipe"));
    return {
      clientHeight: list.clientHeight,
      firstThreeFullyVisible: rows.slice(0, 3).every((row) => {
        const rect = row.getBoundingClientRect();
        return rect.top >= listRect.top && rect.bottom <= listRect.bottom;
      }),
      fourthStartsBelowThird:
        rows[3]?.getBoundingClientRect().top >= listRect.bottom,
      scrollHeight: list.scrollHeight,
    };
  });
  expect(recipeListMetrics.firstThreeFullyVisible).toBe(true);
  expect(recipeListMetrics.fourthStartsBelowThird).toBe(true);
  const firstThreeHeight = await recipeList.evaluate((list) => {
    const rows = Array.from(list.querySelectorAll<HTMLElement>(".planner-slot-recipe"));
    const first = rows[0]?.getBoundingClientRect();
    const third = rows[2]?.getBoundingClientRect();
    return first && third ? third.bottom - first.top : 0;
  });
  expect(Math.abs(firstThreeHeight - recipeListMetrics.clientHeight)).toBeLessThanOrEqual(1);
  expect(recipeListMetrics.scrollHeight).toBeGreaterThan(recipeListMetrics.clientHeight);
  await recipeList.evaluate((list) => list.scrollTo({ top: list.scrollHeight }));
  await expect.poll(() => recipeList.evaluate((list) => list.scrollTop)).toBeGreaterThan(0);
  await recipeList.evaluate((list) => list.scrollTo({ top: 0 }));
  await expect.poll(() => recipeList.evaluate((list) => list.scrollTop)).toBe(0);
  await expect(page.getByRole("button", { name: /Show .* more recipe/ })).toHaveCount(0);
  await expect(page.getByRole("dialog", { name: "Breakfast recipes for 2026-08-11" })).toHaveCount(0);

  const pickerTrigger = page.getByRole("button", {
    name: "Choose a recipe for breakfast on 2026-08-12",
  });
  await pickerTrigger.click();
  const pickerForGeometry = page.getByRole("dialog", { name: "Choose recipe for meal slot" });
  const pickerClose = pickerForGeometry.locator(".planner-mobile-picker__close");
  await expect(pickerClose).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(
    pickerForGeometry.getByRole("button", {
      name: "Add Recipe 24 with a descriptive two-line title",
    }),
  ).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(pickerClose).toBeFocused();
  await expect(pickerForGeometry.locator(".planner-mobile-picker__close-label")).toBeVisible();

  await pickerClose.click();
  await expect(pickerForGeometry).toBeHidden();
  await expect(pickerTrigger).toBeFocused();

  await pickerTrigger.click();
  await expect(pickerForGeometry.locator(".planner-mobile-picker__close")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(pickerForGeometry).toBeHidden();
  await expect(pickerTrigger).toBeFocused();

  await pickerTrigger.click();
  const pickerGeometry = await pickerForGeometry.evaluate((dialog) => {
    const sheet = dialog.querySelector<HTMLElement>(".planner-mobile-picker__sheet")!;
    const list = dialog.querySelector<HTMLElement>(".planner-mobile-picker__list")!;
    const cards = Array.from(list.querySelectorAll<HTMLElement>(".planner-source-card"));
    const columns = getComputedStyle(list).gridTemplateColumns
      .split(" ")
      .filter((column) => column !== "none").length;

    return {
      cardMetrics: cards.map((card) => {
        const media = card.querySelector<HTMLElement>(".planner-drag-card__thumb")!;
        const title = card.querySelector<HTMLElement>(".planner-drag-card__title")!;
        const lineHeight = Number.parseFloat(getComputedStyle(title).lineHeight);
        const mediaRect = media.getBoundingClientRect();

        return {
          addActions: Array.from(card.querySelectorAll("button")).filter(
            (button) => button.textContent?.trim() === "Add",
          ).length,
          mediaHeight: mediaRect.height,
          mediaRatio: mediaRect.width / mediaRect.height,
          pickerCursor: getComputedStyle(card.querySelector<HTMLElement>(".planner-drag-card")!).cursor,
          titleHeight: title.getBoundingClientRect().height,
          titleLineHeight: lineHeight,
        };
      }),
      columns,
      sheetWidth: sheet.getBoundingClientRect().width,
      viewportWidth: window.innerWidth,
    };
  });
  expect(pickerGeometry.columns).toBe(3);
  expect(pickerGeometry.sheetWidth).toBeLessThanOrEqual(
    Math.min(50 * 16, pickerGeometry.viewportWidth - 3 * 16) + 1,
  );
  expect(pickerGeometry.cardMetrics).not.toHaveLength(0);
  for (const card of pickerGeometry.cardMetrics) {
    expect(Math.abs(card.mediaRatio - 16 / 9)).toBeLessThanOrEqual(1 / card.mediaHeight);
    expect(card.titleHeight).toBeLessThanOrEqual(card.titleLineHeight * 2 + 1);
    expect(card.addActions).toBe(1);
    expect(card.pickerCursor).toBe("default");
  }
  await expect(page.locator(".planner-editorial__sidebar .planner-drag-card").first()).toHaveCSS(
    "cursor",
    "grab",
  );
  const thumbnailCard = pickerForGeometry.locator(".planner-source-card", {
    hasText: "Recipe 01 with a descriptive two-line title",
  });
  const thumbnailImage = thumbnailCard.getByRole("img", {
    name: "Recipe 01 with a descriptive two-line title",
  });
  await expect(thumbnailImage).toHaveAttribute("src", inlineRecipeThumbnail);
  await expect.poll(() =>
    thumbnailImage.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0),
  ).toBe(true);
  const railThumbnailImage = page
    .locator(".planner-editorial__sidebar")
    .getByRole("img", { name: "Recipe 01 with a descriptive two-line title" });
  await expect.poll(() =>
    railThumbnailImage.evaluate(
      (image: HTMLImageElement) => image.complete && image.naturalWidth > 0,
    ),
  ).toBe(true);
  const placeholderCard = pickerForGeometry.locator(".planner-source-card", {
    hasText: "Recipe 02 with a descriptive two-line title",
  });
  await expect(placeholderCard.locator(".planner-drag-card__thumb")).toBeVisible();
  await expect(placeholderCard.locator(".planner-drag-card__thumb img")).toHaveCount(0);
  await pickerForGeometry.locator(".planner-mobile-picker__backdrop").click({
    position: { x: 20, y: 100 },
  });
  await expect(pickerForGeometry).toBeHidden();
  await expect(pickerTrigger).toBeFocused();

  await expect(page).toHaveScreenshot("planner.png", {
    animations: "disabled",
    fullPage: true,
  });

  const removeRequest = page.waitForRequest(
    (request) => request.method() === "PUT" && request.url().endsWith("/meal-plan/2026-08-11"),
  );
  await page
    .getByRole("button", {
      name: "Remove Recipe 07 with a descriptive two-line title from breakfast on 2026-08-11",
    })
    .click();
  expect((await removeRequest).postDataJSON().breakfast).toEqual(["recipe-08", "recipe-09", "recipe-10"]);
  await expect(
    overflowSlot.getByRole("button", {
      name: "Remove Recipe 08 with a descriptive two-line title from breakfast on 2026-08-11",
    }),
  ).toBeFocused();
  await expect(overflowCue).toHaveCount(0);
  await expect(recipeList).not.toHaveAttribute("aria-describedby");

  await page
    .getByRole("button", { name: "Choose a recipe for breakfast on 2026-08-12" })
    .click();
  const picker = page.getByRole("dialog", { name: "Choose recipe for meal slot" });
  const addRequest = page.waitForRequest(
    (request) => request.method() === "PUT" && request.url().endsWith("/meal-plan/2026-08-12"),
  );
  await picker
    .getByRole("button", { name: "Add Recipe 01 with a descriptive two-line title" })
    .click();
  expect((await addRequest).postDataJSON().breakfast).toEqual(["recipe-01"]);
  const selectedSlot = page.locator('[data-date="2026-08-12"][data-slot-index="0"]');
  await expect(selectedSlot).toBeFocused();
  await expect(selectedSlot).toHaveAttribute("tabindex", "-1");
  await expect(
    selectedSlot.getByRole("button", {
      name: "Open Recipe 01 with a descriptive two-line title for breakfast on 2026-08-12",
    }),
  ).toBeVisible();

  const dragSource = page.locator(".planner-drag-card").filter({ hasText: "Recipe 07" });
  const dropTarget = page.locator('[data-date="2026-08-13"][data-slot-index="1"]');
  const dragRequest = page.waitForRequest(
    (request) => request.method() === "PUT" && request.url().endsWith("/meal-plan/2026-08-13"),
  );
  const dataTransfer = await page.evaluateHandle(() => new DataTransfer());
  await dragSource.dispatchEvent("dragstart", { dataTransfer });
  await dropTarget.dispatchEvent("dragover", { dataTransfer });
  await dropTarget.dispatchEvent("drop", { dataTransfer });
  expect((await dragRequest).postDataJSON().lunch).toEqual(["recipe-07"]);
  await expect(
    dropTarget.getByRole("button", {
      name: "Open Recipe 07 with a descriptive two-line title for lunch on 2026-08-13",
    }),
  ).toBeVisible();

  await page
    .locator('[data-date="2026-08-10"][data-slot-index="1"]')
    .getByRole("button", {
      name: "Open Recipe 02 with a descriptive two-line title for lunch on 2026-08-10",
    })
    .click();
  await expect(page).toHaveURL(/\/recipe\/recipe-02$/);
});

test("keeps phone and tablet planners stacked, scrollable, and picker-friendly", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "desktop", "Responsive planner behavior runs in phone and tablet projects.");
  await expect(page.getByTestId("planner-day-column")).toHaveCount(7);
  await expect(page.getByTestId("planner-meal-slot")).toHaveCount(21);
  await expect(page.getByText("Phone-friendly planning")).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollHeight > window.innerHeight),
  ).toBe(true);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBe(true);

  const [firstDay, secondDay] = await page.getByTestId("planner-day-column").evaluateAll((days) =>
    days.slice(0, 2).map((day) => {
      const box = day.getBoundingClientRect();
      return { bottom: box.bottom, top: box.top };
    }),
  );
  expect(secondDay.top).toBeGreaterThanOrEqual(firstDay.bottom);

  await page
    .getByRole("button", { name: "Choose a recipe for breakfast on 2026-08-12" })
    .click();
  const picker = page.getByRole("dialog", { name: "Choose recipe for meal slot" });
  await expect(picker).toBeVisible();
  const pickerLayout = await picker.evaluate((dialog) => {
    const sheet = dialog.querySelector<HTMLElement>(".planner-mobile-picker__sheet")!;
    const list = dialog.querySelector<HTMLElement>(".planner-mobile-picker__list")!;
    const sheetRect = sheet.getBoundingClientRect();

    return {
      bottomDelta: Math.abs(window.innerHeight - sheetRect.bottom),
      display: getComputedStyle(list).display,
      flexDirection: getComputedStyle(list).flexDirection,
    };
  });
  expect(pickerLayout.display).toBe("flex");
  expect(pickerLayout.flexDirection).toBe("column");
  expect(pickerLayout.bottomDelta).toBeLessThanOrEqual(1);
  await expect(picker.locator(".planner-mobile-picker__close-label")).toBeHidden();
  const addRequest = page.waitForRequest(
    (request) => request.method() === "PUT" && request.url().endsWith("/meal-plan/2026-08-12"),
  );
  await picker
    .getByRole("button", { name: "Add Recipe 01 with a descriptive two-line title" })
    .click();
  expect((await addRequest).postDataJSON().breakfast).toEqual(["recipe-01"]);
  await expect(picker).toBeHidden();
  await expect(
    page.locator('[data-date="2026-08-12"][data-slot-index="0"]').getByRole("button", {
      name: "Open Recipe 01 with a descriptive two-line title for breakfast on 2026-08-12",
    }),
  ).toBeVisible();
});

test("preserves the stacked-to-desktop planner boundary at 1023 and 1024 pixels", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "The exact breakpoint contract runs in the desktop project.");

  await page.setViewportSize({ width: 1023, height: 800 });
  await expect(page.locator(".planner-editorial__sidebar")).toBeHidden();
  const stackedMetrics = await page.locator(".planner-editorial__grid").evaluate((grid) => ({
    columns: getComputedStyle(grid).gridTemplateColumns.split(" ").length,
    hasHorizontalOverflow: document.documentElement.scrollWidth > window.innerWidth,
    hasVerticalScroll: document.documentElement.scrollHeight > window.innerHeight,
  }));
  expect(stackedMetrics.columns).toBe(1);
  expect(stackedMetrics.hasVerticalScroll).toBe(true);
  expect(stackedMetrics.hasHorizontalOverflow).toBe(false);

  await page.setViewportSize({ width: 1024, height: 800 });
  await expect(page.locator(".planner-editorial__sidebar")).toBeVisible();
  expect(
    await page
      .locator(".planner-editorial__grid")
      .evaluate((grid) => getComputedStyle(grid).gridTemplateColumns.split(" ").length),
  ).toBe(7);
});

test("keeps the Chinese overflow cue fully inside a narrow desktop meal slot", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "The narrow slot geometry contract runs in the desktop project.");
  await page.getByRole("button", { name: "Account for planner@example.com" }).click();
  await page.getByRole("button", { name: "中文" }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "zh");

  const breakfastSlot = page.locator('[data-date="2026-08-11"][data-slot-index="0"]');
  const cue = breakfastSlot.locator(".planner-slot-overflow-cue");
  const visibleCueMessage = cue.getByText("另 1 道", { exact: true });
  const recipeList = breakfastSlot.getByRole("region", {
    name: "2026-08-11 的早餐菜谱",
  });

  await expect(cue).toBeVisible();
  await expect(cue).toContainText("↓");
  await expect(visibleCueMessage).toBeVisible();
  await expect(recipeList).toHaveAccessibleDescription("滚动查看另外 1 道菜谱");

  const cueMetrics = await cue.evaluate((element) => {
    const cueRect = element.getBoundingClientRect();
    const slotRect = element.closest<HTMLElement>("[data-testid='planner-meal-slot']")
      ?.getBoundingClientRect();

    return {
      cueLeft: cueRect.left,
      cueRight: cueRect.right,
      cueWidth: cueRect.width,
      cueContentFits: element.scrollWidth <= element.clientWidth,
      documentHasHorizontalOverflow:
        document.documentElement.scrollWidth > window.innerWidth,
      slotLeft: slotRect?.left ?? 0,
      slotRight: slotRect?.right ?? 0,
      slotWidth: slotRect?.width ?? 0,
    };
  });

  expect(cueMetrics.cueLeft).toBeGreaterThanOrEqual(cueMetrics.slotLeft - 0.5);
  expect(cueMetrics.cueRight).toBeLessThanOrEqual(cueMetrics.slotRight + 0.5);
  expect(cueMetrics.cueWidth).toBeLessThanOrEqual(cueMetrics.slotWidth + 0.5);
  expect(cueMetrics.cueContentFits).toBe(true);
  expect(cueMetrics.documentHasHorizontalOverflow).toBe(false);
});

test("supports keyboard traversal through desktop slot controls and the in-slot recipe list", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Desktop keyboard order runs in the desktop project.");
  const firstTile = page.getByRole("button", {
    name: "Open Recipe 07 with a descriptive two-line title for breakfast on 2026-08-11",
  });
  const firstRemove = page.getByRole("button", {
    name: "Remove Recipe 07 with a descriptive two-line title from breakfast on 2026-08-11",
  });
  const recipeList = page.getByRole("region", {
    name: "Breakfast recipes for 2026-08-11",
  });

  await recipeList.focus();
  await expect(recipeList).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(firstTile).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(firstRemove).toBeFocused();
  await expect(firstRemove).toHaveCSS("opacity", "1");
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("button", {
      name: "Open Recipe 08 with a descriptive two-line title for breakfast on 2026-08-11",
    }),
  ).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("button", {
      name: "Remove Recipe 08 with a descriptive two-line title from breakfast on 2026-08-11",
    }),
  ).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("button", {
      name: "Open Recipe 09 with a descriptive two-line title for breakfast on 2026-08-11",
    }),
  ).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("button", {
      name: "Remove Recipe 09 with a descriptive two-line title from breakfast on 2026-08-11",
    }),
  ).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("button", {
      name: "Open Recipe 10 with a descriptive two-line title for breakfast on 2026-08-11",
    }),
  ).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("button", {
      name: "Remove Recipe 10 with a descriptive two-line title from breakfast on 2026-08-11",
    }),
  ).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("button", { name: "Add another recipe for breakfast on 2026-08-11" }),
  ).toBeFocused();

  await page
    .getByRole("button", { name: "Add another recipe for dinner on 2026-08-10" })
    .focus();
  await page.keyboard.press("Tab");
  await expect(
    recipeList,
  ).toBeFocused();
});

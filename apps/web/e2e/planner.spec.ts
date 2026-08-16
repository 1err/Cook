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

const recipes = Array.from({ length: 24 }, (_, index) => {
  const number = String(index + 1).padStart(2, "0");

  return {
    id: `recipe-${number}`,
    title: `Recipe ${number} with a descriptive two-line title`,
    source_url: null,
    thumbnail_url: null,
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
        breakfast: ["recipe-01", "recipe-02", "recipe-03"],
        lunch: ["recipe-04", "recipe-05"],
        dinner: ["recipe-06"],
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

test("keeps the full planner in one desktop viewport and preserves every planner interaction", async ({ page }, testInfo) => {
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

  const overflow = page.getByRole("button", {
    name: "Show 1 more recipe for breakfast on 2026-08-10",
  });
  await expect(overflow).toBeVisible();
  await expect(page).toHaveScreenshot("planner.png", {
    animations: "disabled",
    fullPage: true,
  });

  await overflow.click();
  const overflowDialog = page.getByRole("dialog", {
    name: "Breakfast recipes for 2026-08-10",
  });
  await expect(overflowDialog).toBeVisible();
  await expect(overflowDialog.locator(":focus")).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(overflow).toBeFocused();

  const removeRequest = page.waitForRequest(
    (request) => request.method() === "PUT" && request.url().endsWith("/meal-plan/2026-08-10"),
  );
  await page
    .getByRole("button", {
      name: "Remove Recipe 01 with a descriptive two-line title from breakfast on 2026-08-10",
    })
    .click();
  expect((await removeRequest).postDataJSON().breakfast).toEqual(["recipe-02", "recipe-03"]);

  await page
    .getByRole("button", { name: "Choose a recipe for breakfast on 2026-08-11" })
    .click();
  const picker = page.getByRole("dialog", { name: "Choose recipe for meal slot" });
  const addRequest = page.waitForRequest(
    (request) => request.method() === "PUT" && request.url().endsWith("/meal-plan/2026-08-11"),
  );
  await picker.getByRole("button", { name: "Add", exact: true }).first().click();
  expect((await addRequest).postDataJSON().breakfast).toEqual(["recipe-01"]);
  await expect(
    page.locator('[data-date="2026-08-11"][data-slot-index="0"]').getByRole("button", {
      name: "Open Recipe 01 with a descriptive two-line title for breakfast on 2026-08-11",
    }),
  ).toBeVisible();

  const dragSource = page.locator(".planner-drag-card").filter({ hasText: "Recipe 07" });
  const dropTarget = page.locator('[data-date="2026-08-12"][data-slot-index="1"]');
  const dragRequest = page.waitForRequest(
    (request) => request.method() === "PUT" && request.url().endsWith("/meal-plan/2026-08-12"),
  );
  const dataTransfer = await page.evaluateHandle(() => new DataTransfer());
  await dragSource.dispatchEvent("dragstart", { dataTransfer });
  await dropTarget.dispatchEvent("dragover", { dataTransfer });
  await dropTarget.dispatchEvent("drop", { dataTransfer });
  expect((await dragRequest).postDataJSON().lunch).toEqual(["recipe-07"]);
  await expect(
    dropTarget.getByRole("button", {
      name: "Open Recipe 07 with a descriptive two-line title for lunch on 2026-08-12",
    }),
  ).toBeVisible();

  await page
    .locator('[data-date="2026-08-10"][data-slot-index="1"]')
    .getByRole("button", {
      name: "Open Recipe 04 with a descriptive two-line title for lunch on 2026-08-10",
    })
    .click();
  await expect(page).toHaveURL(/\/recipe\/recipe-04$/);
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
    .getByRole("button", { name: "Choose a recipe for breakfast on 2026-08-11" })
    .click();
  const picker = page.getByRole("dialog", { name: "Choose recipe for meal slot" });
  await expect(picker).toBeVisible();
  const addRequest = page.waitForRequest(
    (request) => request.method() === "PUT" && request.url().endsWith("/meal-plan/2026-08-11"),
  );
  await picker.getByRole("button", { name: "Add", exact: true }).first().click();
  expect((await addRequest).postDataJSON().breakfast).toEqual(["recipe-01"]);
  await expect(picker).toBeHidden();
  await expect(
    page.locator('[data-date="2026-08-11"][data-slot-index="0"]').getByRole("button", {
      name: "Open Recipe 01 with a descriptive two-line title for breakfast on 2026-08-11",
    }),
  ).toBeVisible();
});

test("supports keyboard traversal through desktop slot controls and overflow", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Desktop keyboard order runs in the desktop project.");
  const firstTile = page.getByRole("button", {
    name: "Open Recipe 01 with a descriptive two-line title for breakfast on 2026-08-10",
  });
  const firstRemove = page.getByRole("button", {
    name: "Remove Recipe 01 with a descriptive two-line title from breakfast on 2026-08-10",
  });
  const overflow = page.getByRole("button", {
    name: "Show 1 more recipe for breakfast on 2026-08-10",
  });

  await page.getByRole("button", { name: "Next" }).focus();
  await page.keyboard.press("Tab");
  await expect(firstTile).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(firstRemove).toBeFocused();
  await expect(firstRemove).toHaveCSS("opacity", "1");
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("button", {
      name: "Open Recipe 02 with a descriptive two-line title for breakfast on 2026-08-10",
    }),
  ).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("button", {
      name: "Remove Recipe 02 with a descriptive two-line title from breakfast on 2026-08-10",
    }),
  ).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("button", { name: "Add another recipe for breakfast on 2026-08-10" }),
  ).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(overflow).toBeFocused();

  await page
    .getByRole("button", { name: "Add another recipe for dinner on 2026-08-10" })
    .focus();
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("button", { name: "Choose a recipe for breakfast on 2026-08-11" }),
  ).toBeFocused();

  await overflow.focus();
  await page.keyboard.press("Enter");
  const overflowDialog = page.getByRole("dialog", {
    name: "Breakfast recipes for 2026-08-10",
  });
  await expect(overflowDialog).toBeVisible();
  await expect(overflowDialog.getByRole("button", { name: "Close meal recipes" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(overflow).toBeFocused();
});

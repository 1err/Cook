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
  const color = index % 2 === 0 ? "#e07a5f" : "#9a442d";
  const thumbnail = `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="120"><rect width="160" height="120" fill="${color}"/><circle cx="80" cy="60" r="34" fill="#ffdbd2"/><text x="80" y="67" text-anchor="middle" font-family="sans-serif" font-size="22" fill="#55423e">${number}</text></svg>`;

  return {
    id: `recipe-${number}`,
    title: `Recipe ${number} with a descriptive two-line title`,
    source_url: null,
    thumbnail_url: `data:image/svg+xml,${encodeURIComponent(thumbnail)}`,
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

test.use({ viewport: { width: 1280, height: 800 } });

test.beforeEach(async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "The planner viewport contract runs in the desktop project.");
  await installPlannerFixtures(page);
  await page.goto("/planner?week=2026-08-10");
});

test("keeps the full planner in one desktop viewport and preserves every planner interaction", async ({ page }) => {
  await expect(page.getByTestId("planner-day-column")).toHaveCount(7);
  await expect(page.getByTestId("planner-meal-slot")).toHaveCount(21);
  const viewportMetrics = await page.evaluate(() => ({
    documentHeight: document.documentElement.scrollHeight,
    headerHeight: document.querySelector("header")?.getBoundingClientRect().height,
    plannerHeight: document.querySelector(".planner-editorial")?.getBoundingClientRect().height,
    viewportHeight: window.innerHeight,
  }));
  expect(viewportMetrics.documentHeight, JSON.stringify(viewportMetrics)).toBeLessThanOrEqual(
    viewportMetrics.viewportHeight,
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

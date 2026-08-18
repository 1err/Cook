import { expect, test, type Page, type Route } from "@playwright/test";

const appOrigin = `http://127.0.0.1:${process.env.PORT ?? "3000"}`;

const shoppingItems = [
  { name: "Jasmine rice", total_quantity: "2 cups" },
  { name: "Kale", total_quantity: "1 bunch" },
  { name: "Whole milk", total_quantity: "1 quart" },
];

const mealPlans = [
  {
    date: "2026-08-10",
    breakfast: ["recipe-1"],
    lunch: [],
    dinner: [],
  },
];

const recipes = [
  {
    id: "recipe-1",
    title: "Ginger rice bowl",
    source_url: null,
    thumbnail_url: null,
    ingredients: shoppingItems.map(({ name, total_quantity }) => ({
      name,
      quantity: total_quantity,
    })),
    raw_extraction_text: null,
    library_tags: ["weeknight"],
    library_category: "weeknight",
    is_public_catalog: false,
    catalog_source_recipe_id: null,
    description: null,
    total_time_minutes: 30,
    steps: [],
    tips: [],
    equipment: [],
  },
];

const refinedList = {
  remove: [],
  likely_pantry: [],
  purchase_items: [
    { name: "Jasmine rice", suggested_purchase: "2 cups", category: "Pantry & Dry Goods" },
    { name: "Kale", suggested_purchase: "1 bunch", category: "Produce" },
    { name: "Whole milk", suggested_purchase: "1 quart", category: "Dairy" },
  ],
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

async function installShoppingFixtures(page: Page) {
  await page.route("http://localhost:8000/**", async (route) => {
    const request = route.request();
    const { pathname } = new URL(request.url());

    if (pathname === "/auth/me") {
      await fulfillJson(route, {
        id: "00000000-0000-0000-0000-000000000001",
        email: "shopping@example.com",
        is_library_public: false,
      });
      return;
    }
    if (pathname === "/shopping-list/refine" && request.method() === "POST") {
      await fulfillJson(route, refinedList);
      return;
    }
    if (pathname === "/shopping-list") {
      await fulfillJson(route, shoppingItems);
      return;
    }
    if (pathname === "/meal-plan") {
      await fulfillJson(route, mealPlans);
      return;
    }
    if (pathname === "/recipes") {
      await fulfillJson(route, recipes);
      return;
    }

    await route.abort();
  });
}

const libraryTitleSizeByProject = {
  phone: 29.6,
  tablet: 32.8,
  desktop: 37.6,
} as const;

test.beforeEach(async ({ page }) => {
  await installShoppingFixtures(page);
  await page.goto("/shopping-list?week=2026-08-10");
});

test("keeps confirmation and smart shopping restrained at every viewport", async ({ page }, testInfo) => {
  const expectedTitleSize = libraryTitleSizeByProject[
    testInfo.project.name as keyof typeof libraryTitleSizeByProject
  ];
  expect(expectedTitleSize).toBeDefined();

  const confirmationTitle = page.getByRole("heading", { name: "Shopping List" });
  await expect(confirmationTitle).toBeVisible();

  const confirmationMetrics = await page.locator(".shop-page--wide").evaluate((shell) => {
    const shellRect = shell.getBoundingClientRect();
    const title = shell.querySelector<HTMLElement>(".shop-confirm-title");
    const asideTitle = shell.querySelector<HTMLElement>(".shop-confirm-aside__title");
    if (!title || !asideTitle) throw new Error("Shopping confirmation headings are missing");
    const titleStyle = getComputedStyle(title);
    const asideStyle = getComputedStyle(asideTitle);
    const tokenProbe = document.createElement("span");
    tokenProbe.style.fontFamily = "var(--font-inter), monospace";
    const sourceSerifProbe = document.createElement("span");
    sourceSerifProbe.className = "cw-display";
    document.body.append(tokenProbe, sourceSerifProbe);
    const metrics = {
      asideTitleSize: Number.parseFloat(asideStyle.fontSize),
      documentWidth: document.documentElement.scrollWidth,
      interTokenFamily: getComputedStyle(tokenProbe).fontFamily,
      leftGutter: shellRect.left,
      overflowingElements: Array.from(document.querySelectorAll<HTMLElement>("body *"))
        .filter((element) => element.getBoundingClientRect().right > document.documentElement.clientWidth + 0.5)
        .slice(0, 5)
        .map((element) => ({
          className: element.className,
          right: element.getBoundingClientRect().right,
          tagName: element.tagName,
          width: element.getBoundingClientRect().width,
        })),
      paddingLeft: Number.parseFloat(getComputedStyle(shell).paddingLeft),
      rightGutter: document.documentElement.clientWidth - shellRect.right,
      shellWidth: shellRect.width,
      sourceSerifFamily: getComputedStyle(sourceSerifProbe).fontFamily,
      titleFamily: titleStyle.fontFamily,
      titleMarginBottom: Number.parseFloat(titleStyle.marginBottom),
      titleSize: Number.parseFloat(titleStyle.fontSize),
      viewportWidth: document.documentElement.clientWidth,
    };
    tokenProbe.remove();
    sourceSerifProbe.remove();
    return metrics;
  });

  expect(confirmationMetrics.shellWidth).toBeLessThanOrEqual(1120);
  expect(Math.abs(confirmationMetrics.leftGutter - confirmationMetrics.rightGutter)).toBeLessThanOrEqual(1);
  expect(
    confirmationMetrics.documentWidth,
    JSON.stringify(confirmationMetrics),
  ).toBeLessThanOrEqual(confirmationMetrics.viewportWidth);
  expect(confirmationMetrics.paddingLeft).toBeGreaterThanOrEqual(testInfo.project.name === "phone" ? 20 : 24);
  expect(confirmationMetrics.titleSize).toBeCloseTo(expectedTitleSize, 1);
  expect(confirmationMetrics.titleMarginBottom).toBeCloseTo(5.6, 1);
  expect(confirmationMetrics.asideTitleSize).toBeLessThanOrEqual(26.4);
  expect(confirmationMetrics.interTokenFamily).toContain("Inter");
  expect(confirmationMetrics.titleFamily).toContain("Inter");
  expect(confirmationMetrics.sourceSerifFamily).toContain("Source Serif 4");

  await page.getByRole("button", { name: "Prepare smart shopping list" }).click();
  const smartTitle = page.getByRole("heading", { name: "Smart shopping list" });
  await expect(smartTitle).toBeVisible();

  const smartMetrics = await page.locator(".shop-page--wide").evaluate((shell) => {
    const title = shell.querySelector<HTMLElement>(".shop-smart-hero__title");
    const primaryColumn = shell.querySelector<HTMLElement>(".shop-bento-column--primary");
    const secondaryColumn = shell.querySelector<HTMLElement>(".shop-bento-column--secondary");
    if (!title || !primaryColumn || !secondaryColumn) {
      throw new Error("Smart shopping layout is missing");
    }
    const titleStyle = getComputedStyle(title);
    const primaryRect = primaryColumn.getBoundingClientRect();
    const secondaryRect = secondaryColumn.getBoundingClientRect();
    return {
      columnsAreSideBySide: secondaryRect.left >= primaryRect.right,
      columnsAreStacked: secondaryRect.top >= primaryRect.bottom,
      documentWidth: document.documentElement.scrollWidth,
      narrowestColumnWidth: Math.min(primaryRect.width, secondaryRect.width),
      titleMarginBottom: Number.parseFloat(titleStyle.marginBottom),
      titleSize: Number.parseFloat(titleStyle.fontSize),
      viewportWidth: document.documentElement.clientWidth,
    };
  });

  expect(smartMetrics.titleSize).toBeCloseTo(expectedTitleSize, 1);
  expect(smartMetrics.titleMarginBottom).toBeCloseTo(5.6, 1);
  expect(smartMetrics.documentWidth).toBeLessThanOrEqual(smartMetrics.viewportWidth);
  if (testInfo.project.name === "desktop") {
    expect(smartMetrics.columnsAreSideBySide).toBe(true);
    expect(smartMetrics.narrowestColumnWidth).toBeGreaterThan(480);
  } else {
    expect(smartMetrics.columnsAreStacked).toBe(true);
    expect(smartMetrics.narrowestColumnWidth).toBeGreaterThan(300);
  }
});

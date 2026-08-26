import { expect, test, type Page, type Route } from "@playwright/test";

const appOrigin = `http://127.0.0.1:${process.env.PORT ?? "3000"}`;

const shoppingItems = [
  { name: "Jasmine rice", total_quantity: "2 cups" },
  { name: "Kale", total_quantity: "1 bunch" },
  { name: "Whole milk", total_quantity: "1 quart" },
];

const mealPlans = [
  { date: "2026-08-10", breakfast: ["recipe-1"], lunch: [], dinner: [] },
];

const recipes = [
  {
    id: "recipe-1",
    title: "Ginger rice bowl",
    source_url: null,
    thumbnail_url: null,
    ingredients: shoppingItems.map(({ name, total_quantity }) => ({ name, quantity: total_quantity })),
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

const storeProducts = [
  { name: "Organic kale bunch", price: "$2.99", image: "", url: "https://www.sayweee.com/product/kale-1" },
  { name: "Baby kale", price: "$3.49", image: "", url: "https://www.sayweee.com/product/kale-2" },
  { name: "Tuscan kale", price: "$4.19", image: "", url: "https://www.sayweee.com/product/kale-3" },
];

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
    if (pathname === "/store-products") {
      await fulfillJson(route, {
        products: storeProducts,
        expires_at: "2030-01-01T00:00:00.000Z",
      });
      return;
    }

    await route.abort();
  });
}

test.beforeEach(async ({ page }) => {
  await installShoppingFixtures(page);
  await page.goto("/shopping-list?week=2026-08-10");
});

test("loads local Inter faces for every requested Shopping weight", async ({ page }) => {
  const loadedFaces = await page.evaluate(async () => {
    const requestedWeights = ["500", "800", "900"];
    await Promise.all(
      requestedWeights.map((weight) => document.fonts.load(`${weight} 16px Inter`, "Chef World")),
    );
    await document.fonts.ready;
    const interFaces = Array.from(document.fonts).filter(
      (face) => face.family.replace(/["']/g, "") === "Inter",
    );
    return requestedWeights.map((weight) => ({
      loaded: interFaces.some((face) => face.weight === weight && face.status === "loaded"),
      weight,
    }));
  });

  expect(loadedFaces).toEqual([
    { loaded: true, weight: "500" },
    { loaded: true, weight: "800" },
    { loaded: true, weight: "900" },
  ]);
});

test("keeps preparation in context and renders smart groceries without horizontal overflow", async ({ page }, testInfo) => {
  await expect(page.getByRole("heading", { name: "Shopping List" })).toBeVisible();
  const preparePanel = page.getByRole("region", { name: "Prepare smart shopping list" });
  await expect(preparePanel.getByRole("heading", { name: "Planned meals" })).toBeVisible();
  await expect(preparePanel.getByRole("heading", { name: "Prepare smart list" })).toBeVisible();
  await expect(preparePanel.getByText("Ginger rice bowl")).toBeVisible();

  const shellMetrics = await page.locator('[data-page-shell="default"]').evaluate((shell) => {
    const rect = shell.getBoundingClientRect();
    return {
      documentWidth: document.documentElement.scrollWidth,
      leftGutter: rect.left,
      rightGutter: window.innerWidth - rect.right,
      shellWidth: rect.width,
      viewportWidth: window.innerWidth,
    };
  });
  expect(shellMetrics.shellWidth).toBeLessThanOrEqual(1280);
  expect(Math.abs(shellMetrics.leftGutter - shellMetrics.rightGutter)).toBeLessThanOrEqual(1);
  expect(shellMetrics.documentWidth).toBeLessThanOrEqual(shellMetrics.viewportWidth);

  await preparePanel.getByRole("button", { name: "Prepare smart shopping list" }).click();
  await expect(page.getByText("Smart mode", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Produce" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Pantry & Dry Goods" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Dairy" })).toBeVisible();
  await expect(page.locator("[data-category-icon]")).toHaveCount(0);

  const categoryLayout = await page.getByRole("heading", { name: "Produce" }).locator("..").locator("..").evaluate((section) => ({
    width: section.getBoundingClientRect().width,
    pageHasOverflow: document.documentElement.scrollWidth > window.innerWidth,
  }));
  expect(categoryLayout.pageHasOverflow).toBe(false);
  expect(categoryLayout.width).toBeGreaterThan(testInfo.project.name === "phone" ? 300 : 320);

  const produceSection = page.getByRole("heading", { name: "Produce" }).locator("..").locator("..");
  await produceSection.getByRole("button", { name: "View products" }).click();
  await expect(produceSection.getByTestId("store-product-row")).toHaveCount(3);
  const productRows = produceSection.getByTestId("store-product-row");
  const verticalRows = await productRows.evaluateAll((rows) => rows.map((row) => {
    const rect = row.getBoundingClientRect();
    return { bottom: rect.bottom, top: rect.top };
  }));
  expect(verticalRows[1].top).toBeGreaterThanOrEqual(verticalRows[0].bottom);
  expect(verticalRows[2].top).toBeGreaterThanOrEqual(verticalRows[1].bottom);
  await expect(produceSection.getByRole("link", { name: "View on Weee" })).toHaveCount(3);

  if (testInfo.project.name === "desktop") {
    await expect(page).toHaveScreenshot("shopping-smart.png", {
      animations: "disabled",
      fullPage: true,
    });
  }
});

test("loads batch cache hits before one serial miss and permits retry after a failed miss", async ({ page }) => {
  const fourItems = [
    { name: "Rice", total_quantity: "1 bag" },
    { name: "Beans", total_quantity: "1 can" },
    { name: "Milk", total_quantity: "1 carton" },
    { name: "Eggs", total_quantity: "1 dozen" },
  ];
  const fourRefined = {
    remove: [],
    likely_pantry: [],
    purchase_items: [
      { name: "Rice", suggested_purchase: "1 bag", category: "Pantry & Dry Goods" },
      { name: "Beans", suggested_purchase: "1 can", category: "Pantry & Dry Goods" },
      { name: "Milk", suggested_purchase: "1 carton", category: "Dairy" },
      { name: "Eggs", suggested_purchase: "1 dozen", category: "Dairy" },
    ],
  };
  let batchRequests = 0;
  const getQueries: string[] = [];
  let releaseMilk!: () => void;
  const milkPending = new Promise<void>((resolve) => { releaseMilk = resolve; });
  let eggCalls = 0;

  await page.route("http://localhost:8000/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === "/shopping-list" || url.pathname === "/meal-plan") {
      await fulfillJson(route, url.pathname === "/shopping-list" ? fourItems : mealPlans);
      return;
    }
    if (url.pathname === "/shopping-list/refine" && request.method() === "POST") {
      await fulfillJson(route, fourRefined);
      return;
    }
    if (url.pathname === "/store-products/batch") {
      batchRequests += 1;
      expect(await request.postDataJSON()).toEqual({ queries: ["Rice", "Beans", "Milk", "Eggs"] });
      await fulfillJson(route, {
        entries: [
          { query: "Rice", status: "fresh", products: [{ name: "Cached rice", price: "$1", image: "", url: "https://www.sayweee.com/product/cached-rice" }], expires_at: "2030-01-01T00:00:00.000Z" },
          { query: "Beans", status: "fresh", products: [{ name: "Cached beans", price: "$2", image: "", url: "https://www.sayweee.com/product/cached-beans" }], expires_at: "2030-01-01T00:00:00.000Z" },
          { query: "Milk", status: "missing", products: [], expires_at: null },
          { query: "Eggs", status: "missing", products: [], expires_at: null },
        ],
      });
      return;
    }
    if (url.pathname === "/store-products") {
      const query = url.searchParams.get("query");
      if (query) getQueries.push(query);
      if (query === "Milk") {
        await milkPending;
        await fulfillJson(route, {
          products: [{ name: "Fresh milk", price: "$3", image: "", url: "https://www.sayweee.com/product/fresh-milk" }],
          expires_at: "2030-01-01T00:00:00.000Z",
        });
        return;
      }
      if (query === "Eggs") {
        eggCalls += 1;
        if (eggCalls === 1) {
          await route.fulfill({ status: 503, headers: corsHeaders(), body: "busy" });
          return;
        }
        await fulfillJson(route, {
          products: [{ name: "Recovered eggs", price: "$4", image: "", url: "https://www.sayweee.com/product/recovered-eggs" }],
          expires_at: "2030-01-01T00:00:00.000Z",
        });
        return;
      }
    }
    await route.continue();
  });

  await page.getByRole("button", { name: "Prepare smart shopping list" }).click();
  await page.getByRole("button", { name: /Load top picks from Weee/ }).click();
  await expect(page.getByText("Cached rice")).toBeVisible();
  await expect(page.getByText("Cached beans")).toBeVisible();
  expect(batchRequests).toBe(1);
  await expect.poll(() => getQueries).toEqual(["Milk"]);

  releaseMilk();
  await expect.poll(() => getQueries).toEqual(["Milk", "Eggs"]);
  await expect(page.getByText("Could not load products from Weee.")).toBeVisible();
  await page.getByRole("button", { name: "Retry" }).click();
  await expect(page.getByText("Recovered eggs")).toBeVisible();
  expect(eggCalls).toBe(2);
});

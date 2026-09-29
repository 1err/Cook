import { API_BASE } from "./api";
import { expect, test, type Page, type Route } from "@playwright/test";

const appOrigin = `http://127.0.0.1:${process.env.PORT ?? "3000"}`;

const shoppingItems = [
  { name: "Jasmine rice", total_quantity: "2 cups" },
  { name: "Kale", total_quantity: "1 bunch" },
  { name: "Whole milk", total_quantity: "1 quart" },
];

function recipeThumbnail(color: string) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480"><rect width="640" height="480" fill="${color}"/><circle cx="320" cy="240" r="132" fill="#f3dfbd"/></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

const mealPlans = [
  { date: "2026-08-10", breakfast: ["recipe-1"], lunch: ["recipe-2"], dinner: ["recipe-3"] },
  { date: "2026-08-11", breakfast: ["recipe-1"], lunch: [], dinner: ["recipe-3"] },
  { date: "2026-08-12", breakfast: [], lunch: ["recipe-4"], dinner: ["recipe-5"] },
  { date: "2026-08-13", breakfast: [], lunch: [], dinner: ["recipe-6"] },
  { date: "2026-08-14", breakfast: [], lunch: ["recipe-2"], dinner: [] },
  { date: "2026-08-15", breakfast: [], lunch: [], dinner: ["recipe-7"] },
  { date: "2026-08-16", breakfast: [], lunch: ["recipe-1"], dinner: [] },
];

const recipes = [
  ["recipe-1", "Ginger rice bowl", "#bd7658"],
  ["recipe-2", "Lemon herb chicken", "#71866b"],
  ["recipe-3", "Creamy tomato pasta", "#b85f45"],
  ["recipe-4", "Black bean tacos", "#6f624c"],
  ["recipe-5", "Beef and broccoli stir-fry", "#637b52"],
  ["recipe-6", "Roasted tomato soup", "#aa533c"],
  ["recipe-7", "Simple green salad", "#78946b"],
].map(([id, title, color]) => ({
    id,
    title,
    source_url: null,
    thumbnail_url: recipeThumbnail(color),
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
  }));

const refinedList = {
  remove: [],
  likely_pantry: [],
  purchase_items: [
    { name: "Jasmine rice", suggested_purchase: "2 cups", category: "Pantry & Dry Goods" },
    { name: "Kale", suggested_purchase: "1 bunch", category: "Produce" },
    { name: "Whole milk", suggested_purchase: "1 quart", category: "Dairy" },
  ],
};

const storeProductsByQuery = {
  "Jasmine rice": [
    { name: "Jasmine rice bag", price: "$5.00", image: "", url: "https://www.sayweee.com/product/rice-1" },
    { name: "Premium jasmine rice", price: "$6.25", image: "", url: "https://www.sayweee.com/product/rice-2" },
    { name: "Brown jasmine rice", price: "$7.75", image: "", url: "https://www.sayweee.com/product/rice-3" },
  ],
  Kale: [
    { name: "Organic kale bunch", price: "$2.99", image: "", url: "https://www.sayweee.com/product/kale-1" },
    { name: "Baby kale", price: "$3.49", image: "", url: "https://www.sayweee.com/product/kale-2" },
    { name: "Tuscan kale", price: "$4.19", image: "", url: "https://www.sayweee.com/product/kale-3" },
  ],
  "Whole milk": [
    { name: "Whole milk carton", price: "$4.01", image: "", url: "https://www.sayweee.com/product/milk-1" },
    { name: "Organic whole milk", price: "$4.99", image: "", url: "https://www.sayweee.com/product/milk-2" },
    { name: "Grass-fed whole milk", price: "$5.49", image: "", url: "https://www.sayweee.com/product/milk-3" },
  ],
} satisfies Record<string, { name: string; price: string; image: string; url: string }[]>;

const storeProducts = storeProductsByQuery.Kale;

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
  await page.route(`${API_BASE}/**`, async (route) => {
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
    if (pathname.startsWith("/recipes/")) {
      await fulfillJson(route, recipes.find(recipe => recipe.id === pathname.split("/").at(-1)));
      return;
    }
    if (pathname === "/store-products/batch") {
      const payload = await request.postDataJSON() as { queries?: unknown };
      const queries = Array.isArray(payload.queries)
        ? payload.queries.filter((query): query is string => typeof query === "string")
        : [];
      await fulfillJson(route, {
        entries: queries.map((query) => {
          const products = storeProductsByQuery[query as keyof typeof storeProductsByQuery];
          return products
            ? {
                query,
                status: "fresh",
                products,
                expires_at: new Date(Date.now() + 60_000).toISOString(),
              }
            : { query, status: "missing", products: [], expires_at: null };
        }),
      });
      return;
    }
    if (pathname === "/store-products") {
      const query = new URL(request.url()).searchParams.get("query") ?? "";
      const products = storeProductsByQuery[query as keyof typeof storeProductsByQuery] ?? [];
      await fulfillJson(route, {
        products,
        expires_at: products.length ? new Date(Date.now() + 60_000).toISOString() : null,
      });
      return;
    }

    await route.abort();
  });
}

const instacartRequests = new WeakMap<Page, string[]>();

test.beforeEach(async ({ page }) => {
  const requests: string[] = [];
  instacartRequests.set(page, requests);
  page.on("request", (request) => {
    if (/instacart/i.test(request.url())) requests.push(request.url());
  });
  await installShoppingFixtures(page);
  await page.goto("/shopping-list?week=2026-08-10");
});

test.afterEach(async ({ page }) => {
  await expect(page.getByRole("button", { name: /instacart/i })).toHaveCount(0);
  await expect(page.getByRole("link", { name: /instacart/i })).toHaveCount(0);
  await expect(page.getByText(/instacart/i)).toHaveCount(0);
  expect(instacartRequests.get(page)).toEqual([]);
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

test("recovers from refinement admission failure without losing checklist progress", async ({ page }, testInfo) => {
  let refineCalls = 0;
  const pageErrors: string[] = [];
  page.on("pageerror", error => pageErrors.push(error.message));
  await page.route(`${API_BASE}/shopping-list/refine`, async (route) => {
    refineCalls += 1;
    if (refineCalls === 1) {
      await route.fulfill({
        status: 429,
        contentType: "application/json",
        headers: { ...corsHeaders(), "Retry-After": "60" },
        body: JSON.stringify({ detail: "AI usage limit reached." }),
      });
      return;
    }
    await fulfillJson(route, {
      ...refinedList,
      refinement_status: "refined",
      // The checked row moves: progress must follow the ingredient, not its index.
      purchase_items: [...refinedList.purchase_items].reverse(),
    });
  });

  await page.getByRole("button", { name: "Prepare smart shopping list" }).click();
  const fallbackNotice = page.getByText("Smart refinement is temporarily unavailable. You can still shop with your recipe quantities below, or retry refinement.", { exact: true });
  await expect(fallbackNotice).toBeVisible();
  await expect(page.getByRole("checkbox")).toHaveCount(shoppingItems.length);
  for (const item of shoppingItems) {
    const row = page.getByRole("checkbox", { name: `Mark ${item.name} as already have`, exact: true }).locator("xpath=../..");
    await expect(row.getByText(item.total_quantity, { exact: true })).toBeVisible();
  }
  await page.getByRole("checkbox", { name: "Mark Jasmine rice as already have", exact: true }).check();
  await expect(page.getByRole("button", { name: "Load top picks from Weee", exact: true })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Copy list", exact: true })).toBeEnabled();
  if (testInfo.project.name === "phone") {
    await page.setViewportSize({ width: 320, height: 900 });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: testInfo.outputPath("shopping-fallback-phone.png"), fullPage: true });
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  await page.reload();
  await expect(fallbackNotice).toBeVisible();
  await expect(page.getByRole("checkbox", { name: "Mark Jasmine rice as still need to buy", exact: true })).toBeChecked();
  expect(refineCalls).toBe(1);
  await page.getByRole("button", { name: "Retry refinement", exact: true }).click();
  await expect(page.getByText("Smart mode", { exact: true })).toBeVisible();
  await expect(fallbackNotice).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Retry refinement", exact: true })).toHaveCount(0);
  await expect(page.getByRole("checkbox", { name: "Mark Jasmine rice as still need to buy", exact: true })).toBeChecked();
  await expect(page.getByRole("checkbox", { name: "Mark Whole milk as already have", exact: true })).not.toBeChecked();
  expect(refineCalls).toBe(2);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  await page.reload();
  await expect(page.getByText("Smart mode", { exact: true })).toBeVisible();
  await expect(page.getByRole("checkbox", { name: "Mark Jasmine rice as still need to buy", exact: true })).toBeChecked();
  expect(refineCalls).toBe(2);
  expect(pageErrors).toEqual([]);
});

test("keeps provider fallback retryable when refinement returns a successful response", async ({ page }) => {
  await page.route(`${API_BASE}/shopping-list/refine`, (route) => fulfillJson(route, {
    ...refinedList,
    refinement_status: "fallback",
  }));
  await page.getByRole("button", { name: "Prepare smart shopping list" }).click();
  await expect(page.getByText("Grocery checklist", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Retry refinement", exact: true })).toBeEnabled();
  await expect(page.getByRole("checkbox")).toHaveCount(shoppingItems.length);
  await page.reload();
  await expect(page.getByText("Grocery checklist", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Retry refinement", exact: true })).toBeEnabled();
});

test("keeps preparation in context and renders smart groceries without horizontal overflow", async ({ page }, testInfo) => {
  await expect(page.getByRole("heading", { name: "Shopping List" })).toBeVisible();
  const preparePanel = page.getByRole("region", { name: "Prepare smart shopping list" });
  await expect(preparePanel.getByRole("heading", { name: "Planned meals" })).toBeVisible();
  await expect(preparePanel.getByRole("heading", { name: "Prepare smart list" })).toBeVisible();
  await expect(page.getByRole("checkbox")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Grocery checklist" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Copy list" })).toHaveCount(0);
  await expect(page.getByText("Organize ingredients by what to buy, then choose products when you are ready.")).toHaveCount(0);
  await expect(preparePanel.getByText("Ginger rice bowl", { exact: true })).toHaveCount(1);
  await expect(preparePanel.getByText("7 recipes · 11 meals", { exact: true })).toBeVisible();
  await expect(preparePanel.getByText("3 meals · Mon breakfast · +2 more", { exact: true })).toBeVisible();
  await expect(preparePanel.getByRole("link")).toHaveCount(4);
  await preparePanel.getByRole("button", { name: "+ 3 more" }).click();
  await expect(preparePanel.getByRole("link")).toHaveCount(7);

  const plannedPanel = preparePanel.getByRole("heading", { name: "Planned meals" }).locator("xpath=../..");
  const prepareAction = preparePanel.getByRole("heading", { name: "Prepare smart list" }).locator("..");
  const preparationLayout = await Promise.all([
    plannedPanel.boundingBox(),
    prepareAction.boundingBox(),
  ]);
  expect(preparationLayout[0]).not.toBeNull();
  expect(preparationLayout[1]).not.toBeNull();
  if (testInfo.project.name === "desktop") {
    expect(preparationLayout[0]!.x).toBeLessThan(preparationLayout[1]!.x);
    expect(preparationLayout[0]!.width).toBeGreaterThan(preparationLayout[1]!.width);
  } else {
    expect(preparationLayout[0]!.y).toBeLessThan(preparationLayout[1]!.y);
  }

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
  if (testInfo.project.name === "desktop") {
    expect(shellMetrics.shellWidth).toBeGreaterThanOrEqual(1000);
  }
  expect(Math.abs(shellMetrics.leftGutter - shellMetrics.rightGutter)).toBeLessThanOrEqual(1);
  expect(shellMetrics.documentWidth).toBeLessThanOrEqual(shellMetrics.viewportWidth);

  await page.route(`${API_BASE}/shopping-list/refine`, (route) => fulfillJson(route, {
    ...refinedList,
    purchase_items: [
      refinedList.purchase_items[0],
      { name: "Soy sauce", suggested_purchase: "1 bottle", category: "Pantry & Dry Goods" },
      ...refinedList.purchase_items.slice(1),
    ],
  }));
  await preparePanel.getByRole("button", { name: "Prepare smart shopping list" }).click();
  await expect(page.getByText("Smart mode", { exact: true })).toBeVisible();
  await expect(page.getByRole("checkbox")).toHaveCount(4);
  await expect(page.getByRole("heading", { name: "Planned meals" })).toHaveCount(0);
  await expect(page.getByText("Ginger rice bowl", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Produce" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Pantry & Dry Goods" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Dairy" })).toBeVisible();
  await expect(page.locator("[data-category-icon]")).toHaveCount(0);

  const pantrySection = page.getByRole("heading", { name: "Pantry & Dry Goods" }).locator("..").locator("..");
  const smartLayout = await pantrySection.evaluate((section) => {
    const items = section.lastElementChild as HTMLElement;
    const categoryGrid = section.parentElement!;
    const workspace = categoryGrid.parentElement!.parentElement!;
    const header = section.firstElementChild as HTMLElement;
    const itemRects = Array.from(items.children).map((item) => {
      const rect = item.getBoundingClientRect();
      return { left: rect.left, top: rect.top };
    });
    return {
      categoryWidth: categoryGrid.getBoundingClientRect().width,
      headerWidth: header.getBoundingClientRect().width,
      itemColumns: getComputedStyle(items).gridTemplateColumns.split(" ").length,
      itemRects,
      workspaceWidth: workspace.getBoundingClientRect().width,
    };
  });
  expect(smartLayout.categoryWidth).toBeGreaterThan(smartLayout.workspaceWidth * 0.99);
  expect(smartLayout.headerWidth).toBeGreaterThan(smartLayout.categoryWidth * 0.99);
  const expectedIngredientColumns = testInfo.project.name === "phone" ? 1 : 2;
  expect(smartLayout.itemColumns).toBe(expectedIngredientColumns);
  expect(smartLayout.itemRects).toHaveLength(2);
  if (expectedIngredientColumns === 2) {
    expect(Math.abs(smartLayout.itemRects[0].top - smartLayout.itemRects[1].top)).toBeLessThanOrEqual(1);
    expect(smartLayout.itemRects[1].left).toBeGreaterThan(smartLayout.itemRects[0].left);
  } else {
    expect(smartLayout.itemRects[1].top).toBeGreaterThan(smartLayout.itemRects[0].top);
  }

  const categoryLayout = await page.getByRole("heading", { name: "Produce" }).locator("..").locator("..").evaluate((section) => ({
    width: section.getBoundingClientRect().width,
    pageHasOverflow: document.documentElement.scrollWidth > window.innerWidth,
  }));
  expect(categoryLayout.pageHasOverflow).toBe(false);
  expect(categoryLayout.width).toBeGreaterThan(testInfo.project.name === "phone" ? 300 : 320);

  const produceSection = page.getByRole("heading", { name: "Produce" }).locator("..").locator("..");
  await produceSection.getByRole("button", { name: "View products" }).click();
  await expect(produceSection.getByTestId("store-product-row")).toHaveCount(3);
  const expandedLayout = await produceSection.evaluate((section) => ({
    categoryDisplay: getComputedStyle(section.parentElement!).display,
    categoryColumns: getComputedStyle(section.parentElement!).gridTemplateColumns.split(" ").length,
    gridWidth: section.parentElement?.getBoundingClientRect().width ?? 0,
    sectionWidth: section.getBoundingClientRect().width,
    productColumns: getComputedStyle(section.querySelector<HTMLElement>("[role='radiogroup']")!).gridTemplateColumns.split(" ").length,
  }));
  expect(expandedLayout.categoryDisplay).toBe("grid");
  expect(expandedLayout.categoryColumns).toBe(1);
  expect(expandedLayout.sectionWidth).toBeGreaterThan(expandedLayout.gridWidth * 0.99);
  const expectedProductColumns = testInfo.project.name === "desktop" ? 3 : testInfo.project.name === "tablet" ? 2 : 1;
  expect(expandedLayout.productColumns).toBe(expectedProductColumns);
  const productRows = produceSection.getByTestId("store-product-row");
  const productRects = await productRows.evaluateAll((rows) => rows.map((row) => {
    const rect = row.getBoundingClientRect();
    return { bottom: rect.bottom, left: rect.left, top: rect.top };
  }));
  if (expectedProductColumns === 1) {
    expect(productRects[1].top).toBeGreaterThanOrEqual(productRects[0].bottom);
    expect(productRects[2].top).toBeGreaterThanOrEqual(productRects[1].bottom);
  } else {
    expect(Math.abs(productRects[1].top - productRects[0].top)).toBeLessThanOrEqual(1);
    expect(productRects[1].left).toBeGreaterThan(productRects[0].left);
    if (expectedProductColumns === 3) {
      expect(Math.abs(productRects[2].top - productRects[0].top)).toBeLessThanOrEqual(1);
      expect(productRects[2].left).toBeGreaterThan(productRects[1].left);
    } else {
      expect(productRects[2].top).toBeGreaterThanOrEqual(Math.max(productRects[0].bottom, productRects[1].bottom));
    }
  }
  await expect(produceSection.getByRole("link", { name: "View on Weee" })).toHaveCount(3);
  if (testInfo.project.name === "desktop" && process.platform === "darwin") {
    await expect(page).toHaveScreenshot("shopping-smart.png", {
      animations: "disabled",
      fullPage: true,
    });
  }
  await page.getByRole("button", { name: "Back to original list" }).click();
  await expect(page.getByRole("button", { name: "Prepare smart shopping list" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Planned meals" })).toBeVisible();
  await expect(page.getByRole("checkbox")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Copy list" })).toHaveCount(0);
});

test("keeps long Chinese ingredient quantities readable and product controls separate", async ({ page }, testInfo) => {
  const longQuantity = "1/2 茶匙（少于 4 克）；另加少许，按口味调整。12 个 + 3 克，4 teaspoons + a few extra to taste.";
  await page.route(`${API_BASE}/**`, async (route) => {
    const { pathname } = new URL(route.request().url());
    if (pathname === "/shopping-list/refine") {
      await fulfillJson(route, {
        remove: [],
        likely_pantry: [],
        purchase_items: [
          { name: "五香粉", suggested_purchase: longQuantity, category: "Pantry & Dry Goods" },
          { name: "泰国罗勒（九层塔）", suggested_purchase: "适量", category: "Pantry & Dry Goods" },
          { name: "大料", suggested_purchase: "12 个 + 3 克", category: "Pantry & Dry Goods" },
        ],
      });
      return;
    }
    if (pathname === "/store-products") {
      await fulfillJson(route, { products: storeProducts, expires_at: new Date(Date.now() + 60_000).toISOString() });
      return;
    }
    await route.fallback();
  });

  await page.getByRole("button", { name: "Prepare smart shopping list" }).click();
  const ingredient = page.getByRole("checkbox", { name: /五香粉/ }).locator("xpath=../..");
  await expect(ingredient.getByText(longQuantity, { exact: true })).toBeVisible();
  const assertReadableLayout = async () => {
    const layout = await ingredient.evaluate((row) => {
      const label = row.querySelector("label")!;
      const name = row.querySelector("strong")!;
      const amount = row.querySelector("small")!;
      const products = row.querySelector("button")!;
      const nameRect = name.getBoundingClientRect();
      const amountRect = amount.getBoundingClientRect();
      const labelRect = label.getBoundingClientRect();
      const productsRect = products.getBoundingClientRect();
      const range = document.createRange();
      range.selectNodeContents(amount);
      return {
        amountBelowName: amountRect.top >= nameRect.bottom - 1,
        amountFitsLabel: Array.from(range.getClientRects()).every((rect) => rect.left >= labelRect.left - 1 && rect.right <= labelRect.right + 1),
        controlsSeparate: labelRect.right <= productsRect.left + 1 || labelRect.bottom <= productsRect.top + 1,
        nameWidth: nameRect.width,
        pageFits: document.documentElement.scrollWidth <= window.innerWidth,
        rowFits: row.scrollWidth <= row.clientWidth + 1,
      };
    });
    expect(layout.amountBelowName).toBe(true);
    expect(layout.amountFitsLabel).toBe(true);
    expect(layout.controlsSeparate).toBe(true);
    expect(layout.nameWidth).toBeGreaterThan(60);
    expect(layout.pageFits).toBe(true);
    expect(layout.rowFits).toBe(true);
  };
  await assertReadableLayout();
  if (testInfo.project.name === "phone") {
    await page.setViewportSize({ width: 320, height: 900 });
    await assertReadableLayout();
  } else if (testInfo.project.name === "tablet") {
    await page.setViewportSize({ width: 640, height: 900 });
    await assertReadableLayout();
  }

  await ingredient.getByRole("button", { name: "View products" }).click();
  const choices = page.getByRole("radiogroup", { name: "Choose 五香粉 for cart" });
  await expect(choices.getByRole("radio")).toHaveCount(3);
  await choices.getByRole("radio").nth(1).check();
  await expect(choices.getByRole("radio").nth(1)).toBeChecked();
  await ingredient.getByRole("button", { name: "Hide products" }).click();
  await ingredient.getByRole("checkbox").check();
  await expect(ingredient.getByRole("checkbox")).toBeChecked();
  await ingredient.getByRole("checkbox").uncheck();
  await ingredient.getByRole("button", { name: /More.*五香粉/ }).click();
  await page.getByRole("button", { name: "Remove from list" }).click();
  await expect(page.getByRole("checkbox", { name: /五香粉/ })).toHaveCount(0);
});

test("reviews editable top picks and records only explicit user-confirmed Weee progress", async ({ page }, testInfo) => {
  await expect(page.getByRole("button", { name: /Review Weee cart/ })).toHaveCount(0);

  await page.getByRole("button", { name: "Prepare smart shopping list" }).click();
  await expect(page.getByRole("button", { name: /Review Weee cart/ })).toHaveCount(0);
  await page.getByRole("button", { name: "Load top picks from Weee" }).click();

  await expect(page.getByText("Jasmine rice bag", { exact: true })).toBeVisible();
  await expect(page.getByText("Organic kale bunch", { exact: true })).toBeVisible();
  await expect(page.getByText("Whole milk carton", { exact: true })).toBeVisible();
  const reviewTrigger = page.getByRole("button", { name: "Review Weee cart (3)" });
  await expect(reviewTrigger).toBeVisible();

  const riceChoices = page.getByRole("radiogroup", { name: "Choose Jasmine rice for cart" });
  const kaleChoices = page.getByRole("radiogroup", { name: "Choose Kale for cart" });
  const milkChoices = page.getByRole("radiogroup", { name: "Choose Whole milk for cart" });
  await expect(riceChoices.getByRole("radio", { name: "Jasmine rice bag: Selected for cart" })).toBeChecked();
  await expect(kaleChoices.getByRole("radio", { name: "Organic kale bunch: Selected for cart" })).toBeChecked();
  await expect(milkChoices.getByRole("radio", { name: "Whole milk carton: Selected for cart" })).toBeChecked();
  await expect(page.getByText("Top pick", { exact: true })).toHaveCount(3);

  await kaleChoices.getByRole("radio", { name: "Choose Tuscan kale for cart" }).check();
  await expect(kaleChoices.getByRole("radio", { name: "Tuscan kale: Selected for cart" })).toBeChecked();
  if (testInfo.project.name === "desktop") {
    await kaleChoices.evaluate((group) => group.scrollIntoView({ block: "center" }));
    await expect(kaleChoices).toHaveScreenshot("shopping-three-choices.png", { animations: "disabled" });
  }
  await kaleChoices.getByRole("radio", { name: "Choose Baby kale for cart" }).check();
  await expect(kaleChoices.getByRole("radio", { name: "Baby kale: Selected for cart" })).toBeChecked();

  await reviewTrigger.click();
  const dialog = page.getByRole("dialog", { name: "Review Weee cart" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("heading", { name: "Review Weee cart" })).toBeVisible();
  await expect(dialog.getByText("Estimated subtotal: $12.50")).toBeVisible();
  await expect(dialog.getByText(/Baby kale · \$3\.49/)).toBeVisible();
  await expect(dialog.getByText("0 marked as added")).toBeVisible();
  await expect(dialog.getByText(/Chef World has not changed your Weee cart/)).toBeVisible();

  const layout = await dialog.evaluate((element) => ({
    dialogOverflow: element.scrollWidth > element.clientWidth,
    pageOverflow: document.documentElement.scrollWidth > window.innerWidth,
  }));
  expect(layout).toEqual({ dialogOverflow: false, pageOverflow: false });

  await page.evaluate(() => {
    const target = window as typeof window & { __cartCompanionOpenedUrls?: string[] };
    target.__cartCompanionOpenedUrls = [];
    Object.defineProperty(window, "open", {
      configurable: true,
      value: (url?: string | URL) => {
        target.__cartCompanionOpenedUrls?.push(String(url));
        return null;
      },
    });
  });

  // Follow the same Produce / Pantry / Dairy order as the visible shopping list.
  await expect(dialog.getByRole("listitem").locator("strong")).toHaveText(["Kale", "Jasmine rice", "Whole milk"]);
  await dialog.getByRole("button", { name: "Open next on Weee" }).click();
  expect(await page.evaluate(() => (
    window as typeof window & { __cartCompanionOpenedUrls?: string[] }
  ).__cartCompanionOpenedUrls)).toEqual(["https://www.sayweee.com/product/kale-2"]);
  await expect(dialog.getByRole("heading", { name: "Next: Kale" })).toBeVisible();
  await expect(dialog.getByText("0 marked as added")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Open again" })).toBeVisible();

  await dialog.getByRole("button", { name: "I added it" }).click();
  await expect(dialog.getByText("1 marked as added")).toBeVisible();
  await expect(dialog.getByRole("heading", { name: "Next: Jasmine rice" })).toBeVisible();
  await dialog.getByRole("button", { name: "Close Weee cart review" }).click();

  await page.reload();
  const reloadedReviewTrigger = page.getByRole("button", { name: "Review Weee cart (3)" });
  await expect(reloadedReviewTrigger).toBeVisible();
  await reloadedReviewTrigger.click();
  const reloadedDialog = page.getByRole("dialog", { name: "Review Weee cart" });
  await expect(reloadedDialog.getByText("1 marked as added")).toBeVisible();
  await expect(reloadedDialog.getByRole("heading", { name: "Next: Jasmine rice" })).toBeVisible();

  await reloadedDialog.getByRole("button", { name: "Skip for now" }).click();
  await expect(reloadedDialog.getByRole("heading", { name: "Next: Whole milk" })).toBeVisible();
  await reloadedDialog.getByRole("button", { name: "Skip for now" }).click();
  await expect(reloadedDialog.getByRole("heading", { name: "Review pass complete" })).toBeVisible();
  await expect(reloadedDialog.getByRole("heading", { name: "Handoff complete" })).toHaveCount(0);
  await reloadedDialog.getByRole("button", { name: "Close Weee cart review" }).click();
  await reloadedReviewTrigger.click();
  await expect(reloadedDialog.getByRole("heading", { name: "Next: Jasmine rice" })).toBeVisible();

  await reloadedDialog.getByRole("button", { name: "Undo Kale" }).click();
  await expect(reloadedDialog.getByText("0 marked as added")).toBeVisible();
  await expect(reloadedDialog.getByRole("heading", { name: "Next: Kale" })).toBeVisible();
  await reloadedDialog.getByRole("button", { name: "I added it" }).click();
  await reloadedDialog.getByRole("button", { name: "I added it" }).click();
  await reloadedDialog.getByRole("button", { name: "I added it" }).click();
  await expect(reloadedDialog.getByRole("heading", { name: "Handoff complete" })).toBeVisible();
  await expect(reloadedDialog.getByRole("link", { name: "Open Weee for final review" })).toHaveAttribute(
    "href",
    "https://www.sayweee.com/",
  );
});

test("keeps live matches pending and treats unsafe or empty settled results as unmatched", async ({ page }) => {
  let releaseUnsafeKale!: () => void;
  const unsafeKalePending = new Promise<void>((resolve) => { releaseUnsafeKale = resolve; });

  await page.route(`${API_BASE}/**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === "/store-products/batch") {
      const payload = await request.postDataJSON() as { queries: string[] };
      await fulfillJson(route, {
        entries: payload.queries.map((query) => query === "Jasmine rice"
          ? {
              query,
              status: "fresh",
              products: storeProductsByQuery["Jasmine rice"],
              expires_at: new Date(Date.now() + 60_000).toISOString(),
            }
          : { query, status: "missing", products: [], expires_at: null }),
      });
      return;
    }
    if (url.pathname === "/store-products" && url.searchParams.get("query") === "Kale") {
      await unsafeKalePending;
      await fulfillJson(route, {
        products: [{
          name: "Imposter kale",
          price: "$0.01",
          image: "",
          url: "https://sayweee.com.evil.test/product/kale",
        }],
        expires_at: new Date(Date.now() + 60_000).toISOString(),
      });
      return;
    }
    if (url.pathname === "/store-products" && url.searchParams.get("query") === "Whole milk") {
      await fulfillJson(route, { products: [], expires_at: null });
      return;
    }
    await route.fallback();
  });

  await page.getByRole("button", { name: "Prepare smart shopping list" }).click();
  await page.getByRole("button", { name: "Load top picks from Weee" }).click();
  await expect(page.getByText("Jasmine rice bag", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Review Weee cart (1)" }).click();
  const dialog = page.getByRole("dialog", { name: "Review Weee cart" });
  await expect(dialog.getByText("1 ready")).toBeVisible();
  await expect(dialog.getByText("0 unmatched")).toBeVisible();
  await expect(dialog.getByText("2 finding matches")).toBeVisible();
  await dialog.getByRole("button", { name: "I added it" }).click();
  await expect(dialog.getByRole("heading", { name: "Finding matches" })).toBeVisible();
  await expect(dialog.getByRole("heading", { name: "Handoff complete" })).toHaveCount(0);
  await expect(dialog.getByRole("link", { name: "Open Weee for final review" })).toHaveCount(0);

  releaseUnsafeKale();
  await expect(dialog.getByText("2 unmatched")).toBeVisible();
  await expect(dialog.getByText(/finding matches/)).toHaveCount(0);
  await expect(dialog.getByText("Imposter kale")).toHaveCount(0);
  await expect(dialog.getByRole("heading", { name: "Needs a match" })).toBeVisible();
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

  await page.route(`${API_BASE}/**`, async (route) => {
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
          { query: "Rice", status: "fresh", products: [{ name: "Cached rice", price: "$1", image: "", url: "https://www.sayweee.com/product/cached-rice" }], expires_at: new Date(Date.now() + 60_000).toISOString() },
          { query: "Beans", status: "fresh", products: [{ name: "Cached beans", price: "$2", image: "", url: "https://www.sayweee.com/product/cached-beans" }], expires_at: new Date(Date.now() + 60_000).toISOString() },
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
          expires_at: new Date(Date.now() + 60_000).toISOString(),
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
          expires_at: new Date(Date.now() + 60_000).toISOString(),
        });
        return;
      }
    }
    await route.fallback();
  });

  await page.getByRole("button", { name: "Prepare smart shopping list" }).click();
  await page.getByRole("button", { name: /Load top picks from Weee/ }).click();
  await expect(page.getByText("Cached rice", { exact: true })).toBeVisible();
  await expect(page.getByText("Cached beans", { exact: true })).toBeVisible();
  expect(batchRequests).toBe(1);
  await expect.poll(() => getQueries).toEqual(["Milk"]);

  releaseMilk();
  await expect.poll(() => getQueries).toEqual(["Milk", "Eggs"]);
  await expect(page.getByText("Could not load products from Weee.")).toBeVisible();
  await page.getByRole("button", { name: "Retry" }).click();
  await expect(page.getByText("Recovered eggs", { exact: true })).toBeVisible();
  expect(eggCalls).toBe(2);
});

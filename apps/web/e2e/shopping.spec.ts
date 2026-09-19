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
  const expandedLayout = await produceSection.evaluate((section) => ({
    columnCount: getComputedStyle(section.parentElement!).columnCount,
    gridWidth: section.parentElement?.getBoundingClientRect().width ?? 0,
    sectionWidth: section.getBoundingClientRect().width,
  }));
  if (testInfo.project.name !== "desktop") {
    expect(expandedLayout.columnCount).toBe("1");
    expect(expandedLayout.sectionWidth).toBeGreaterThan(expandedLayout.gridWidth * 0.9);
  } else {
    expect(expandedLayout.columnCount).toBe("2");
    expect(expandedLayout.sectionWidth).toBeLessThan(expandedLayout.gridWidth * 0.7);
  }
  const productRows = produceSection.getByTestId("store-product-row");
  const verticalRows = await productRows.evaluateAll((rows) => rows.map((row) => {
    const rect = row.getBoundingClientRect();
    return { bottom: rect.bottom, top: rect.top };
  }));
  expect(verticalRows[1].top).toBeGreaterThanOrEqual(verticalRows[0].bottom);
  expect(verticalRows[2].top).toBeGreaterThanOrEqual(verticalRows[1].bottom);
  await expect(produceSection.getByRole("link", { name: "View on Weee" })).toHaveCount(3);

  if (testInfo.project.name === "desktop" && process.platform === "darwin") {
    await expect(page).toHaveScreenshot("shopping-smart.png", {
      animations: "disabled",
      fullPage: true,
    });
  }
});

test("reviews editable top picks and records only explicit user-confirmed Weee progress", async ({ page }) => {
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

  await dialog.getByRole("button", { name: "Open next on Weee" }).click();
  expect(await page.evaluate(() => (
    window as typeof window & { __cartCompanionOpenedUrls?: string[] }
  ).__cartCompanionOpenedUrls)).toEqual(["https://www.sayweee.com/product/rice-1"]);
  await expect(dialog.getByRole("heading", { name: "Next: Jasmine rice" })).toBeVisible();
  await expect(dialog.getByText("0 marked as added")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Open again" })).toBeVisible();

  await dialog.getByRole("button", { name: "I added it" }).click();
  await expect(dialog.getByText("1 marked as added")).toBeVisible();
  await expect(dialog.getByRole("heading", { name: "Next: Kale" })).toBeVisible();
  await dialog.getByRole("button", { name: "Close Weee cart review" }).click();

  await page.reload();
  const reloadedReviewTrigger = page.getByRole("button", { name: "Review Weee cart (3)" });
  await expect(reloadedReviewTrigger).toBeVisible();
  await reloadedReviewTrigger.click();
  const reloadedDialog = page.getByRole("dialog", { name: "Review Weee cart" });
  await expect(reloadedDialog.getByText("1 marked as added")).toBeVisible();
  await expect(reloadedDialog.getByRole("heading", { name: "Next: Kale" })).toBeVisible();

  await reloadedDialog.getByRole("button", { name: "Skip for now" }).click();
  await expect(reloadedDialog.getByRole("heading", { name: "Next: Whole milk" })).toBeVisible();
  await reloadedDialog.getByRole("button", { name: "Skip for now" }).click();
  await expect(reloadedDialog.getByRole("heading", { name: "Review pass complete" })).toBeVisible();
  await expect(reloadedDialog.getByRole("heading", { name: "Handoff complete" })).toHaveCount(0);
  await reloadedDialog.getByRole("button", { name: "Close Weee cart review" }).click();
  await reloadedReviewTrigger.click();
  await expect(reloadedDialog.getByRole("heading", { name: "Next: Kale" })).toBeVisible();

  await reloadedDialog.getByRole("button", { name: "Undo Jasmine rice" }).click();
  await expect(reloadedDialog.getByText("0 marked as added")).toBeVisible();
  await expect(reloadedDialog.getByRole("heading", { name: "Next: Jasmine rice" })).toBeVisible();
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

  await page.route("http://localhost:8000/**", async (route) => {
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

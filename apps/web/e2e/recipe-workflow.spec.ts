import { expect, test, type Page, type Route } from "@playwright/test";

const appOrigin = `http://127.0.0.1:${process.env.PORT ?? "3000"}`;

const recipe = {
  id: "recipe-detail",
  title: "韭菜盒子 with a naturally balanced recipe title",
  thumbnail_url:
    "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='900' height='650'%3E%3Crect width='900' height='650' fill='%23c9a276'/%3E%3C/svg%3E",
  ingredients: [
    { name: "Flour", quantity: "240 g", metric_quantity: "240 g" },
    { name: "Salt", quantity: "1/2 tsp", metric_quantity: "3 g" },
  ],
  library_tags: ["healthy", "main_dish", "comfort_food"],
  description: "Crisp, savory pockets with a tender homemade wrapper.",
  total_time_minutes: 55,
  steps: [{ text: "Mix the dough and rest it.", duration_seconds: 900, image_url: null }],
  tips: ["Seal every edge firmly."],
  equipment: ["Skillet"],
  source_url: "https://example.com/recipe",
  is_public_catalog: false,
  catalog_source_recipe_id: null,
};

async function fulfillJson(route: Route, body: unknown) {
  await route.fulfill({
    status: 200,
    contentType: "application/json",
    headers: {
      "Access-Control-Allow-Origin": appOrigin,
      "Access-Control-Allow-Credentials": "true",
    },
    body: JSON.stringify(body),
  });
}

async function installFixtures(page: Page) {
  await page.route("http://localhost:8000/**", async (route) => {
    const request = route.request();
    const { pathname } = new URL(request.url());
    if (pathname === "/auth/me") {
      await fulfillJson(route, {
        id: "00000000-0000-0000-0000-000000000001",
        email: "recipe@example.com",
        is_library_public: false,
      });
      return;
    }
    if (pathname === `/recipes/${recipe.id}` && request.method() === "GET") {
      await fulfillJson(route, recipe);
      return;
    }
    if (pathname === `/recipes/${recipe.id}` && request.method() === "PATCH") {
      await fulfillJson(route, { ...recipe, ...(request.postDataJSON() as object) });
      return;
    }
    if (pathname === "/recipes/catalog/editor-status") {
      await fulfillJson(route, { can_manage: true });
      return;
    }
    await route.abort();
  });
}

test.beforeEach(async ({ page }) => {
  await installFixtures(page);
});

test("keeps the recipe detail hero compact, top-aligned, and responsive", async ({ page }, testInfo) => {
  await page.goto(`/recipe/${recipe.id}`);

  const title = page.getByRole("heading", { level: 1, name: recipe.title });
  const heroHeader = title.locator("xpath=..");
  await expect(title).toBeVisible();

  const layout = await heroHeader.evaluate((header) => {
    const heading = header.querySelector("h1")!;
    return {
      fontSize: Number.parseFloat(getComputedStyle(heading).fontSize),
      justifyContent: getComputedStyle(header).justifyContent,
      viewportOverflow: document.documentElement.scrollWidth - window.innerWidth,
    };
  });

  expect(layout.fontSize).toBeLessThanOrEqual(testInfo.project.name === "desktop" ? 56 : 44);
  expect(layout.justifyContent).toBe("flex-start");
  expect(layout.viewportOverflow).toBeLessThanOrEqual(1);

  if (testInfo.project.name === "desktop") {
    await expect(page).toHaveScreenshot("recipe-detail.png", {
      animations: "disabled",
      fullPage: true,
    });
  }
});

test("presents recipe editing as one clear, functional workflow", async ({ page }, testInfo) => {
  const saveCapture: { current: Record<string, unknown> | null } = { current: null };
  await page.route(`http://localhost:8000/recipes/${recipe.id}`, async (route) => {
    if (route.request().method() === "PATCH") {
      saveCapture.current = route.request().postDataJSON() as Record<string, unknown>;
      await fulfillJson(route, { ...recipe, ...saveCapture.current });
      return;
    }
    await fulfillJson(route, recipe);
  });

  await page.goto(`/library/${recipe.id}`);

  await expect(page.getByRole("heading", { level: 1, name: "Edit recipe" })).toBeVisible();
  const sectionHeadings = await page.getByRole("heading", { level: 2 }).allTextContents();
  expect(sectionHeadings).toEqual([
    "Basic details",
    "Ingredients",
    "Steps",
    "More details",
    "Sharing & source",
  ]);
  await expect(page.getByText("Update the cover, tags, and ingredients.")).toHaveCount(0);
  await expect(page.locator("details").filter({ hasText: "Tips" })).not.toHaveAttribute("open", "");
  await expect(page.locator("details").filter({ hasText: "Equipment" })).not.toHaveAttribute("open", "");
  await expect(page.locator("details").filter({ hasText: "Tags" })).not.toHaveAttribute("open", "");

  if (testInfo.project.name === "desktop") {
    await expect(page).toHaveScreenshot("recipe-edit.png", {
      animations: "disabled",
      fullPage: true,
    });
  }

  await page.getByLabel("Recipe title").fill("Updated scallion pockets");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page).toHaveURL(/\/library$/);
  expect(saveCapture.current?.title).toBe("Updated scallion pockets");

  if (testInfo.project.name !== "desktop") {
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  }
});

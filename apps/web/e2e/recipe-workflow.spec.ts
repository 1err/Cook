import { API_BASE } from "./api";
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
  steps: [{ id: "9ef9c806-914c-4dfb-a4aa-57d2cdb42a22", text: "Mix the dough and rest it.", duration_seconds: 900, duration_source: "fallback", attention_type: "hands_on", action_type: "other", image_url: null }],
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
  await page.route(`${API_BASE}/**`, async (route) => {
    const request = route.request();
    const { pathname } = new URL(request.url());
    if (pathname === "/analytics/events") {
      await fulfillJson(route, { ok: true });
      return;
    }
    if (pathname === "/recipes/image-generation/access") {
      await fulfillJson(route, { enabled: true, allowed: true, reason: null, daily_limit: 3, remaining: 3, resets_at: "2026-09-29T00:00:00Z" });
      return;
    }
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
    if (pathname === "/cooking-session/active") {
      await fulfillJson(route, null);
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

test("keeps the editorial recipe hero readable and responsive", async ({ page }, testInfo) => {
  await page.goto(`/recipe/${recipe.id}`);

  const title = page.getByRole("heading", { level: 1, name: recipe.title });
  const heroHeader = title.locator("xpath=..");
  await expect(title).toBeVisible();
  await expect(page.getByText("Failed to fetch", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Equipment", exact: true })).toHaveCount(0);
  await expect(page.getByText(recipe.equipment[0], { exact: true })).toHaveCount(0);
  await expect(page.getByText(recipe.steps[0].text, { exact: true })).toBeVisible();

  const layout = await heroHeader.evaluate((header) => {
    const heading = header.querySelector("h1")!;
    return {
      fontSize: Number.parseFloat(getComputedStyle(heading).fontSize),
      justifyContent: getComputedStyle(header).justifyContent,
      viewportOverflow: document.documentElement.scrollWidth - window.innerWidth,
    };
  });

  expect(layout.fontSize).toBeLessThanOrEqual(testInfo.project.name === "desktop" ? 64 : 44);
  expect(layout.justifyContent).toBe("center");
  expect(layout.viewportOverflow).toBeLessThanOrEqual(1);

  if (testInfo.project.name === "desktop") {
    await expect(page).toHaveScreenshot("recipe-detail.png", {
      animations: "disabled",
      fullPage: true,
    });
  }
});

test("presents recipe editing as one clear, functional workflow", async ({ page }, testInfo) => {
  const reactKeyWarnings: string[] = [];
  page.on("console", (message) => {
    if (/unique.*key|same key/.test(message.text())) reactKeyWarnings.push(message.text());
  });
  const saveCapture: { current: Record<string, unknown> | null } = { current: null };
  await page.route(`${API_BASE}/recipes/${recipe.id}`, async (route) => {
    if (route.request().method() === "PATCH") {
      saveCapture.current = route.request().postDataJSON() as Record<string, unknown>;
      await fulfillJson(route, { ...recipe, ...saveCapture.current });
      return;
    }
    await fulfillJson(route, recipe);
  });

  await page.goto(`/library/${recipe.id}`);

  await expect(page.getByRole("heading", { level: 1, name: "Edit recipe" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Generate with AI", exact: true })).toBeEnabled();
  expect(reactKeyWarnings).toEqual([]);
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
  await expect(page.getByText(/^Equipment/)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Add equipment", exact: true })).toHaveCount(0);
  await expect(page.getByPlaceholder("Add a pan or tool", { exact: true })).toHaveCount(0);
  await expect(page.locator("details").filter({ hasText: "Tags" })).not.toHaveAttribute("open", "");

  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await expect(page.getByRole("button", { name: "Save" })).toBeInViewport();
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));

  if (testInfo.project.name === "desktop") {
    await expect(page).toHaveScreenshot("recipe-edit.png", {
      animations: "disabled",
      fullPage: true,
    });
  }

  await page.getByLabel("Recipe title").fill("Updated scallion pockets");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page).toHaveURL(/\/library$/);
  expect(saveCapture.current).not.toHaveProperty("equipment");
  expect(saveCapture.current).toMatchObject({
    title: "Updated scallion pockets",
    thumbnail_url: recipe.thumbnail_url,
    ingredients: recipe.ingredients,
    library_tags: recipe.library_tags,
    description: recipe.description,
    total_time_minutes: recipe.total_time_minutes,
    steps: recipe.steps,
    tips: recipe.tips,
  });

  if (testInfo.project.name !== "desktop") {
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  }
});

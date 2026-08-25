import { expect, test, type Page, type Route } from "@playwright/test";

const appOrigin = `http://127.0.0.1:${process.env.PORT ?? "3000"}`;

const draftRecipe = {
  id: "draft-1",
  title: "Braised tofu",
  source_url: "https://www.youtube.com/watch?v=recipe",
  thumbnail_url: null,
  ingredients: [
    { name: "Firm tofu", quantity: "1 block", metric_quantity: "400 g", notes: "drained" },
    { name: "Soy sauce", quantity: "2 tbsp", metric_quantity: "30 ml", notes: "" },
  ],
  raw_extraction_text: null,
  library_tags: ["weeknight", "high_protein"],
  library_category: "weeknight",
  is_public_catalog: false,
  catalog_source_recipe_id: null,
  description: "A savory weeknight braise.",
  total_time_minutes: 40,
  steps: [
    { text: "Sear the tofu until golden.", duration_seconds: 480, image_url: null },
    { text: "Add the sauce and braise until glossy.", duration_seconds: 720, image_url: null },
  ],
  tips: ["Drain the tofu well."],
  equipment: ["Skillet"],
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

async function installImportFixtures(page: Page) {
  await page.route("http://localhost:8000/**", async (route) => {
    const request = route.request();
    const { pathname } = new URL(request.url());
    if (pathname === "/auth/me") {
      await fulfillJson(route, {
        id: "00000000-0000-0000-0000-000000000001",
        email: "import@example.com",
        is_library_public: false,
      });
      return;
    }
    if (pathname === "/recipes/parse/link" && request.method() === "POST") {
      await fulfillJson(route, draftRecipe);
      return;
    }
    if (pathname === "/recipes" && request.method() === "POST") {
      await fulfillJson(route, { ...draftRecipe, id: "saved-1" });
      return;
    }
    await route.abort();
  });
}

test.beforeEach(async ({ page }) => {
  await installImportFixtures(page);
  await page.goto("/import");
});

test("keeps Source focused, then saves the streamlined Review draft", async ({ page }, testInfo) => {
  await expect(page.getByRole("heading", { name: "Import recipe" })).toBeVisible();
  await expect(page.getByLabel("Title (optional)")).toHaveCount(0);
  await page.getByRole("button", { name: "Optional details" }).click();
  await expect(page.getByLabel("Title (optional)")).toBeVisible();
  await page.getByRole("button", { name: "Optional details" }).click();

  await page.getByLabel("YouTube URL").fill("https://www.youtube.com/watch?v=recipe");
  await page.getByRole("button", { name: "Create draft" }).click();

  await expect(page.getByRole("button", { name: "Back to source" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Review recipe" })).toBeVisible();
  await expect(page.getByLabel("Image URL")).toHaveCount(0);
  await expect(page.getByPlaceholder(/Notes/i)).toHaveCount(0);
  await expect(page.getByText(/Add image/i)).toHaveCount(0);
  await expect(page.getByText(/Errors stay local/i)).toHaveCount(0);
  await expect(page.getByLabel("Ingredient 1 amount")).toHaveValue("1 block");
  await expect(page.getByLabel("Ingredient 1", { exact: true })).toHaveValue("Firm tofu");

  if (testInfo.project.name === "desktop") {
    await expect(page).toHaveScreenshot("import-review.png", {
      animations: "disabled",
      fullPage: true,
    });
  }

  await page.getByRole("button", { name: "Save recipe" }).click();
  await expect(page).toHaveURL(/\/recipe\/saved-1$/);
});

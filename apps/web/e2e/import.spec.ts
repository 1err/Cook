import { API_BASE } from "./api";
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
    {
      id: "66ccce3a-1274-4ea2-a99b-ff092f3761d1",
      text: "Sear the tofu until golden.",
      duration_seconds: 480,
      duration_source: "estimated",
      attention_type: "passive",
      action_type: "simmer",
      image_url: null,
    },
    {
      id: "3f0f7a65-4c82-4d25-a0a5-23e1a3eabf69",
      text: "Add the sauce and braise until glossy.",
      duration_seconds: 720,
      duration_source: "stated",
      attention_type: "hands_on",
      action_type: "sear",
      image_url: null,
    },
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
  let savedRecipe: Record<string, unknown> | null = null;

  await page.route(`${API_BASE}/**`, async (route) => {
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
    if (pathname === "/recipes/import-capabilities") {
      await fulfillJson(route, { video_analysis: false, media_upload: false, max_media_bytes: 0 });
      return;
    }
    if (pathname === "/recipes/import-jobs" && request.method() === "POST") {
      await fulfillJson(route, { id: "import-job", status: "completed", recipe: draftRecipe });
      return;
    }
    if (pathname === "/recipes" && request.method() === "POST") {
      savedRecipe = {
        ...(request.postDataJSON() as Record<string, unknown>),
        id: "saved-1",
      };
      await fulfillJson(route, savedRecipe);
      return;
    }
    if (pathname === "/recipes/saved-1" && request.method() === "GET" && savedRecipe) {
      await fulfillJson(route, savedRecipe);
      return;
    }
    await route.abort();
  });
}

test.beforeEach(async ({ page }) => {
  await installImportFixtures(page);
  await page.goto("/import");
});

test("imports a TikTok link, then saves the streamlined Review draft", async ({ page }, testInfo) => {
  await expect(page.getByRole("heading", { name: "Import recipe" })).toBeVisible();
  const sourcePanel = await page.locator("main form").evaluate((form) => {
    const rect = form.getBoundingClientRect();
    return { width: rect.width, center: rect.x + rect.width / 2, viewport: window.innerWidth };
  });
  expect(sourcePanel.width).toBeLessThanOrEqual(720);
  expect(Math.abs(sourcePanel.center - sourcePanel.viewport / 2)).toBeLessThanOrEqual(1);
  await expect(page.getByLabel("Title (optional)")).toHaveCount(0);
  await page.getByRole("button", { name: "Optional details" }).click();
  await expect(page.getByLabel("Title (optional)")).toBeVisible();
  await page.getByRole("button", { name: "Optional details" }).click();

  await page.getByLabel("YouTube or TikTok URL").fill("https://www.tiktok.com/@chef/video/7412345678901234567");
  const parseRequest = page.waitForRequest(
    (request) => request.method() === "POST" && new URL(request.url()).pathname === "/recipes/import-jobs",
  );
  await page.getByRole("button", { name: "Create draft" }).click();
  expect((await parseRequest).postDataJSON()).toMatchObject({
    url: "https://www.tiktok.com/@chef/video/7412345678901234567",
  });

  await expect(page.getByRole("button", { name: "Back to source" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Review recipe" })).toBeVisible();
  await expect(page.getByLabel("Image URL")).toHaveCount(0);
  await expect(page.getByPlaceholder(/Notes/i)).toHaveCount(0);
  await expect(page.getByText(/Add image/i)).toHaveCount(0);
  await expect(page.getByText(/Errors stay local/i)).toHaveCount(0);
  await expect(page.getByLabel("Original amount 1")).toHaveValue("1 block");
  await expect(page.getByLabel("Ingredient 1", { exact: true })).toHaveValue("Firm tofu");
  const conversion = page.getByLabel("Amount in g / ml 1", { exact: true });
  await expect(conversion).toHaveValue("400 g");
  await expect(conversion).toHaveAccessibleDescription("Optional conversion, e.g. 400 g or 250 ml.");
  await conversion.fill("450 g");
  await page.getByText("Edit tags", { exact: true }).click();
  await page.getByRole("button", { name: "Quick", exact: true }).click();
  await page.getByText("Edit tags", { exact: true }).click();
  await expect(page.getByText("AI estimated", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Passive" }).first()).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.getByLabel("Step 1 illustration")).toHaveValue("simmer");

  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await expect(page.getByRole("button", { name: "Save recipe" })).toBeInViewport();
  await page.evaluate(() => window.scrollTo(0, 0));

  await page.getByLabel("Step 1 minutes").fill("9");
  await page.getByRole("button", { name: "Hands-on" }).first().click();
  await page.getByLabel("Step 1 illustration").selectOption("boil");

  if (testInfo.project.name === "desktop") {
    await expect(page).toHaveScreenshot("import-review.png", {
      animations: "disabled",
      fullPage: true,
    });
  }

  const saveRequest = page.waitForRequest(
    (request) => request.method() === "POST" && new URL(request.url()).pathname === "/recipes",
  );
  await page.getByRole("button", { name: "Save recipe" }).click();
  const saved = (await saveRequest).postDataJSON();
  expect(saved.ingredients).toEqual([
    { ...draftRecipe.ingredients[0], metric_quantity: "450 g" },
    draftRecipe.ingredients[1],
  ]);
  expect(saved.library_tags).toEqual([...draftRecipe.library_tags, "quick"]);
  expect(saved.steps).toEqual([
    {
      id: "66ccce3a-1274-4ea2-a99b-ff092f3761d1",
      text: "Sear the tofu until golden.",
      duration_seconds: 540,
      duration_source: "user",
      attention_type: "hands_on",
      action_type: "boil",
      image_url: null,
    },
    {
      id: "3f0f7a65-4c82-4d25-a0a5-23e1a3eabf69",
      text: "Add the sauce and braise until glossy.",
      duration_seconds: 720,
      duration_source: "stated",
      attention_type: "hands_on",
      action_type: "sear",
      image_url: null,
    },
  ]);
  await expect(page).toHaveURL(/\/recipe\/saved-1$/);
  await expect(page.getByRole("heading", { name: "Braised tofu" })).toBeVisible();
  await expect(page.getByText("Sear the tofu until golden.")).toBeVisible();
  await expect(page.getByText("About 9 min · Adjusted · Hands-on")).toBeVisible();
});

test("sends YouTube links to the link parser", async ({ page }) => {
  await page.getByLabel("YouTube or TikTok URL").fill("https://www.youtube.com/watch?v=recipe");
  const parseRequest = page.waitForRequest(
    (request) => request.method() === "POST" && new URL(request.url()).pathname === "/recipes/import-jobs",
  );
  await page.getByRole("button", { name: "Create draft" }).click();
  expect((await parseRequest).postDataJSON()).toMatchObject({
    url: "https://www.youtube.com/watch?v=recipe",
  });
  await expect(page.getByRole("heading", { name: "Review recipe" })).toBeVisible();
});

test("keeps pasted text and optional metadata when returning from review", async ({ page }) => {
  await page.getByRole("tab", { name: "Paste recipe text" }).click();
  await page.getByLabel("Paste recipe text", { exact: true }).fill("Sear one block of tofu, then simmer with soy sauce.");
  await page.getByRole("button", { name: "Optional details" }).click();
  await page.getByLabel("Title (optional)").fill("My tofu braise");
  await page.getByLabel("Notes (optional)").fill("Use firm tofu.");
  await page.getByRole("button", { name: "Quick", exact: true }).click();
  const parseRequest = page.waitForRequest(
    (request) => request.method() === "POST" && new URL(request.url()).pathname === "/recipes/import-jobs",
  );
  await page.getByRole("button", { name: "Create draft" }).click();
  expect((await parseRequest).postDataJSON()).toEqual({
    mode: "text",
    transcript: "Sear one block of tofu, then simmer with soy sauce.",
    title: "My tofu braise",
    notes: "Use firm tofu.",
    library_tags: ["quick"],
  });
  await page.getByRole("button", { name: "Back to source" }).click();
  await expect(page.getByRole("tab", { name: "Paste recipe text" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByLabel("Paste recipe text", { exact: true })).toHaveValue("Sear one block of tofu, then simmer with soy sauce.");
  await page.getByRole("button", { name: "Optional details" }).click();
  await expect(page.getByLabel("Title (optional)")).toHaveValue("My tofu braise");
  await expect(page.getByLabel("Notes (optional)")).toHaveValue("Use firm tofu.");
  await expect(page.getByRole("button", { name: "Quick", exact: true })).toHaveAttribute("aria-pressed", "true");
});

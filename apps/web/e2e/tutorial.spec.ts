import { expect, test, type Page, type Route } from "@playwright/test";

const appOrigin = `http://127.0.0.1:${process.env.PORT ?? "3000"}`;

const fallbackStep = {
  id: "ed1ba26e-153f-4e66-804f-400bbec6e3de",
  text: "Simmer until the sauce coats the spoon.",
  duration_seconds: 300,
  duration_source: "fallback",
  attention_type: "passive",
  action_type: "simmer",
  image_url: null,
};

const recipe = {
  id: "tutorial-1",
  title: "Glossy braised tofu",
  source_url: null,
  thumbnail_url: null,
  ingredients: [{ name: "Firm tofu", quantity: "1 block", metric_quantity: "400 g", notes: "" }],
  raw_extraction_text: null,
  library_tags: ["weeknight"],
  library_category: "weeknight",
  is_public_catalog: false,
  catalog_source_recipe_id: null,
  description: "A weeknight braise.",
  total_time_minutes: 20,
  steps: [fallbackStep],
  tips: [],
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

async function installTutorialFixtures(page: Page, patchBodies: unknown[]) {
  await page.route("http://localhost:8000/**", async (route) => {
    const request = route.request();
    const { pathname } = new URL(request.url());
    if (pathname === "/auth/me") {
      await fulfillJson(route, {
        id: "00000000-0000-0000-0000-000000000001",
        email: "tutorial@example.com",
        is_library_public: false,
      });
      return;
    }
    if (pathname === "/recipes/tutorial-1" && request.method() === "GET") {
      await fulfillJson(route, recipe);
      return;
    }
    if (
      pathname === "/recipes/tutorial-1/tutorial/estimate" &&
      request.method() === "POST"
    ) {
      await fulfillJson(route, {
        steps: [
          {
            ...fallbackStep,
            duration_seconds: 480,
            duration_source: "estimated",
          },
        ],
      });
      return;
    }
    if (pathname === "/recipes/tutorial-1" && request.method() === "PATCH") {
      patchBodies.push(request.postDataJSON());
      await fulfillJson(route, { ...recipe, ...request.postDataJSON() });
      return;
    }
    await route.abort();
  });
}

test("previews tutorial estimates without persistence and saves explicit duration edits", async ({
  page,
}) => {
  const patchBodies: unknown[] = [];
  await installTutorialFixtures(page, patchBodies);
  await page.goto("/recipe/tutorial-1");

  const tutorial = page.getByRole("region", { name: "Steps" });
  await expect(tutorial.locator("svg")).toHaveCount(1);
  await expect(tutorial.getByText("About 5 min · Rough estimate · Passive")).toBeVisible();

  await tutorial.getByRole("link", { name: "Edit tutorial" }).click();
  await expect(page).toHaveURL(/\/recipe\/tutorial-1\/tutorial\/edit$/);
  await page.getByRole("button", { name: "Estimate missing tutorial details" }).click();
  await expect(page.getByText("AI estimated", { exact: true })).toBeVisible();
  expect(patchBodies).toEqual([]);

  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page).toHaveURL(/\/recipe\/tutorial-1$/);
  expect(patchBodies).toEqual([]);

  await page.getByRole("link", { name: "Edit tutorial" }).click();
  await page.getByLabel("Step 1 minutes").fill("7");
  await page.getByRole("button", { name: "Save tutorial" }).click();
  await expect(page).toHaveURL(/\/recipe\/tutorial-1$/);

  expect(patchBodies).toEqual([
    {
      steps: [
        {
          ...fallbackStep,
          duration_seconds: 420,
          duration_source: "user",
        },
      ],
    },
  ]);
});

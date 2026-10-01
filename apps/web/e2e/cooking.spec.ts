import { recipePageFixture } from "./recipePageFixture";
import { API_BASE } from "./api";
import { expect, test, type Page, type Route } from "@playwright/test";
import { applyOptimisticCookingAction, type CookingSession, type CookingStep } from "../../../packages/shared/src/cookingSession";

const appOrigin = `http://127.0.0.1:${process.env.PORT ?? "3000"}`;
const now = "2026-08-27T12:00:00.000Z";

const recipes = [
  {
    id: "recipe-tofu",
    title: "Mapo tofu",
    source_url: null,
    thumbnail_url: "/cook-fixture-images/tofu.svg",
    ingredients: [],
    raw_extraction_text: null,
    library_tags: [],
    library_category: null,
    is_public_catalog: false,
    catalog_source_recipe_id: null,
    description: null,
    total_time_minutes: 5,
    steps: [{ id: "recipe-step-tofu", text: "Chop the tofu", duration_seconds: 120 }],
    tips: [],
    equipment: [],
  },
  {
    id: "recipe-rice",
    title: "Steamed rice",
    source_url: null,
    thumbnail_url: "/cook-fixture-images/rice.svg",
    ingredients: [],
    raw_extraction_text: null,
    library_tags: [],
    library_category: null,
    is_public_catalog: false,
    catalog_source_recipe_id: null,
    description: null,
    total_time_minutes: 15,
    steps: [{ id: "recipe-step-rice", text: "Steam the rice", duration_seconds: 900 }],
    tips: [],
    equipment: [],
  },
];

function cookingStep(overrides: Partial<CookingStep>): CookingStep {
  return {
    position: 0,
    duration_source: "stated",
    image_url: null,
    state: "ready",
    timer_started_at: null,
    timer_ends_at: null,
    paused_remaining_seconds: null,
    resolved_at: null,
    notification_owner_device_id: null,
    revision: 1,
    updated_at: now,
    ...overrides,
  } as CookingStep;
}

function freshSession(): CookingSession {
  return {
    id: "session-1",
    version: 1,
    created_at: now,
    updated_at: now,
    dishes: [
      {
        id: "dish-tofu",
        recipe_id: "recipe-tofu",
        position: 0,
        title: "Mapo tofu",
        thumbnail_url: "/cook-fixture-images/tofu.svg",
        ingredients: [],
        equipment: [],
        tips: [],
        created_at: now,
        steps: [cookingStep({
          id: "step-tofu",
          recipe_step_id: "recipe-step-tofu",
          text: "Chop the tofu",
          duration_seconds: 120,
          attention_type: "hands_on",
          action_type: "chop",
        })],
      },
      {
        id: "dish-rice",
        recipe_id: "recipe-rice",
        position: 1,
        title: "Steamed rice",
        thumbnail_url: "/cook-fixture-images/rice.svg",
        ingredients: [],
        equipment: [],
        tips: [],
        created_at: now,
        steps: [cookingStep({
          id: "step-rice",
          recipe_step_id: "recipe-step-rice",
          text: "Steam the rice",
          duration_seconds: 900,
          attention_type: "passive",
          action_type: "simmer",
        })],
      },
    ],
  };
}

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

async function installCookingFixtures(page: Page, actions: unknown[], multiStep = false) {
  let session: ReturnType<typeof freshSession> | null = null;
  await page.route("**/cook-fixture-images/*", (route) => route.fulfill({
    contentType: "image/svg+xml",
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="130" height="130"><rect width="130" height="130" fill="#e6ded6"/><circle cx="65" cy="65" r="45" fill="#a64b34"/></svg>',
  }));
  await page.route(`${API_BASE}/**`, async (route) => {
    const request = route.request();
    const { pathname } = new URL(request.url());
    if (pathname === "/auth/me") {
      await fulfillJson(route, {
        id: "00000000-0000-0000-0000-000000000001",
        email: "cook@example.com",
        is_library_public: false,
      });
      return;
    }
    if (pathname === "/cooking-session/active" && request.method() === "GET") {
      await fulfillJson(route, session);
      return;
    }
    if (pathname === "/recipes/page" && request.method() === "GET") {
      await fulfillJson(route, recipePageFixture(recipes, request.url()));
      return;
    }
    if (pathname === "/meal-plan" && request.method() === "GET") {
      await fulfillJson(route, []);
      return;
    }
    if (pathname === "/cooking-session" && request.method() === "POST") {
      expect(request.postDataJSON()).toEqual({ recipe_ids: ["recipe-tofu", "recipe-rice"] });
      session = freshSession();
      if (multiStep) session.dishes[0].steps.push(...["Simmer the sauce", "Gently add the tofu", "Finish the sauce", "Garnish and serve"].map((text, index) => cookingStep({
        id: `tofu-next-${index}`, recipe_step_id: `recipe-tofu-next-${index}`, position: index + 1, text,
        duration_seconds: index === 0 ? 600 : 60, attention_type: index === 0 ? "passive" : "hands_on", action_type: index === 0 ? "simmer" : "mix", state: "locked",
      })));
      await fulfillJson(route, session);
      return;
    }
    if (pathname.includes("/steps/") && pathname.endsWith("/actions") && request.method() === "POST" && session) {
      const body = request.postDataJSON();
      actions.push(body);
      const stepId = pathname.split("/").at(-2);
      const dish = session.dishes.find(item => item.steps.some(step => step.id === stepId))!;
      session = applyOptimisticCookingAction(session, dish.id, stepId!, body);
      await fulfillJson(route, session);
      return;
    }
    await route.abort();
  });
}

async function installOfflineFixtures(page: Page) {
  let session = freshSession();
  const network = { offline: false, conflict: false };
  await page.route(`${API_BASE}/**`, async (route) => {
    const request = route.request();
    const { pathname } = new URL(request.url());
    if (pathname === "/auth/me") {
      await fulfillJson(route, {
        id: "00000000-0000-0000-0000-000000000001",
        email: "offline-cook@example.com",
        is_library_public: false,
      });
      return;
    }
    if (pathname === "/cooking-session/active" && request.method() === "GET") {
      if (network.offline) await route.abort("internetdisconnected");
      else await fulfillJson(route, session);
      return;
    }
    if (pathname.includes("/steps/") && pathname.endsWith("/actions") && request.method() === "POST") {
      if (network.offline) {
        await route.abort("internetdisconnected");
        return;
      }
      if (network.conflict) {
        await route.fulfill({
          status: 409,
          contentType: "application/json",
          headers: {
            "Access-Control-Allow-Origin": appOrigin,
            "Access-Control-Allow-Credentials": "true",
          },
          body: JSON.stringify({ detail: { code: "revision_conflict", message: "Revision conflict" } }),
        });
        return;
      }
      const body = request.postDataJSON();
      session = {
        ...session,
        version: session.version + 1,
        dishes: session.dishes.map((dish) => ({
          ...dish,
          steps: dish.steps.map((step) => step.id === "step-rice"
            ? { ...step, state: "timer_running", timer_started_at: body.occurred_at, timer_ends_at: new Date(Date.now()+900000).toISOString(), revision: step.revision + 1 }
            : step),
        })),
      };
      await fulfillJson(route, session);
      return;
    }
    await route.abort();
  });
  return network;
}

test("starts two dishes, browses without completion, and runs a passive timer", async ({ page }) => {
  const actions: Array<Record<string, unknown>> = [];
  await installCookingFixtures(page, actions);
  await page.goto("/cook");

  await expect(page.getByRole("heading", { name: "Start cooking" })).toBeVisible();
  await page.getByRole("tab", { name: "Choose recipes" }).click();
  await page.getByRole("checkbox", { name: "Mapo tofu" }).check();
  await page.getByRole("checkbox", { name: "Steamed rice" }).check();
  await page.getByRole("button", { name: "Start 2 dishes" }).click();

  await expect(page.getByRole("heading", { name: "Your cooking session" })).toBeVisible();
  await expect(page.getByText("Work on Mapo tofu")).toBeVisible();
  await expect(page.getByText("100% of steps")).toBeVisible();
  await expect(page.getByRole("timer")).toHaveCount(0);

  await expect(page.getByRole("button", { name: "Next step", exact: true })).toBeDisabled();
  await expect(page.getByText("This dish is complete.")).toHaveCount(0);

  await page.getByRole("button", { name: "Focus Steamed rice" }).click();
  await expect(page.getByText("Steam the rice")).toBeVisible();
  await page.getByRole("button", { name: "Start timer" }).click();
  await expect(page.getByRole("timer")).toBeVisible();
  await expect(page.getByRole("button", { name: "Pause timer" })).toBeVisible();

  expect(actions).toHaveLength(1);
  expect(actions[0]).toMatchObject({ action: "start_timer", expected_revision: 1 });
  expect(actions.every((action) => typeof action.mutation_id === "string" && typeof action.device_id === "string")).toBe(true);
});

test("keeps cached timer state through an API outage and explains a replay conflict", async ({ page }) => {
  const network = await installOfflineFixtures(page);
  await page.goto("/cook");
  await expect(page.getByText("Chop the tofu")).toBeVisible();

  await page.getByRole("button", { name: "Focus Steamed rice", exact: true }).click();
  network.offline = true;
  await page.getByRole("button", { name: "Start timer", exact: true }).click();
  await expect(page.getByText(/Saved offline/)).toBeVisible();
  await expect(page.getByText(/1 change\(s\) waiting to sync/)).toBeVisible();

  await page.reload();
  await page.getByRole("button", { name: "Focus Steamed rice", exact: true }).click();
  await expect(page.getByRole("timer")).toBeVisible();
  await expect(page.getByText(/Showing saved cooking progress/)).toBeVisible();

  network.offline = false;
  network.conflict = true;
  await page.evaluate(() => window.dispatchEvent(new Event("online")));

  await expect(page.getByText(/changed on another device/)).toBeVisible();
  await expect(page.getByTestId("focused-step")).toContainText("Steam the rice");
  await expect(page.getByRole("button", { name: "Start timer", exact: true })).toBeVisible();
  await expect(page.getByRole("timer")).toHaveCount(0);
});

test("switches cooking views while preserving timers and updating only the chosen dish", async ({ page }) => {
  const actions: Array<Record<string, unknown>> = [];
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await installCookingFixtures(page, actions);
  await page.goto("/cook");
  await page.getByRole("tab", { name: "Choose recipes" }).click();
  await page.getByRole("checkbox", { name: "Mapo tofu" }).check();
  await page.getByRole("checkbox", { name: "Steamed rice" }).check();
  await page.getByRole("button", { name: "Start 2 dishes" }).click();

  await page.getByRole("button", { name: "All dishes", exact: true }).click();
  const tofu = page.getByRole("region", { name: "Mapo tofu", exact: true });
  const rice = page.getByRole("region", { name: "Steamed rice", exact: true });
  await expect(tofu.getByText("Chop the tofu")).toBeVisible();
  await expect(tofu.locator("img")).toBeVisible();
  await expect.poll(() => tofu.locator("img").evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);
  await rice.getByRole("button", { name: "Start timer" }).click();
  await expect(rice.getByRole("timer")).toBeVisible();
  await rice.getByRole("button", { name: "Pause timer" }).click();
  const paused = await rice.getByRole("timer").getAttribute("aria-label");
  await rice.getByRole("button", { name: "+1 minute" }).click();
  await expect(rice.getByRole("timer")).not.toHaveAttribute("aria-label", paused!);
  await rice.getByRole("button", { name: "Resume timer" }).click();
  await expect(rice.getByRole("button", { name: "Pause timer" })).toBeVisible();

  await page.getByRole("button", { name: "Focused", exact: true }).click();
  await expect(page.getByText("Chop the tofu")).toBeVisible();
  await expect(page.getByText("Steam the rice")).toHaveCount(0);
  await page.getByRole("button", { name: "All dishes", exact: true }).click();
  await expect(rice.getByRole("timer")).toBeVisible();
  await expect(rice.getByRole("button", { name: "Pause timer" })).toBeVisible();
  await expect(tofu.getByRole("button", { name: "Next step", exact: true })).toBeDisabled();
  await expect(tofu.getByText("This dish is complete.")).toHaveCount(0);
  await expect(rice.getByRole("timer")).toBeVisible();
  await tofu.getByRole("button", { name: "Overview", exact: true }).click();
  await expect(tofu.getByRole("region", { name: "Recipe overview for Mapo tofu" })).toBeVisible();
  await tofu.getByRole("button", { name: "View step 1: Chop the tofu" }).click();
  await expect(tofu.getByText("Chop the tofu")).toBeVisible();
  await expect(tofu.getByRole("button", { name: "Next step", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: /Undo/ })).toHaveCount(0);

  await rice.getByRole("button", { name: "Focus Steamed rice" }).click();
  await expect(page.getByRole("button", { name: "Focused", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("focused-step")).toContainText("Steam the rice");
  await expect(page.getByRole("timer")).toBeVisible();
  expect(actions.map((action) => action.action)).toEqual(["start_timer", "pause_timer", "extend_timer", "resume_timer"]);
  expect(errors).toEqual([]);
});

for (const language of ["en", "zh"] as const) {
  test(`keeps stacked instructions and controls readable at 320px in ${language}`, async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 780 });
    await page.addInitScript((value) => localStorage.setItem("cooking-ui-language", value), language);
    const actions: unknown[] = [];
    await installCookingFixtures(page, actions);
    await page.goto("/cook");
    await page.getByRole("tab", { name: language === "en" ? "Choose recipes" : "选择菜谱" }).click();
    await page.getByRole("checkbox", { name: "Mapo tofu" }).check();
    await page.getByRole("checkbox", { name: "Steamed rice" }).check();
    await page.getByRole("button", { name: language === "en" ? "Start 2 dishes" : "开始烹饪 2 道菜" }).click();
    await page.getByRole("button", { name: language === "en" ? "All dishes" : "全部菜品", exact: true }).click();
    await expect(page.getByTestId("stacked-step")).toHaveCount(2);
    for (const card of await page.getByTestId("stacked-step").all()) {
      await expect(card.locator("img")).toBeVisible();
      await expect.poll(() => card.locator("img").evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);
    }
    const rice = page.getByRole("region", { name: "Steamed rice", exact: true });
    await rice.getByRole("button", { name: language === "en" ? "Start timer" : "开始计时" }).click();
    await expect(rice.getByRole("timer")).toBeVisible();
    const bounds = await page.getByTestId("stacked-step").evaluateAll((cards) => cards.map((card) => {
      const rect = card.getBoundingClientRect();
      return { left: rect.left, right: rect.right, scroll: card.scrollWidth, width: card.clientWidth };
    }));
    expect(bounds.every((card) => card.left >= 0 && card.right <= 320 && card.scroll <= card.width)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
}

test("reviews previous steps and looks ahead without changing cooking progress or a live timer", async ({ page }) => {
  const actions: Array<Record<string, unknown>> = [];
  await installCookingFixtures(page, actions, true);
  await page.goto("/cook");
  await page.getByRole("tab", { name: "Choose recipes" }).click();
  await page.getByRole("checkbox", { name: "Mapo tofu" }).check();
  await page.getByRole("checkbox", { name: "Steamed rice" }).check();
  await page.getByRole("button", { name: "Start 2 dishes" }).click();
  const card = page.getByTestId("focused-step");
  await card.getByRole("button", { name: "Next step", exact: true }).click();
  await expect(card.getByText("Simmer the sauce", { exact: true })).toBeVisible();
  await card.getByRole("button", { name: "Start timer", exact: true }).click();
  await expect(card.getByRole("timer")).toBeVisible();
  await card.getByRole("button", { name: "Previous step", exact: true }).click();
  await expect(card.getByText("Chop the tofu", { exact: true })).toBeVisible();
  await expect(card.getByText("Timer for step 2", { exact: true })).toBeVisible();
  await card.getByRole("button", { name: "Next step", exact: true }).click();
  await expect(card.getByText("Simmer the sauce", { exact: true })).toBeVisible();
  await card.getByRole("button", { name: "Up next", exact: true }).click();
  const preview = card.getByRole("region", { name: "Next steps for Mapo tofu" });
  await expect(preview.getByRole("listitem")).toHaveCount(3);
  await card.getByRole("button", { name: "Up next", exact: true }).click();
  await expect(preview).toHaveCount(0);
  await card.getByRole("button", { name: "Overview", exact: true }).click();
  const overview = card.getByRole("region", { name: "Recipe overview for Mapo tofu" });
  await expect(overview.getByRole("listitem")).toHaveCount(5);
  await overview.getByRole("button", { name: "View step 5: Garnish and serve", exact: true }).click();
  await expect(card.getByText("100% of steps", { exact: true })).toBeVisible();
  await expect(card.getByText("This dish is complete.")).toHaveCount(0);
  await expect(card.getByRole("timer")).toBeVisible();
  await expect(card.locator("img")).toBeVisible();
  await expect(card.getByRole("button", { name: "Next step", exact: true })).toBeDisabled();
  expect(actions.map(action => action.action)).toEqual(["start_timer"]);
  await page.getByRole("button", { name: "All dishes", exact: true }).click();
  const tofu = page.getByRole("region", { name: "Mapo tofu", exact: true });
  await expect(tofu.getByText("Garnish and serve", { exact: true })).toBeVisible();
  await tofu.getByRole("button", { name: "Back to timer", exact: true }).click();
  await expect(tofu.getByText("Simmer the sauce", { exact: true })).toBeVisible();
  await tofu.getByRole("button", { name: "Pause timer", exact: true }).click();
  await tofu.getByRole("button", { name: "Stop timer", exact: true }).click();
  await expect(tofu.getByRole("timer")).toHaveCount(0);
  await expect(tofu.getByRole("button", { name: "Start timer", exact: true })).toBeVisible();
  expect(actions.map(action => action.action)).toEqual(["start_timer", "pause_timer", "stop_timer"]);
  await expect(page.getByRole("button", { name: /Undo/ })).toHaveCount(0);
});

import { expect, test, type Page, type Route } from "@playwright/test";
import type { CookingSession, CookingStep } from "@cooking/shared";

const appOrigin = `http://127.0.0.1:${process.env.PORT ?? "3000"}`;
const now = "2026-08-27T12:00:00.000Z";

const recipes = [
  {
    id: "recipe-tofu",
    title: "Mapo tofu",
    source_url: null,
    thumbnail_url: null,
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
    thumbnail_url: null,
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
        thumbnail_url: null,
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
        thumbnail_url: null,
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

async function installCookingFixtures(page: Page, actions: unknown[]) {
  let session: ReturnType<typeof freshSession> | null = null;
  await page.route("http://localhost:8000/**", async (route) => {
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
    if (pathname === "/recipes" && request.method() === "GET") {
      await fulfillJson(route, recipes);
      return;
    }
    if (pathname === "/meal-plan" && request.method() === "GET") {
      await fulfillJson(route, []);
      return;
    }
    if (pathname === "/cooking-session" && request.method() === "POST") {
      expect(request.postDataJSON()).toEqual({ recipe_ids: ["recipe-tofu", "recipe-rice"] });
      session = freshSession();
      await fulfillJson(route, session);
      return;
    }
    if (pathname.includes("/steps/") && pathname.endsWith("/actions") && request.method() === "POST" && session) {
      const body = request.postDataJSON();
      actions.push(body);
      const stepId = pathname.split("/").at(-2);
      session = {
        ...session,
        version: session.version + 1,
        updated_at: body.occurred_at,
        dishes: session.dishes.map((dish) => ({
          ...dish,
          steps: dish.steps.map((step) => {
            if (step.id !== stepId) return step;
            if (body.action === "complete") {
              return {
                ...step,
                state: "completed",
                resolved_at: body.occurred_at,
                revision: step.revision + 1,
                updated_at: body.occurred_at,
              };
            }
            if (body.action === "start_timer") {
              return {
                ...step,
                state: "timer_running",
                timer_started_at: body.occurred_at,
                timer_ends_at: new Date(Date.now() + step.duration_seconds * 1000).toISOString(),
                notification_owner_device_id: body.device_id,
                revision: step.revision + 1,
                updated_at: body.occurred_at,
              };
            }
            return step;
          }),
        })),
      };
      await fulfillJson(route, session);
      return;
    }
    await route.abort();
  });
}

async function installOfflineFixtures(page: Page) {
  let session = freshSession();
  const network = { offline: false, conflict: false };
  await page.route("http://localhost:8000/**", async (route) => {
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
          steps: dish.steps.map((step) => step.id === "step-tofu"
            ? { ...step, state: "completed", resolved_at: body.occurred_at, revision: step.revision + 1 }
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

test("starts two dishes, advances hands-on work, and runs a passive timer", async ({ page }) => {
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
  await expect(page.getByText("0% complete")).toBeVisible();
  await expect(page.getByRole("timer")).toHaveCount(0);

  await page.getByRole("button", { name: "Complete step" }).click();
  await expect(page.getByText("This dish is complete.")).toBeVisible();
  await expect(page.getByText("100% complete")).toBeVisible();

  await page.getByRole("button", { name: "Focus Steamed rice" }).click();
  await expect(page.getByText("Steam the rice")).toBeVisible();
  await page.getByRole("button", { name: "Start timer" }).click();
  await expect(page.getByRole("timer")).toBeVisible();
  await expect(page.getByRole("button", { name: "Pause timer" })).toBeVisible();

  expect(actions).toHaveLength(2);
  expect(actions[0]).toMatchObject({ action: "complete", expected_revision: 1 });
  expect(actions[1]).toMatchObject({ action: "start_timer", expected_revision: 1 });
  expect(actions.every((action) => typeof action.mutation_id === "string" && typeof action.device_id === "string")).toBe(true);
});

test("keeps cached progress through an API outage and explains a replay conflict", async ({ page }) => {
  const network = await installOfflineFixtures(page);
  await page.goto("/cook");
  await expect(page.getByText("Chop the tofu")).toBeVisible();

  network.offline = true;
  await page.getByRole("button", { name: "Complete step" }).click();
  await expect(page.getByText(/Saved offline/)).toBeVisible();
  await expect(page.getByText(/1 change\(s\) waiting to sync/)).toBeVisible();

  await page.reload();
  await expect(page.getByText("This dish is complete.")).toBeVisible();
  await expect(page.getByText(/Showing saved cooking progress/)).toBeVisible();

  network.offline = false;
  network.conflict = true;
  await page.evaluate(() => window.dispatchEvent(new Event("online")));

  await expect(page.getByText(/changed on another device/)).toBeVisible();
  await expect(page.getByText("Chop the tofu")).toBeVisible();
});

import { expect, test, type Route } from "@playwright/test";
import { API_BASE } from "./api";

const appOrigin = `http://127.0.0.1:${process.env.PORT ?? "3000"}`;

async function json(route: Route, body: unknown) {
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

for (const editor of ["recipe", "tutorial"] as const) {
  test(`${editor} editor synchronizes total time through Save and reload`, async ({ page }, testInfo) => {
    let stored = {
      id: "timing-recipe",
      title: "Braised tofu",
      description: "A recipe for checking step timing.",
      thumbnail_url: null,
      total_time_minutes: 5,
      ingredients: [{ name: "Tofu", quantity: "1 block", metric_quantity: "400 g", notes: null }],
      steps: [
        { id: "d042d265-8ac1-46cf-9d26-0c459538b8bb", text: "Prepare the tofu.", duration_seconds: 120,
          duration_source: "stated", attention_type: "hands_on", action_type: "chop", image_url: null },
        { id: "6c752b5c-861d-4988-a503-5698de52010e", text: "Simmer the tofu.", duration_seconds: 180,
          duration_source: "stated", attention_type: "passive", action_type: "simmer", image_url: null },
      ],
      tips: [],
      library_tags: [],
      source_url: null,
      is_public_catalog: false,
      catalog_source_recipe_id: null,
    };
    const patches: Record<string, unknown>[] = [];
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
    await page.route(`${API_BASE}/**`, async route => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      if (request.method() === "OPTIONS") {
        await route.fulfill({ status: 204, headers: {
          "Access-Control-Allow-Origin": appOrigin, "Access-Control-Allow-Credentials": "true",
          "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
          "Access-Control-Allow-Headers": request.headers()["access-control-request-headers"] ?? "content-type",
        } });
      } else if (path === "/auth/me") {
        await json(route, { id: "00000000-0000-0000-0000-000000000001", email: "timing@example.com", email_verified: true, email_verification_required: false, is_admin: false, is_library_public: false });
      } else if (path === "/recipes/timing-recipe") {
        if (request.method() === "PATCH") {
          const payload = request.postDataJSON() as Record<string, unknown>;
          patches.push(payload);
          stored = { ...stored, ...payload };
        }
        await json(route, stored);
      } else if (path === "/recipes/image-generation/access") {
        await json(route, { enabled: false, allowed: false, reason: "disabled", daily_limit: 0, remaining: 0, resets_at: "2099-01-01T00:00:00Z" });
      } else if (path === "/recipes/catalog/editor-status") {
        await json(route, { can_manage: false });
      } else if (path === "/cooking-session/active") {
        await json(route, null);
      } else if (path === "/recipes/page" || path === "/recipes/catalog/page") {
        await json(route, { items: [stored], next_cursor: null });
      } else {
        await json(route, []);
      }
    });

    const route = editor === "recipe" ? "/library/timing-recipe" : "/recipe/timing-recipe/tutorial/edit";
    await page.goto(route);
    await expect(page).toHaveURL(new RegExp(`${route}$`));
    await expect(page).toHaveTitle(/Chef World/);
    await expect(page.getByRole("heading", { level: 1, name: editor === "recipe" ? "Edit recipe" : "Edit tutorial" })).toBeVisible();
    await expect(page.getByLabel("Step 1 minutes")).toHaveValue("2");
    await page.getByLabel("Step 1 minutes").fill("7");
    await page.getByLabel("Step 1 seconds").fill("15");
    if (editor === "recipe") {
      await expect(page.getByRole("spinbutton", { name: /Total time/ })).toHaveValue("11");
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
    await page.getByRole("button", { name: editor === "recipe" ? "Save" : "Save tutorial", exact: true }).click();
    await expect(page).toHaveURL(editor === "recipe" ? /\/library$/ : /\/recipe\/timing-recipe$/);
    expect(patches).toHaveLength(1);
    expect(patches[0]).toMatchObject({ total_time_minutes: 11, steps: [
      { duration_seconds: 435, duration_source: "user" }, { duration_seconds: 180 },
    ] });
    await page.goto("/recipe/timing-recipe");
    await expect(page.getByRole("heading", { level: 1, name: "Braised tofu" })).toBeVisible();
    await expect(page.getByText("11 min", { exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByText("11 min", { exact: true })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath(`${editor}-timing.png`), fullPage: true });
    expect(errors).toEqual([]);
    await expect(page.locator("[data-nextjs-dialog-overlay]")).toHaveCount(0);
  });
}

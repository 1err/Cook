import { expect, test, type Route } from "@playwright/test";
import { API_BASE } from "./api";

const appOrigin = `http://127.0.0.1:${process.env.PORT ?? "3000"}`;
const image = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='800' height='600'%3E%3Crect width='800' height='600' fill='%23d2ac79'/%3E%3Cellipse cx='400' cy='300' rx='255' ry='195' fill='%23544436'/%3E%3Cellipse cx='400' cy='300' rx='220' ry='165' fill='%23b36132'/%3E%3C/svg%3E";
const recipe = {
  id: "image-recipe", title: "豆腐茄子煲", description: "Tofu and eggplant in a clay pot.",
  thumbnail_url: null, ingredients: [{ name: "Tofu", quantity: "1 block" }],
  steps: [{ text: "Braise in a clay pot.", duration_seconds: 600, duration_source: "stated", attention_type: "passive", action_type: "simmer" }],
  tips: [], equipment: [], library_tags: [],
};

async function fulfill(route: Route, body: unknown) {
  await route.fulfill({ status: 200, contentType: "application/json", headers: {
    "Access-Control-Allow-Origin": appOrigin, "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Headers": "Content-Type, X-Cw-Visitor, X-Cw-Session, X-Cw-Event-Id, X-Cw-Source, X-Cw-Medium, X-Cw-Campaign, X-Cw-Referrer",
    "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
  }, body: JSON.stringify(body) });
}

for (const flow of ["import", "edit"] as const) {
  test(`${flow} previews an AI cover and saves only after acceptance`, async ({ page }, testInfo) => {
    let generated = 0;
    let saved: Record<string, unknown> | null = null;
    await page.route(`${API_BASE}/**`, async (route) => {
      const request = route.request();
      const { pathname } = new URL(request.url());
      if (request.method() === "OPTIONS") return fulfill(route, {});
      if (pathname === "/analytics/events") return fulfill(route, { ok: true });
      if (pathname === "/auth/me") return fulfill(route, { id: "00000000-0000-0000-0000-000000000001", email: "image@example.com", email_verified: true, email_verification_required: false, is_library_public: false });
      if (pathname === "/recipes/image-generation/access") return fulfill(route, { enabled: true, allowed: true, reason: null, daily_limit: 3, remaining: 3 - generated, resets_at: "2026-09-26T00:00:00Z" });
      if (pathname === "/recipes/generate-image") {
        generated += 1;
        return fulfill(route, { request_id: request.postDataJSON().request_id, status: "completed", file_url: image });
      }
      if (pathname === "/recipes/parse/link") return fulfill(route, recipe);
      if (pathname === "/recipes/import-capabilities") return fulfill(route, { video_analysis: false, media_upload: false, max_media_bytes: 0 });
      if (pathname === "/recipes/import-jobs") return fulfill(route, { id: "image-import-job", status: "completed", recipe });
      if (pathname === "/recipes/catalog/editor-status") return fulfill(route, { can_manage: false });
      if ((pathname === "/recipes" && request.method() === "POST") || (pathname === `/recipes/${recipe.id}` && request.method() === "PATCH")) {
        saved = { ...recipe, ...request.postDataJSON() };
        return fulfill(route, saved);
      }
      if (pathname === `/recipes/${recipe.id}`) return fulfill(route, saved ?? recipe);
      if (pathname === "/recipes") return fulfill(route, []);
      if (pathname === "/users/friends") return fulfill(route, []);
      if (pathname === "/cooking-session/active") return fulfill(route, null);
      await route.abort();
    });
    if (flow === "import") {
      await page.goto("/import");
      await page.getByLabel("YouTube, TikTok, or RedNote URL").fill("https://www.youtube.com/watch?v=recipe");
      await page.getByRole("button", { name: "Prepare draft" }).click();
    } else {
      await page.goto(`/library/${recipe.id}`);
    }
    await expect(page.getByRole("button", { name: "Generate with AI" })).toBeEnabled();
    await page.getByRole("button", { name: "Generate with AI" }).click();
    await expect(page.getByRole("img", { name: "Generated recipe photo preview" })).toBeVisible();
    await expect(page.getByText("AI-generated", { exact: true })).toBeVisible();
    await expect(page.getByText("2 of 3 attempts left today.")).toBeVisible();
    expect(saved).toBeNull();
    await page.getByLabel("Recipe title").fill("豆腐茄子煲 · my version");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await testInfo.attach(`${flow}-ai-cover-preview`, { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
    await page.getByRole("button", { name: "Use image", exact: true }).click();
    const saveRequest = page.waitForRequest((request) => ["POST", "PATCH"].includes(request.method()) && new URL(request.url()).pathname === (flow === "import" ? "/recipes" : `/recipes/${recipe.id}`));
    await page.getByRole("button", { name: flow === "import" ? "Save recipe" : "Save", exact: true }).click();
    expect((await saveRequest).postDataJSON()).toMatchObject({ title: "豆腐茄子煲 · my version", thumbnail_url: image });
    expect(generated).toBe(1);
  });
}

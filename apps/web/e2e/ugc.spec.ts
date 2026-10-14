import { expect, test, type Page } from "@playwright/test";

const recipe = {
  id: "shared-recipe", title: "Review noodles", description: "A recipe shared for the local safety test.",
  ingredients: [{ name: "Noodles", quantity: "200 g" }], steps: [{ text: "Cook the noodles." }],
  thumbnail_url: null, shared_media_status: "pending", library_tags: ["weeknight"], is_public_catalog: true,
};
const appOrigin = `http://127.0.0.1:${process.env.PORT ?? "3000"}`;

async function fixtures(page: Page, admin = false, failCatalogRefresh = false) {
  let blocked = false;
  let resolved = false;
  let reportBody: unknown = null;
  let resolutionBody: unknown = null;
  let photoBody: unknown = null;
  let photoReviewed = false;
  let failedAfterBlock = false;
  const photoUrl = "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="320" height="240"><rect width="320" height="240" fill="#af7351"/></svg>');
  const candidate = { ...recipe, thumbnail_url: photoUrl, steps: [{ text: "Cook the noodles.", image_url: photoUrl }] };
  const photoSet = { id: "media-1", owner_id: "author", recipe_id: recipe.id, media_digest: "a".repeat(64), status: "pending", created_at: "2026-10-13T15:00:00Z", reviewer_id: null, reviewed_at: null, review_notes: null, eligible_media_urls: [photoUrl], recipe: candidate };
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (request.method() === "OPTIONS") {
      await route.fulfill({ status: 204, headers: { "Access-Control-Allow-Origin": appOrigin, "Access-Control-Allow-Credentials": "true", "Access-Control-Allow-Headers": request.headers()["access-control-request-headers"] ?? "Content-Type, Authorization, X-Chef-World-Account-ID", "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS" }, body: "" });
      return;
    }
    let body: unknown;
    let status = 200;
    const report = { id: "report-1", reporter_id: "reviewer", owner_id: "author", recipe_id: recipe.id, reason: "privacy", notes: "Contains personal information", status: resolved ? "resolved" : "pending", created_at: "2026-10-13T15:00:00Z", resolution: resolved ? "disable_library" : null, resolution_notes: null, reviewer_id: null, resolved_at: null, recipe };
    if (path === "/auth/me") body = { id: "reviewer", email: "review@example.com", is_library_public: false, is_admin: admin };
    else if (path === "/recipes/catalog" || path === "/recipes/catalog/page" || path === "/users/author/recipes" || path === "/users/author/recipes/page") {
      if (failCatalogRefresh && blocked && !failedAfterBlock) { failedAfterBlock = true; status = 503; body = { detail: "Unavailable" }; }
      else body = blocked ? [] : [photoReviewed ? { ...candidate, shared_media_status: "approved" } : recipe];
    }
    else if (path === "/recipes") body = [];
    else if (path === "/recipes/page") body = { items: [], has_more: false, total: 0, next_cursor: null };
    else if (path === "/auth/capabilities") body = { email_verification: false };
    else if (path.startsWith("/analytics")) { body = {}; status = 204; }
    else if (path === "/users/blocks") body = { users: blocked ? [{ id: "author", email: "author@example.com" }] : [] };
    else if (path === "/users/reports") { reportBody = request.postDataJSON(); body = { id: "report-1", status: "pending" }; status = 201; }
    else if (path === "/users/recipe-authors/shared-recipe/block" || path === "/users/author/block") { blocked = request.method() !== "DELETE"; body = { ok: true }; }
    else if (path === "/admin/content-reports") body = { reports: resolved ? [] : [report], total: resolved ? 0 : 1 };
    else if (path === "/admin/content-reports/report-1/resolve") { resolutionBody = request.postDataJSON(); resolved = true; body = { ...report, status: "resolved", resolution: "disable_library" }; }
    else if (path === "/admin/media-reviews") body = { reviews: photoReviewed ? [] : [photoSet], total: photoReviewed ? 0 : 1 };
    else if (path === "/admin/media-reviews/media-1/review") { photoBody = request.postDataJSON(); photoReviewed = true; body = { ...photoSet, status: "approved" }; }
    else { await route.continue(); return; }
    if (path.endsWith("/page") && Array.isArray(body)) body = { items: body, has_more: false, total: body.length, next_cursor: null };
    if (path.startsWith("/users/") && path !== "/users/author/recipes" || path.startsWith("/admin/")) expect(request.headers()["x-chef-world-account-id"]).toBe("reviewer");
    await route.fulfill({ status: request.method() === "OPTIONS" ? 204 : status,
      headers: { "Access-Control-Allow-Origin": appOrigin, "Access-Control-Allow-Credentials": "true", "Access-Control-Allow-Headers": request.headers()["access-control-request-headers"] ?? "Content-Type, Authorization, X-Chef-World-Account-ID", "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS" },
      contentType: "application/json", body: request.method() === "OPTIONS" ? "" : JSON.stringify(body) });
  });
  return { errors, report: () => reportBody, resolution: () => resolutionBody, photo: () => photoBody };
}

async function health(page: Page, errors: string[]) {
  expect(errors).toEqual([]);
  await expect(page.locator("nextjs-portal").getByText(/Runtime Error/)).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}

test("public recipe report and block persist through the safety controls", async ({ page }, info) => {
  const evidence = await fixtures(page);
  await page.goto("/library?view=public");
  await expect(page.getByRole("heading", { name: "Review noodles" })).toBeVisible();
  await page.getByRole("button", { name: "Report recipe: Review noodles" }).click();
  await page.getByLabel("Reason", { exact: true }).selectOption("privacy");
  await page.getByLabel("Additional details (optional)").fill("Contains personal information");
  await page.getByRole("button", { name: "Send report" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Report sent" })).toContainText("Report sent");
  expect(evidence.report()).toEqual({ recipe_id: recipe.id, reason: "privacy", notes: "Contains personal information" });
  await health(page, evidence.errors);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: `/private/tmp/chefworld-ugc-report-${info.project.name}.png`, fullPage: true });
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Block author" }).click();
  await expect(page.getByRole("heading", { name: "Review noodles" })).toHaveCount(0);
  await page.goto("/library/friends");
  await expect(page.getByText("author@example.com", { exact: true })).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Unblock: author@example.com" }).click();
  await expect(page.getByText("You have no blocked accounts.")).toBeVisible();
  await health(page, evidence.errors);
});

test("owner can inspect a frozen recipe and confirm a moderation action", async ({ page }, info) => {
  const evidence = await fixtures(page, true);
  await page.goto("/moderation");
  await expect(page.getByRole("heading", { name: "Content reports" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Review noodles" })).toBeVisible();
  await page.getByText("Reported recipe snapshot", { exact: true }).click();
  await expect(page.getByText("Cook the noodles.")).toBeVisible();
  await page.getByLabel("Action", { exact: true }).selectOption("disable_library");
  await health(page, evidence.errors);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: `/private/tmp/chefworld-moderation-${info.project.name}.png`, fullPage: true });
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Apply action" }).click();
  await expect(page.getByText("No pending reports.")).toBeVisible();
  expect(evidence.resolution()).toEqual({ action: "disable_library" });
  await health(page, evidence.errors);
});

test("non-admin cannot load the moderation interface", async ({ page }) => {
  const evidence = await fixtures(page, false);
  await page.goto("/moderation");
  await expect(page.getByRole("alert").filter({ hasText: "review team" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Review noodles" })).toHaveCount(0);
  await health(page, evidence.errors);
});


test("photo approval displays cover and step candidates and sends the captured digest", async ({ page }, info) => {
  const evidence = await fixtures(page, true);
  await page.goto("/moderation");
  await page.getByRole("button", { name: "Photo approvals", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Photo approvals" })).toBeVisible();
  await expect(page.getByAltText("Recipe cover")).toBeVisible();
  await expect(page.getByAltText("Step 1")).toBeVisible();
  await health(page, evidence.errors);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: `/private/tmp/chefworld-photo-review-${info.project.name}.png`, fullPage: true });
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Approve photos" }).click();
  await expect(page.getByText("No pending photo sets.")).toBeVisible();
  expect(evidence.photo()).toEqual({ decision: "approve", media_digest: "a".repeat(64) });
  await page.goto("/library?view=public");
  await expect(page.getByRole("heading", { name: "Review noodles" })).toBeVisible();
  await expect(page.getByRole("listitem").locator("img")).toHaveCount(1);
  await health(page, evidence.errors);
});

test("a catalog refresh failure after blocking remains visible and can be retried", async ({ page }) => {
  const evidence = await fixtures(page, false, true);
  await page.goto("/library?view=public");
  await expect(page.getByRole("heading", { name: "Review noodles" })).toBeVisible();
  await expect(page.getByText("Photos awaiting review. Copies include text only.")).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Block author" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Your recipes couldn’t be loaded" })).toBeVisible();
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Your recipes couldn’t be loaded" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Review noodles" })).toHaveCount(0);
  await health(page, evidence.errors);
});

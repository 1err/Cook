import { expect, test, type Page, type Route } from "@playwright/test";
import { API_BASE } from "./api";
import { emptyOverview } from "../app/admin/dashboard/testFixtures";
import { emptyCostReport, exampleCostReport } from "../app/admin/dashboard/costFixtures";

const appOrigin = `http://127.0.0.1:${process.env.PORT ?? "3000"}`;
async function fulfill(route: Route, body: unknown, status = 200) {
  await route.fulfill({ status, contentType: "application/json", headers: {
    "Access-Control-Allow-Origin": appOrigin, "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Headers": "Content-Type, X-Cw-Visitor, X-Cw-Session, X-Cw-Event-Id, X-Cw-Source, X-Cw-Medium, X-Cw-Campaign, X-Cw-Referrer",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  }, body: JSON.stringify(body) });
}
async function fixtures(page: Page, mode: "populated" | "empty" | "error" | "nonadmin" | "signedout") {
  const costRequests: string[] = [];
  await page.route(`${API_BASE}/**`, async route => {
    const { pathname } = new URL(route.request().url());
    if (route.request().method() === "OPTIONS") return fulfill(route, {});
    if (pathname === "/analytics/events" || pathname === "/auth/logout") return fulfill(route, { ok: true });
    if (pathname === "/auth/me") return fulfill(route, mode === "signedout" ? { detail: "Not authenticated" } : { id: "00000000-0000-0000-0000-000000000001", email: "admin-cost-fixture@example.com", is_admin: mode !== "nonadmin", is_library_public: false, email_verified: true, email_verification_required: false }, mode === "signedout" ? 401 : 200);
    if (pathname === "/auth/capabilities") return fulfill(route, { password_recovery: true, email_verification: false });
    if (pathname === "/admin/analytics/overview") return fulfill(route, emptyOverview);
    if (pathname === "/admin/analytics/users") return fulfill(route, { items: [], total: 0, limit: 25, offset: 0 });
    if (pathname === "/admin/ai-costs") {
      costRequests.push(pathname);
      return fulfill(route, mode === "error" ? { detail: "Unavailable" } : mode === "empty" ? emptyCostReport : exampleCostReport, mode === "error" ? 503 : 200);
    }
    if (pathname === "/admin/infrastructure-costs") return fulfill(route, { status: "available", provider: "aws", scope: "AWS account-wide; includes resources outside this app.", month_utc: "2026-09-01", through: "2026-09-24", fetched_at: "2026-09-25T00:00:00Z", estimated: true, currency: "USD", total_usd: "42.50", services: [{ service: "Elastic Compute Cloud", cost_usd: "42.50" }], unavailable_reason: null });
    await fulfill(route, { detail: "No fixture for this route" }, 404);
  });
  return costRequests;
}

for (const mode of ["populated", "empty", "error"] as const) {
  test(`admin Costs shows ${mode} data without presenting an app-wide invoice`, async ({ page }, testInfo) => {
    const pageErrors: string[] = [];
    page.on("pageerror", error => pageErrors.push(error.message));
    await fixtures(page, mode);
    await page.goto("/admin/dashboard");
    await page.getByRole("tab", { name: "Costs", exact: true }).click();
    await expect(page.getByRole("heading", { name: "AI costs this month" })).toBeVisible();
    await expect(page.getByText(/separately from a ChatGPT subscription/)).toBeVisible();
    if (mode === "populated") {
      await expect(page.getByLabel("Recorded AI estimate", { exact: true })).toContainText("$1.252");
      await expect(page.getByRole("table", { name: "AI provider cost breakdown" })).toBeVisible();
      await expect(page.getByText("100/day for admins · 3/day for other accounts")).toBeVisible();
    } else if (mode === "empty") {
      await expect(page.getByText("No AI calls recorded this month.")).toBeVisible();
      await expect(page.getByText(/No ledger records yet/)).toBeVisible();
    } else {
      await expect(page.getByRole("tabpanel", { name: "Costs" }).getByRole("alert")).toContainText("could not load");
      await expect(page.getByLabel("Recorded AI estimate", { exact: true })).toHaveCount(0);
    }
    await expect(page.getByLabel("AWS account estimate", { exact: true })).toContainText("$42.50");
    await expect(page.getByText("AWS account-wide; includes resources outside this app.")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await testInfo.attach(`costs-${mode}`, { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
    expect(pageErrors).toEqual([]);
  });
}

test("non-admin accounts do not render or request cost reports", async ({ page }) => {
  const requests = await fixtures(page, "nonadmin");
  await page.goto("/admin/dashboard");
  await expect(page.getByRole("heading", { name: "Administrator access required" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Costs" })).toHaveCount(0);
  expect(requests).toEqual([]);
});

test("signed-out visitors must sign in before the dashboard loads", async ({ page }) => {
  const requests = await fixtures(page, "signedout");
  await page.goto("/admin/dashboard");
  await expect(page).toHaveURL(/\/login\?redirect=/);
  await expect(page.getByRole("tab", { name: "Costs" })).toHaveCount(0);
  expect(requests).toEqual([]);
});

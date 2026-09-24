import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type Route, type TestInfo } from "@playwright/test";
import { API_BASE } from "./api";

const appOrigin = `http://127.0.0.1:${process.env.PORT ?? "3000"}`;

async function fulfillJson(route: Route, body: unknown, status = 200) {
  await route.fulfill({
    status,
    contentType: "application/json",
    headers: {
      "Access-Control-Allow-Origin": appOrigin,
      "Access-Control-Allow-Credentials": "true",
      "Access-Control-Allow-Headers": "Content-Type, X-Cw-Visitor, X-Cw-Session, X-Cw-Event-Id, X-Cw-Source, X-Cw-Medium, X-Cw-Campaign, X-Cw-Referrer",
      "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    },
    body: JSON.stringify(body),
  });
}

async function installOnboardingFixtures(page: Page) {
  const state = {
    signedIn: true,
    verified: false,
    required: true as boolean | undefined,
    email: "new-cook@example.com",
    failNextStatus: false,
    resendStatuses: [] as number[],
    resends: 0,
    registrations: [] as Array<{ email: string; password: string }>,
    deletions: [] as string[],
    privateRequests: [] as string[],
    unexpected: [] as string[],
  };
  const account = () => ({
    id: "00000000-0000-0000-0000-000000000017",
    email: state.email,
    email_verified: state.verified,
    email_verification_required: state.required,
    is_library_public: false,
    is_admin: false,
  });
  await page.addInitScript(() => localStorage.setItem("cooking-ui-language", "en"));
  // Every API request is intercepted; signup, resend and deletion use fake data only.
  await page.route(`${API_BASE}/**`, async (route) => {
    const request = route.request();
    const { pathname } = new URL(request.url());
    const method = request.method();
    if (method === "OPTIONS") return fulfillJson(route, {});
    if (pathname === "/analytics/events" && method === "POST") return fulfillJson(route, { ok: true }, 202);
    if (pathname === "/auth/me" && method === "GET") {
      if (state.failNextStatus) {
        state.failNextStatus = false;
        return route.abort("internetdisconnected");
      }
      return fulfillJson(route, state.signedIn ? account() : { detail: "Not authenticated" }, state.signedIn ? 200 : 401);
    }
    if (pathname === "/auth/register" && method === "POST") {
      const payload = request.postDataJSON();
      state.registrations.push(payload);
      state.email = payload.email;
      state.signedIn = true;
      return fulfillJson(route, account());
    }
    if (pathname === "/auth/login" && method === "POST") {
      state.signedIn = true;
      return fulfillJson(route, account());
    }
    if (pathname === "/auth/capabilities" && method === "GET") {
      return fulfillJson(route, { password_recovery: true, email_verification: true });
    }
    if (pathname === "/auth/email-verification/request" && method === "POST") {
      state.resends += 1;
      const status = state.resendStatuses.shift() ?? 200;
      return fulfillJson(route, status === 200 ? { ok: true } : { detail: "Email unavailable" }, status);
    }
    if (pathname === "/auth/logout" && method === "POST") {
      state.signedIn = false;
      return fulfillJson(route, { ok: true });
    }
    if (pathname === "/auth/account" && method === "DELETE") {
      const password = request.postDataJSON().password;
      state.deletions.push(password);
      if (password !== "sample-current-password") return fulfillJson(route, { detail: "Incorrect password" }, 403);
      state.signedIn = false;
      return fulfillJson(route, { ok: true });
    }
    if ((pathname === "/recipes/page" || pathname === "/recipes/catalog/page") && method === "GET") {
      state.privateRequests.push(pathname);
      return fulfillJson(route, { items: [], next_cursor: null });
    }
    state.unexpected.push(`${method} ${pathname}`);
    return route.abort("failed");
  });
  return state;
}

async function expectAccessiblePage(page: Page) {
  await page.evaluate(() => document.fonts.ready);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  expect(results.violations, JSON.stringify(results.violations)).toEqual([]);
}

async function attachReviewScreenshot(page: Page, testInfo: TestInfo, name: string) {
  const path = testInfo.outputPath(`${name}.png`);
  await page.screenshot({ path, fullPage: true, animations: "disabled" });
  await testInfo.attach(name, { path, contentType: "image/png" });
}

test("new registration explains verification and opens the recipient's inbox instructions before the app", async ({ page }, testInfo) => {
  const state = await installOnboardingFixtures(page);
  state.signedIn = false;
  await page.goto("/register?redirect=%2Flibrary%3Fview%3Dmine");
  await expect(page.getByText("We’ll email you a link to verify your address before you start using Chef World.")).toBeVisible();
  await page.getByLabel("Email", { exact: true }).fill("registration-cook@example.com");
  await page.getByLabel("Password", { exact: true }).fill("sample-signup-password");
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  await expect(page).toHaveURL(/\/check-email\?redirect=%2Flibrary%3Fview%3Dmine$/);
  await expect(page.getByRole("heading", { name: "Check your email", exact: true })).toBeVisible();
  await expect(page.getByText(/registration-cook@example\.com/)).toBeVisible();
  await expect(page.getByRole("link", { name: "Library", exact: true })).toHaveCount(0);
  expect(state.registrations).toEqual([{ email: "registration-cook@example.com", password: "sample-signup-password" }]);
  expect(state.resends).toBe(0);
  expect(state.privateRequests).toEqual([]);
  await expectAccessiblePage(page);
  await attachReviewScreenshot(page, testInfo, "signup-check-email");
  expect(state.unexpected).toEqual([]);
});

test("an account that requires verification cannot enter private screens but can manage its account", async ({ page }) => {
  const state = await installOnboardingFixtures(page);
  for (const path of ["/library", "/planner", "/shopping-list", "/cook", "/import"]) {
    await page.goto(path);
    await expect(page).toHaveURL(`${appOrigin}/check-email?redirect=${encodeURIComponent(path)}`);
    await expect(page.getByRole("heading", { name: "Check your email", exact: true })).toBeVisible();
  }
  expect(state.privateRequests).toEqual([]);
  await page.getByRole("link", { name: "Account settings", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Settings", exact: true })).toBeVisible();
  await expect(page.getByRole("checkbox", { name: "Share my library" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Add Recipe", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Delete account", exact: true })).toBeVisible();
  expect(state.unexpected).toEqual([]);
});

test("resend failures remain retryable without claiming delivery or unlocking the app", async ({ page }) => {
  const state = await installOnboardingFixtures(page);
  state.resendStatuses = [503, 200];
  await page.goto("/check-email");
  const resend = page.getByRole("button", { name: "Resend verification link", exact: true });
  await resend.click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("temporarily unavailable");
  await expect(page.getByRole("main").getByRole("status")).toHaveCount(0);
  await expect(resend).toBeEnabled();
  await resend.click();
  await expect(page.getByRole("main").getByRole("status")).toContainText("A verification link has been requested");
  await expect(page.getByRole("main").getByRole("alert")).toHaveCount(0);
  await expect(page).toHaveURL(/\/check-email$/);
  expect(state.resends).toBe(2);
  expect(state.privateRequests).toEqual([]);
  expect(state.unexpected).toEqual([]);
});

test("status checks recover from offline, keep unverified accounts waiting, and unlock only after server verification", async ({ page }) => {
  const state = await installOnboardingFixtures(page);
  await page.goto("/check-email?redirect=%2Flibrary%3Fview%3Dmine");
  const check = page.getByRole("button", { name: "I’ve verified my email", exact: true });
  await expect(check).toBeEnabled();
  state.failNextStatus = true;
  await check.click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("Check your connection");
  await check.click();
  await expect(page.getByRole("main").getByRole("status")).toContainText("not verified yet");
  expect(state.privateRequests).toEqual([]);
  state.verified = true;
  await check.click();
  await expect(page).toHaveURL(/\/library\?view=mine$/);
  await expect(page.getByRole("heading", { level: 1, name: "Recipe library", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Add Recipe", exact: true })).toBeVisible();
  expect(state.unexpected).toEqual([]);
});

test("legacy accounts without a verification requirement retain library access", async ({ page }) => {
  const state = await installOnboardingFixtures(page);
  for (const required of [false, undefined]) {
    state.required = required;
    await page.goto("/library");
    await expect(page.getByRole("heading", { level: 1, name: "Recipe library", exact: true })).toBeVisible();
    await expect(page).toHaveURL(/\/library$/);
  }
  expect(state.unexpected).toEqual([]);
});

test("verified onboarding redirects cannot remain on a hash or normalized onboarding URL", async ({ page }) => {
  const state = await installOnboardingFixtures(page);
  state.verified = true;
  for (const destination of ["/check-email#complete", "/previous/../check-email", "//outside.example/account"]) {
    await page.goto(`/check-email?redirect=${encodeURIComponent(destination)}`);
    await expect(page).toHaveURL(/\/library$/);
    await expect(page.getByRole("heading", { level: 1, name: "Recipe library", exact: true })).toBeVisible();
  }
  expect(state.unexpected).toEqual([]);
});

test("the account menu opens safe password confirmation, supports cancel, and requires a valid password", async ({ page }, testInfo) => {
  const state = await installOnboardingFixtures(page);
  await page.goto("/settings");
  const account = page.getByRole("button", { name: "Account for new-cook@example.com", exact: true });
  if (testInfo.project.name === "phone") await account.tap();
  else { await account.focus(); await page.keyboard.press("Enter"); }
  const menuDelete = page.getByRole("link", { name: "Delete account", exact: true });
  await expect(menuDelete).toHaveAttribute("href", "/settings?delete=1#delete-account");
  await expect(menuDelete).toBeVisible();
  await attachReviewScreenshot(page, testInfo, "open-account-menu");
  if (testInfo.project.name === "phone") await menuDelete.tap();
  else {
    for (let step = 0; step < 8 && !await menuDelete.evaluate((element) => element === document.activeElement); step += 1) await page.keyboard.press("Tab");
    await expect(menuDelete).toBeFocused();
    await page.keyboard.press("Enter");
  }
  const confirmation = page.getByRole("form", { name: "Delete account", exact: true });
  await expect(confirmation).toBeVisible();
  await expect(confirmation).toBeFocused();
  await attachReviewScreenshot(page, testInfo, "delete-account-confirmation");
  const permanentDelete = page.getByRole("button", { name: "Delete account permanently", exact: true });
  await expect(permanentDelete).toBeDisabled();
  expect(state.deletions).toEqual([]);
  await page.getByLabel("Current password", { exact: true }).fill("cancelled-password");
  await page.getByRole("checkbox", { name: "I understand that account deletion is permanent." }).check();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(confirmation).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Delete account", exact: true })).toBeFocused();
  expect(state.deletions).toEqual([]);
  await account.click();
  await menuDelete.click();
  await expect(page.getByLabel("Current password", { exact: true })).toHaveValue("");
  await expect(page.getByRole("checkbox", { name: "I understand that account deletion is permanent." })).not.toBeChecked();
  await page.getByLabel("Current password", { exact: true }).fill("wrong-password");
  await page.getByRole("checkbox", { name: "I understand that account deletion is permanent." }).check();
  await permanentDelete.click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("account has not been deleted");
  await page.getByLabel("Current password", { exact: true }).fill("sample-current-password");
  await permanentDelete.click();
  await expect(page).toHaveURL(/\/login(?:\?|$)/);
  await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();
  expect(state.deletions).toEqual(["wrong-password", "sample-current-password"]);
  expect(state.unexpected).toEqual([]);
});

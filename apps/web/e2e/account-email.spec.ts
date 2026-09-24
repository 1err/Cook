import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type Route } from "@playwright/test";
import { API_BASE } from "./api";

const appOrigin = `http://127.0.0.1:${process.env.PORT ?? "3000"}`;
const invalidLink = "This link is invalid, expired, or has already been used. Please request a new link.";
const resetAcknowledgement = "If an account exists for this email, a reset link will arrive shortly. Check your spam folder too.";

async function fulfillJson(route: Route, body: unknown, status = 200) {
  await route.fulfill({
    status,
    contentType: "application/json",
    headers: {
      "Access-Control-Allow-Origin": appOrigin,
      "Access-Control-Allow-Credentials": "true",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    },
    body: JSON.stringify(body),
  });
}

async function installAccountFixtures(page: Page, signedIn = true) {
  const state = { verified: false, authReads: 0, failRefresh: false, unexpected: [] as string[] };
  await page.addInitScript(() => localStorage.setItem("cooking-ui-language", "en"));
  // Catch the whole API origin so every email/account action stays provider-free.
  await page.route(`${API_BASE}/**`, async (route) => {
    const request = route.request();
    const { pathname } = new URL(request.url());
    if (request.method() === "OPTIONS") {
      await fulfillJson(route, {});
    } else if (pathname === "/auth/me" && request.method() === "GET") {
      state.authReads += 1;
      if (state.failRefresh) await route.abort("failed");
      else await fulfillJson(route, signedIn ? {
        id: "00000000-0000-0000-0000-000000000009",
        email: "recovery-cook@example.com",
        is_library_public: false,
        email_verified: state.verified,
      } : { detail: "Not authenticated" }, signedIn ? 200 : 401);
    } else if (pathname === "/auth/capabilities" && request.method() === "GET") {
      await fulfillJson(route, { password_recovery: true, email_verification: true });
    } else if ((pathname === "/recipes/page" || pathname === "/recipes/catalog/page") && request.method() === "GET") {
      await fulfillJson(route, { items: [], next_cursor: null });
    } else {
      state.unexpected.push(`${request.method()} ${pathname}`);
      await route.abort("failed");
    }
  });
  return state;
}

async function expectAccessibleRecovery(page: Page) {
  await page.evaluate(() => document.fonts.ready);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  expect(results.violations, JSON.stringify(results.violations)).toEqual([]);
}

test("a missing verification link offers account settings and preserves the sign-in destination", async ({ page }) => {
  const state = await installAccountFixtures(page, false);
  await page.goto("/verify-email");
  await expect(page.getByRole("main").getByRole("alert")).toHaveText(invalidLink);
  await expect(page.getByText("Request a new verification link from account settings. Sign in first if needed.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Verify email", exact: true })).toHaveCount(0);
  await expectAccessibleRecovery(page);
  await page.getByRole("link", { name: "Account settings", exact: true }).click();
  await expect(page).toHaveURL(/\/login\?redirect=%2Fsettings$/);
  expect(state.unexpected).toEqual([]);
});

test("an expired verification link ends the form and keeps account settings reachable", async ({ page }) => {
  const state = await installAccountFixtures(page);
  const tokens: string[] = [];
  await page.route(`${API_BASE}/auth/email-verification/confirm`, async (route) => {
    tokens.push(route.request().postDataJSON().token);
    await fulfillJson(route, { detail: "Invalid or expired token" }, 400);
  });
  await page.goto("/verify-email#token=expired-verification-token");
  const verify = page.getByRole("button", { name: "Verify email", exact: true });
  await expect(verify).toBeEnabled();
  await expect(page).toHaveURL(/\/verify-email$/);
  expect(tokens).toEqual([]);
  await verify.click();
  await expect(page.getByRole("main").getByRole("alert")).toHaveText(invalidLink);
  await expect(verify).toHaveCount(0);
  await expect(page.locator("main form")).toHaveCount(0);
  await page.getByRole("link", { name: "Account settings", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Settings", exact: true })).toBeVisible();
  await expect(page.getByText("Email not verified", { exact: true })).toBeVisible();
  expect(tokens).toEqual(["expired-verification-token"]);
  expect(state.unexpected).toEqual([]);
});

test("verification retries offline with the captured token, shows progress and refreshes account status", async ({ page }) => {
  const state = await installAccountFixtures(page);
  const tokens: string[] = [];
  let finishVerification!: () => void;
  const responseGate = new Promise<void>((resolve) => { finishVerification = resolve; });
  await page.route(`${API_BASE}/auth/email-verification/confirm`, async (route) => {
    tokens.push(route.request().postDataJSON().token);
    if (tokens.length === 1) return route.abort("internetdisconnected");
    await responseGate;
    state.verified = true;
    await fulfillJson(route, { ok: true });
  });
  await page.goto("/verify-email#token=retry-verification-token");
  await expect.poll(() => state.authReads).toBe(1);
  const verify = page.getByRole("button", { name: "Verify email", exact: true });
  await expect(verify).toBeEnabled();
  await expect(page).toHaveURL(/\/verify-email$/);
  expect(tokens).toEqual([]);
  await verify.click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("Check your connection");
  await expect(verify).toBeEnabled();
  await verify.click();
  try {
    await expect(page.getByRole("button", { name: "Verifying…", exact: true })).toBeDisabled();
    await expect(page.locator("main form")).toHaveAttribute("aria-busy", "true");
    await expect.poll(() => tokens).toEqual(["retry-verification-token", "retry-verification-token"]);
  } finally {
    finishVerification();
  }
  await expect(page.getByRole("status")).toContainText("Email verified. You can return to Chef World.");
  await expect(verify).toHaveCount(0);
  await expect(page.getByRole("main").getByRole("alert")).toHaveCount(0);
  await expect.poll(() => state.authReads).toBe(2);
  await expect(page.getByRole("link", { name: "Continue to Chef World", exact: true })).toHaveAttribute("href", "/library");
  await page.getByRole("link", { name: "Continue to Chef World", exact: true }).hover();
  await expectAccessibleRecovery(page);
  await page.getByRole("link", { name: "Account settings", exact: true }).click();
  await expect(page.getByText("Email verified", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Verify email", exact: true })).toHaveCount(0);
  expect(state.unexpected).toEqual([]);
});

test("an account refresh outage does not undo completed verification or reuse its token", async ({ page }) => {
  const state = await installAccountFixtures(page);
  let confirmations = 0;
  await page.route(`${API_BASE}/auth/email-verification/confirm`, async (route) => {
    confirmations += 1;
    state.failRefresh = true;
    await fulfillJson(route, { ok: true });
  });
  await page.goto("/verify-email#token=completed-verification-token");
  await expect.poll(() => state.authReads).toBe(1);
  await page.getByRole("button", { name: "Verify email", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Email verified");
  await expect.poll(() => state.authReads).toBe(2);
  await expect(page.getByRole("button", { name: "Verify email", exact: true })).toHaveCount(0);
  await expect(page.getByRole("main").getByRole("alert")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Account settings", exact: true })).toHaveAttribute("href", "/settings");
  await page.getByRole("link", { name: "Continue to Chef World", exact: true }).click();
  await expect(page).toHaveURL(/\/library$/);
  await expect(page.getByRole("heading", { level: 1, name: "Recipe library", exact: true })).toBeVisible();
  expect(confirmations).toBe(1);
  expect(state.unexpected).toEqual([]);
});

test("reset requests acknowledge known and unknown sample emails identically", async ({ page }) => {
  const state = await installAccountFixtures(page, false);
  const emails: string[] = [];
  await page.route(`${API_BASE}/auth/password-reset/request`, async (route) => {
    emails.push(route.request().postDataJSON().email);
    await fulfillJson(route, { ok: true });
  });
  for (const email of ["recovery-cook@example.com", "unknown-cook@example.com"]) {
    await page.goto("/forgot-password");
    await page.getByLabel("Email", { exact: true }).fill(email);
    await page.getByRole("button", { name: "Send reset link", exact: true }).click();
    await expect(page.getByRole("status")).toHaveText(resetAcknowledgement);
    await expect(page.getByLabel("Email", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Sign in", exact: true })).toHaveAttribute("href", "/login");
  }
  expect(emails).toEqual(["recovery-cook@example.com", "unknown-cook@example.com"]);
  expect(state.unexpected).toEqual([]);
});

test("a failed reset request keeps the email and allows one explicit retry", async ({ page }) => {
  const state = await installAccountFixtures(page, false);
  const emails: string[] = [];
  await page.route(`${API_BASE}/auth/password-reset/request`, async (route) => {
    emails.push(route.request().postDataJSON().email);
    if (emails.length === 1) await route.abort("internetdisconnected");
    else await fulfillJson(route, { ok: true });
  });
  await page.goto("/forgot-password");
  await page.getByLabel("Email", { exact: true }).fill("retry-cook@example.com");
  await page.getByRole("button", { name: "Send reset link", exact: true }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("Check your connection");
  await expect(page.getByLabel("Email", { exact: true })).toHaveValue("retry-cook@example.com");
  await expectAccessibleRecovery(page);
  expect(emails).toEqual(["retry-cook@example.com"]);
  await page.getByRole("button", { name: "Send reset link", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText(resetAcknowledgement);
  expect(emails).toEqual(["retry-cook@example.com", "retry-cook@example.com"]);
  expect(state.unexpected).toEqual([]);
});

test("unavailable email capabilities can be checked again without claiming a link was sent", async ({ page }) => {
  const state = await installAccountFixtures(page, false);
  let reads = 0;
  await page.route(`${API_BASE}/auth/capabilities`, async (route) => {
    reads += 1;
    await fulfillJson(route, { password_recovery: reads > 1, email_verification: reads > 1 });
  });
  await page.goto("/forgot-password");
  await expect(page.getByRole("main").getByRole("alert")).toContainText("temporarily unavailable");
  await expect(page.getByRole("button", { name: "Send reset link", exact: true })).toHaveCount(0);
  await expect(page.getByText(resetAcknowledgement, { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(page.getByLabel("Email", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Send reset link", exact: true })).toBeEnabled();
  expect(reads).toBe(2);
  expect(state.unexpected).toEqual([]);
});

test("password confirmation can be corrected without losing the captured reset link", async ({ page }) => {
  const state = await installAccountFixtures(page, false);
  const confirmations: Array<{ token: string; password: string }> = [];
  await page.route(`${API_BASE}/auth/password-reset/confirm`, async (route) => {
    confirmations.push(route.request().postDataJSON());
    await fulfillJson(route, { ok: true });
  });
  await page.goto("/reset-password#token=sample-reset-token");
  await page.getByLabel("New password", { exact: true }).fill("sample-password-123");
  await page.getByLabel("Confirm password", { exact: true }).fill("different-password-123");
  await expect(page).toHaveURL(/\/reset-password$/);
  await page.getByRole("button", { name: "Set new password", exact: true }).click();
  await expect(page.getByRole("main").getByRole("alert")).toHaveText("Passwords do not match.");
  expect(confirmations).toEqual([]);
  await page.getByLabel("Confirm password", { exact: true }).fill("sample-password-123");
  await page.getByRole("button", { name: "Set new password", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Sign in with your new password");
  await expect(page.getByLabel("New password", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Sign in", exact: true })).toHaveAttribute("href", "/login");
  await page.getByRole("link", { name: "Sign in", exact: true }).hover();
  await expectAccessibleRecovery(page);
  expect(confirmations).toEqual([{ token: "sample-reset-token", password: "sample-password-123" }]);
  expect(state.unexpected).toEqual([]);
});

for (const [path, heading, action] of [
  ["/forgot-password", "Forgot password?", "Send reset link"],
  ["/reset-password#token=layout-reset-token", "Set new password", "Set new password"],
  ["/verify-email#token=layout-verification-token", "Verify email", "Verify email"],
] as const) {
  test(`${heading} has an accessible recovery layout without horizontal overflow`, async ({ page }) => {
    const state = await installAccountFixtures(page, false);
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1, name: heading, exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: action, exact: true })).toBeEnabled();
    await expect(page.getByRole("link", { name: "Back to sign in", exact: true })).toHaveAttribute("href", "/login");
    await expectAccessibleRecovery(page);
    expect(state.unexpected).toEqual([]);
  });
}

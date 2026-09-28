import { expect, test, type Locator, type Page, type Route } from "@playwright/test";
import { API_BASE } from "./api";
import { recipePageFixture } from "./recipePageFixture";

const appOrigin = `http://127.0.0.1:${process.env.PORT ?? "3000"}`;
const friendEmail = "friend@example.com";

async function fulfillJson(route: Route, body: unknown, status = 200) {
  await route.fulfill({
    status,
    contentType: "application/json",
    headers: {
      "Access-Control-Allow-Origin": appOrigin,
      "Access-Control-Allow-Credentials": "true",
    },
    body: JSON.stringify(body),
  });
}

async function installFriendsFixtures(page: Page) {
  const searches: string[] = [];
  const mutations: string[] = [];
  await page.route(`${API_BASE}/**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === "POST" && url.pathname === "/analytics/events") {
      await fulfillJson(route, { ok: true }, 202);
      return;
    }
    if (request.method() !== "GET") {
      mutations.push(`${request.method()} ${url.pathname}`);
      await route.abort();
      return;
    }
    if (url.pathname === "/auth/me") {
      await fulfillJson(route, { id: "viewer-1", email: "viewer@example.com", is_library_public: false });
    } else if (url.pathname === "/users/search") {
      const email = url.searchParams.get("email") ?? "";
      searches.push(email);
      await fulfillJson(route,
        email === friendEmail ? { id: "friend-1", email: friendEmail } : { detail: "Not found" },
        email === friendEmail ? 200 : 404,
      );
    } else if (url.pathname === "/users/friend-1/recipes/page") {
      await fulfillJson(route, recipePageFixture([{
        id: "shared-tofu",
        title: "Soy-glazed tofu",
        description: "A quick shared dinner.",
        thumbnail_url: null,
        ingredients: [{ name: "Tofu", quantity: "1 block", metric_quantity: "400 g", notes: "" }],
        library_tags: ["weeknight"],
        total_time_minutes: 20,
      }], request.url()));
    } else if (url.pathname === "/auth/capabilities") {
      await fulfillJson(route, { password_recovery: false, email_verification: false });
    } else if (url.pathname === "/recipes/page" || url.pathname === "/recipes/catalog/page") {
      await fulfillJson(route, recipePageFixture([], request.url()));
    } else {
      await route.abort();
    }
  });
  return { searches, mutations };
}

async function expectNoOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    await page.evaluate(() => window.innerWidth),
  );
}

async function libraryHeaderGeometry(page: Page) {
  const tabs = page.getByRole("tablist", { name: "Library views", exact: true });
  const elements: Record<string, Locator> = {
    heading: page.getByRole("heading", { level: 1, name: "Recipe library", exact: true }),
    subtitle: page.getByText("A little inspiration for your next meal.", { exact: true }),
    tabs,
    mine: tabs.getByRole("tab", { name: "My library", exact: true }),
    public: tabs.getByRole("tab", { name: "Public library", exact: true }),
    friends: tabs.getByRole("tab", { name: "Friends", exact: true }),
  };
  await expect(elements.heading).toBeVisible();
  await expect(elements.subtitle).toBeVisible();
  await page.evaluate(async () => { await document.fonts.ready; });
  return Promise.all(Object.entries(elements).map(async ([name, element]) => {
    await expect(element).toBeVisible();
    return {
      name,
      ...await element.evaluate((node) => {
        const { x, y, width, height } = node.getBoundingClientRect();
        return { x, y, width, height };
      }),
    };
  }));
}

test("keeps the library heading, subtitle, and tabs aligned when opening Friends", async ({ page }) => {
  const { mutations } = await installFriendsFixtures(page);
  await page.goto("/library");
  const libraryGeometry = await libraryHeaderGeometry(page);
  await expect(page.getByRole("button", { name: "Make a menu", exact: true })).toBeVisible();
  await expect(page.getByRole("tab", { name: "My library", exact: true })).toHaveAttribute("aria-selected", "true");

  await page.getByRole("tab", { name: "Friends", exact: true }).click();
  await expect(page).toHaveURL(/\/library\/friends$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  await expect(page.getByRole("heading", { level: 2, name: "Find a friend", exact: true })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Friends", exact: true })).toHaveAttribute("aria-selected", "true");
  const friendsGeometry = await libraryHeaderGeometry(page);
  await expect(page.getByRole("button", { name: "Make a menu", exact: true })).toHaveCount(0);
  // The My Library action narrows the title on phones, so text may wrap.
  // Keep the shared left edge and vertical spacing through that natural reflow.
  const [libraryHeading, librarySubtitle, libraryTabs] = libraryGeometry;
  const [friendsHeading, friendsSubtitle, friendsTabs] = friendsGeometry;
  expect(Math.abs(friendsHeading.y - libraryHeading.y)).toBeLessThanOrEqual(1);
  const subtitleGap = (heading: typeof libraryHeading, subtitle: typeof librarySubtitle) =>
    subtitle.y - (heading.y + heading.height);
  const tabsGap = (subtitle: typeof librarySubtitle, tabs: typeof libraryTabs) =>
    tabs.y - (subtitle.y + subtitle.height);
  expect(Math.abs(subtitleGap(libraryHeading, librarySubtitle) - subtitleGap(friendsHeading, friendsSubtitle))).toBeLessThanOrEqual(1);
  expect(Math.abs(tabsGap(librarySubtitle, libraryTabs) - tabsGap(friendsSubtitle, friendsTabs))).toBeLessThanOrEqual(1);
  for (const [index, before] of libraryGeometry.entries()) {
    const after = friendsGeometry[index];
    expect(after.name).toBe(before.name);
    expect(Math.abs(after.x - before.x), `${before.name} left edge should stay aligned`).toBeLessThanOrEqual(1);
    if (["heading", "subtitle"].includes(before.name)) continue;
    expect(Math.abs(after.height - before.height), `${before.name} height should stay aligned`).toBeLessThanOrEqual(1);
    expect(Math.abs((after.y - friendsTabs.y) - (before.y - libraryTabs.y)), `${before.name} should stay aligned with its tab row`).toBeLessThanOrEqual(1);
    if (before.name === "tabs") expect(Math.abs(after.width - before.width)).toBeLessThanOrEqual(1);
  }
  await expectNoOverflow(page);
  expect(mutations).toEqual([]);
});

test("finds a shared library after a private or missing result and opens its recipes", async ({ page }) => {
  const { searches, mutations } = await installFriendsFixtures(page);
  await page.goto("/library/friends");
  await expect(page.getByRole("heading", { level: 1, name: "Recipe library", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "Find a friend", exact: true })).toBeVisible();
  await expect(page.getByText("No public library found", { exact: true })).toHaveCount(0);
  await expectNoOverflow(page);

  await page.getByLabel("Email address").fill("private@example.com");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("No public library found");
  await expect(page.getByRole("status")).toContainText("haven't shared their library");
  await expectNoOverflow(page);

  await page.getByLabel("Email address").fill(friendEmail);
  await page.getByRole("button", { name: "Search", exact: true }).click();
  const result = page.getByRole("link", { name: new RegExp(friendEmail.replaceAll(".", "\\.")) });
  await expect(result).toBeVisible();
  await expect(result).toContainText("Shared recipe library");
  await expect(result).toHaveAttribute("href", "/library/friends/friend-1?email=friend%40example.com");
  await expect(page.getByText("No public library found", { exact: true })).toHaveCount(0);
  await expectNoOverflow(page);

  const libraryRequest = page.waitForRequest((request) => new URL(request.url()).pathname === "/users/friend-1/recipes/page");
  await result.click();
  await libraryRequest;
  await expect(page).toHaveURL(/\/library\/friends\/friend-1\?email=friend%40example\.com$/);
  await expect(page.getByRole("heading", { name: `${friendEmail}'s library`, exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Soy-glazed tofu", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Add to library", exact: true })).toBeEnabled();
  await expectNoOverflow(page);
  expect(searches).toEqual(["private@example.com", friendEmail]);
  expect(mutations).toEqual([]);
});

test("opens sharing settings without changing library visibility", async ({ page }) => {
  const { mutations } = await installFriendsFixtures(page);
  await page.goto("/library/friends");
  const sharingSettings = page.getByRole("link", { name: /Library sharing settings/ });
  await expect(sharingSettings).toHaveAttribute("href", "/settings");
  await sharingSettings.click();
  await expect(page).toHaveURL(/\/settings$/);
  await expect(page.getByRole("heading", { name: "Settings", exact: true })).toBeVisible();
  await expect(page.getByRole("checkbox", { name: "Share my library", exact: true })).not.toBeChecked();
  await expectNoOverflow(page);
  expect(mutations).toEqual([]);
});

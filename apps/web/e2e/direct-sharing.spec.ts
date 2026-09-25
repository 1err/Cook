import { expect, test, type Page } from "@playwright/test";
import { API_BASE } from "./api";

const USER_ID = "share-test-user";
const VIDEO_BYTES = "synthetic shared video bytes";
const SOURCE_LABEL = "YouTube, TikTok, or RedNote URL";
const RECIPE = {
  id: "shared-draft",
  title: "擂辣椒烧排骨",
  ingredients: [{ name: "排骨", quantity: "500克" }],
  steps: [{ id: "step-1", text: "排骨炒香。", duration_seconds: 120 }],
  tips: [], equipment: [], library_tags: [],
};

async function mockImportApi(page: Page, signedIn = true) {
  const state = { signedIn, uploads: [] as string[], linkImports: [] as Record<string, unknown>[] };
  const user = { id: USER_ID, email: "share@example.com", is_library_public: false,
    email_verified: true, email_verification_required: true };
  const origin = new URL(test.info().project.use.baseURL as string).origin;
  await page.route(`${API_BASE}/**`, async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const headers = { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Credentials": "true" };
    if (request.method() === "OPTIONS") {
      await route.fulfill({ status: 204, headers: { ...headers,
        "Access-Control-Allow-Headers": request.headers()["access-control-request-headers"] || "content-type",
        "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS" } });
      return;
    }
    if (path === "/auth/login") {
      state.signedIn = true;
      await route.fulfill({ headers, json: user });
    } else if (path === "/auth/me") {
      await route.fulfill({ status: state.signedIn ? 200 : 401, headers,
        json: state.signedIn ? user : { detail: "Sign in" } });
    } else if (path === "/recipes/import-capabilities") {
      await route.fulfill({ headers, json: { video_analysis: true, media_upload: true, max_media_bytes: 30 * 1024 * 1024 } });
    } else if (path === "/recipes/import-jobs/media") {
      state.uploads.push(request.postDataBuffer()?.toString() ?? "");
      await route.fulfill({ headers, json: { id: "media-job", status: "completed", recipe: RECIPE } });
    } else if (path === "/recipes/import-jobs") {
      state.linkImports.push(request.postDataJSON() as Record<string, unknown>);
      await route.fulfill({ headers, json: { id: "link-job", status: "completed", recipe: RECIPE } });
    } else {
      await route.fulfill({ headers, json: {} });
    }
  });
  return state;
}

async function expectCompactSourceLayout(page: Page) {
  await expect(page.getByRole("button", { name: "Create recipe manually", exact: true })).toBeVisible();
  await expect(page.getByRole("tab")).toHaveText(["Video link", "Upload video", "Paste recipe text"]);
  const dimensions = await page.evaluate(() => ({
    width: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.width + 1);
}

async function shareIntoWebsite(page: Page, { text = "", title = "", video = false } = {}) {
  await page.waitForFunction(async () => {
    const registration = await navigator.serviceWorker.getRegistration();
    return registration?.active?.state === "activated" && Boolean(navigator.serviceWorker.controller);
  }, undefined, { timeout: 10_000 });
  await page.evaluate(async (payload) => {
    const form = document.createElement("form");
    form.action = "/share-target";
    form.method = "POST";
    form.enctype = "multipart/form-data";
    for (const name of ["title", "text"] as const) {
      const input = document.createElement("input");
      input.name = name;
      input.value = payload[name];
      form.append(input);
    }
    if (payload.video) {
      const transfer = new DataTransfer();
      transfer.items.add(new File([payload.bytes], "排骨.mp4", { type: "video/mp4" }));
      const input = document.createElement("input");
      input.type = "file";
      input.name = "video";
      input.files = transfer.files;
      form.append(input);
    }
    document.body.append(form);
    form.submit();
  }, { title, text, video, bytes: VIDEO_BYTES });
}

test("manual video upload keeps the existing import layout and creates a reviewable draft", async ({ page }) => {
  const state = await mockImportApi(page);
  await page.goto("/import");
  await expect(page.getByRole("heading", { name: "Import recipe", exact: true })).toBeVisible();
  await expectCompactSourceLayout(page);
  await page.getByRole("tab", { name: "Upload video", exact: true }).click();
  await expect(page.getByText("Maximum file size: 30 MB.", { exact: true })).toBeVisible();
  await page.getByLabel("Upload video", { exact: true }).setInputFiles({
    name: "recipe.mp4", mimeType: "video/mp4", buffer: Buffer.from(VIDEO_BYTES),
  });
  await expect(page.getByText("Selected: recipe.mp4", { exact: true })).toBeVisible();
  expect(state.uploads).toHaveLength(0);
  await expectCompactSourceLayout(page);
  await page.screenshot({ path: test.info().outputPath("manual-video-import.png"), fullPage: true });
  await page.getByRole("button", { name: "Create draft", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Review recipe", exact: true })).toBeVisible();
  expect(state.uploads).toHaveLength(1);
  expect(state.uploads[0]).toContain('name="file"; filename="recipe.mp4"');
  expect(state.uploads[0]).toContain(VIDEO_BYTES);
  await expect(page.getByLabel("Recipe title", { exact: true })).toHaveValue(RECIPE.title);
});

test("manual upload accepts a video above the old limit and blocks one byte above 30MiB", async ({ page }) => {
  const state = await mockImportApi(page);
  await page.goto("/import");
  await page.getByRole("tab", { name: "Upload video", exact: true }).click();
  const picker = page.getByLabel("Upload video", { exact: true });
  await picker.setInputFiles({ name: "recipe-15mb.mp4", mimeType: "video/mp4", buffer: Buffer.alloc(15 * 1024 * 1024) });
  await expect(page.getByText("Selected: recipe-15mb.mp4", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Create draft", exact: true })).toBeEnabled();

  await picker.setInputFiles({ name: "recipe-too-large.mp4", mimeType: "video/mp4", buffer: Buffer.alloc(30 * 1024 * 1024 + 1) });
  await expect(page.getByRole("alert")).toHaveText("This file exceeds the upload limit. Choose a shorter or smaller file.");
  await expect(page.getByRole("button", { name: "Create draft", exact: true })).toBeDisabled();
  expect(state.uploads).toHaveLength(0);
});

test("full copied RedNote share text submits without changing the one-line source layout", async ({ page }) => {
  const state = await mockImportApi(page);
  const sourceUrl = "https://www.xiaohongshu.com/discovery/item/69eaf618000000001a035987?source=webshare&xsec_token=fixture_token&xsec_source=pc_share";
  const shareText = `63 【擂辣椒烧排骨 - 村驴 | 小红书】 😆 ${sourceUrl}`;
  await page.goto("/import");
  await page.getByLabel(SOURCE_LABEL, { exact: true }).fill(shareText);
  await expectCompactSourceLayout(page);
  await expect(page.getByLabel(SOURCE_LABEL, { exact: true })).toHaveValue(shareText);
  expect(state.linkImports).toHaveLength(0);
  await page.screenshot({ path: test.info().outputPath("rednote-link-import.png"), fullPage: true });
  await page.getByRole("button", { name: "Create draft", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Review recipe", exact: true })).toBeVisible();
  expect(state.linkImports).toEqual([expect.objectContaining({ mode: "link", url: sourceUrl })]);
});

test("a shared video survives sign-in, imports without a picker, and clears its temporary copy", async ({ page }) => {
  const state = await mockImportApi(page, false);
  const sourceUrl = "https://xhslink.com/a/SharedRecipe";
  await page.goto("/import");
  await expect(page).toHaveURL(/\/login\?/);
  await expect(page.getByLabel("Email", { exact: true })).toBeVisible();
  await shareIntoWebsite(page, { text: sourceUrl, video: true });
  await expect(page).toHaveURL(/\/login\?redirect=.*share/);
  const origin = new URL(page.url()).origin;
  const redirect = new URL(page.url()).searchParams.get("redirect")!;
  const shareId = new URL(redirect, origin).searchParams.get("share")!;
  expect(shareId).toMatch(/^[\da-f-]{36}$/i);
  await expect(page.getByRole("link", { name: "Create an account", exact: true }))
    .toHaveAttribute("href", `/register?redirect=${encodeURIComponent(redirect)}`);
  await page.getByLabel("Email", { exact: true }).fill("share@example.com");
  await page.getByLabel("Password", { exact: true }).fill("fixture-password-only");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByText("Shared video ready. Choose Create draft to continue.", { exact: true })).toBeVisible();
  await expect(page.getByText("Selected: 排骨.mp4", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Upload video", { exact: true })).toHaveValue("");
  await expectCompactSourceLayout(page);
  expect(state.uploads).toHaveLength(0);
  await page.getByRole("button", { name: "Create draft", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Review recipe", exact: true })).toBeVisible();
  expect(state.uploads).toHaveLength(1);
  expect(state.uploads[0]).toContain(VIDEO_BYTES);
  expect(state.uploads[0]).toContain('name="source_url"');
  expect(state.uploads[0]).toContain(sourceUrl);
  expect(new URL(page.url()).searchParams.has("share")).toBe(false);
  await expect.poll(async () => page.evaluate(async ({ id, ownerId }) => {
    const registration = await navigator.serviceWorker.ready;
    return await new Promise<{ ok: boolean; error?: string }>((resolve) => {
      const channel = new MessageChannel();
      channel.port1.onmessage = (event) => { channel.port1.close(); resolve(event.data); };
      registration.active!.postMessage({ type: "chefworld:get-share", id, ownerId }, [channel.port2]);
    });
  }, { id: shareId, ownerId: USER_ID })).toMatchObject({ ok: false, error: "expired" });
});

test("an Android title-field link opens ready for review and can be discarded", async ({ page }) => {
  const state = await mockImportApi(page);
  await page.goto("/import");
  await expect(page.getByRole("heading", { name: "Import recipe", exact: true })).toBeVisible();
  await shareIntoWebsite(page, { title: "http://xhslink.com/a/SharedRecipe" });
  await expect(page.getByLabel(SOURCE_LABEL, { exact: true })).toHaveValue("https://xhslink.com/a/SharedRecipe");
  await expectCompactSourceLayout(page);
  expect(state.linkImports).toHaveLength(0);
  await page.getByRole("button", { name: "Discard shared item", exact: true }).click();
  await expect(page.getByLabel(SOURCE_LABEL, { exact: true })).toHaveValue("");
  expect(new URL(page.url()).searchParams.has("share")).toBe(false);
});

import { expect, test, type Page, type Route } from "@playwright/test";
import type { Recipe, RecipeAuthor } from "@cooking/shared";

const author: RecipeAuthor = { id: "author-1", name: "Lin", aliases: ["阿林"] };
const other: RecipeAuthor = { id: "author-2", name: "Ming", aliases: ["小明"] };
function thumbnail(height: number) {
  return `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="640" height="${height}"><rect width="640" height="${height}" fill="#a85136"/></svg>`)}`;
}
async function fixtures(page: Page) {
  const rows: Recipe[] = [author, other, author, null].map((credit, index) => ({
    id: `recipe-${index + 1}`, title: index < 2 ? "Noodles" : index === 2 ? "Braised tofu" : "Scallion eggs",
    ingredients: [{ name: "Tofu", quantity: "1 block" }], library_tags: ["chinese"],
    thumbnail_url: thumbnail([850, 400, 650, 300][index]), total_time_minutes: 45,
    author_id: credit?.id ?? null, author: credit,
    steps: [{ id: `step-${index}`, text: "Serve warm.", duration_seconds: 60, duration_source: "user" }],
  }));
  const listRequests: URLSearchParams[] = [];
  const writes: unknown[] = [];
  await page.route("**/*", async route => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    const apiRequest = /^(auth|recipes|cooking-session|meal-plans|analytics)(\/|$)/.test(path.slice(1)) || ["8000", "8842"].includes(url.port);
    if (!apiRequest) return route.continue();
    const json = async (body: unknown, status = 200) => route.fulfill({ status, contentType: "application/json",
      headers: { "Access-Control-Allow-Origin": new URL(page.url() === "about:blank" ? "http://127.0.0.1:3842" : page.url()).origin, "Access-Control-Allow-Credentials": "true" }, body: JSON.stringify(body) });
    if (route.request().method() === "OPTIONS") return json({});
    if (path === "/auth/me") return json({ id: "preview-user", email: "preview@example.com", is_library_public: false });
    if (path === "/recipes/authors") return json([author, other].filter(credit => [credit.name, ...credit.aliases].some(value => value.toLowerCase().includes((url.searchParams.get("q") ?? "").toLowerCase()))));
    if (path === "/recipes/page") {
      listRequests.push(url.searchParams);
      const q = (url.searchParams.get("q") ?? "").toLowerCase();
      const filtered = rows.filter(row => (!url.searchParams.get("author_id") || row.author_id === url.searchParams.get("author_id"))
        && url.searchParams.getAll("tags").every(tag => row.library_tags?.includes(tag as never))
        && [row.title, row.author?.name ?? "", ...(row.author?.aliases ?? [])].some(value => value.toLowerCase().includes(q)));
      const start = Number(url.searchParams.get("cursor") ?? 0);
      const items = filtered.slice(start, start + 2).map(({ ingredients, steps, ...row }) => ({ ...row, ingredient_count: ingredients.length, step_count: steps?.length ?? 0, already_saved: false }));
      return json({ items, next_cursor: start + 2 < filtered.length ? String(start + 2) : null });
    }
    const recipe = rows.find(row => path === `/recipes/${row.id}`);
    if (recipe) {
      if (route.request().method() === "PATCH") {
        const payload = route.request().postDataJSON(); writes.push(payload);
        Object.assign(recipe, payload, { author: [author, other].find(credit => credit.id === payload.author_id) ?? null });
      }
      return json(recipe);
    }
    if (path === "/recipes") return json(rows);
    if (path === "/recipes/catalog/editor-status") return json({ can_manage: false });
    if (path.startsWith("/cooking-session/")) return json(null);
    return json({});
  });
  return { rows, listRequests, writes };
}

async function healthy(page: Page, errors: string[]) {
  await expect(page.locator("body")).not.toBeEmpty();
  await expect(page.getByRole("dialog", { name: /Runtime|Error/i })).toHaveCount(0);
  await expect(page).toHaveTitle(/Chef World/);
  expect(errors).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

test("creator credits and composed server filters preserve waterfall images", async ({ page }, testInfo) => {
  const { listRequests } = await fixtures(page);
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  await page.goto("/library");
  const list = page.getByRole("list");
  await expect(list).toHaveAttribute("data-layout", "masonry");
  await expect(list.getByRole("listitem")).toHaveCount(2);
  await page.getByRole("button", { name: "Load more recipes" }).click();
  await expect(list.getByRole("listitem")).toHaveCount(4);
  const images = await list.locator("img").evaluateAll(items => items.map(image => ({ width: image.getBoundingClientRect().width,
    height: image.getBoundingClientRect().height, naturalWidth: (image as HTMLImageElement).naturalWidth, naturalHeight: (image as HTMLImageElement).naturalHeight })));
  for (const image of images) expect(Math.abs(image.height / image.width - image.naturalHeight / image.naturalWidth)).toBeLessThan(0.02);
  await page.getByRole("button", { name: "By Lin", exact: true }).first().click();
  await expect(page.getByRole("button", { name: "Lin", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(list.getByRole("listitem")).toHaveCount(2);
  await page.getByRole("button", { name: "Filter recipes by tag", exact: true }).click();
  await page.getByRole("button", { name: "Chinese", exact: true }).click();
  await page.getByRole("button", { name: "Close tag filters", exact: true }).click();
  await page.getByRole("searchbox", { name: "Search recipes" }).fill("阿林");
  await expect.poll(() => Object.fromEntries(listRequests.at(-1)!)).toMatchObject({ author_id: author.id, q: "阿林", tags: "chinese" });
  await expect(list.getByRole("listitem")).toHaveCount(2);
  await healthy(page, errors);
  await page.screenshot({ path: `/tmp/recipe-authors-${testInfo.project.name}-library.png`, fullPage: true });
});

test("detail author selection and clearing save in place and survive reload", async ({ page }, testInfo) => {
  const { writes } = await fixtures(page);
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  await page.goto("/recipe/recipe-4");
  await page.getByRole("button", { name: "Add author", exact: true }).click();
  const search = page.getByRole("combobox", { name: "Search creators or aliases" });
  await expect(search).toBeVisible();
  await search.fill("阿林");
  await page.getByRole("option", { name: /Lin/ }).click();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("link", { name: "By Lin", exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("link", { name: "By Lin", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Edit author", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "Search creators or aliases" })).toBeVisible();
  await healthy(page, errors);
  await page.screenshot({ path: `/tmp/recipe-authors-${testInfo.project.name}-picker.png`, fullPage: true });
  await page.getByRole("button", { name: "Clear author", exact: true }).click();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("button", { name: "Add author", exact: true })).toBeVisible();
  expect(writes).toEqual([{ author_id: author.id }, { author_id: null }]);
});

test("creator directory remains within the viewport when its trigger wraps", async ({ page }) => {
  await fixtures(page);
  await page.goto("/library");
  await expect(page.getByRole("list").getByRole("listitem")).toHaveCount(2);
  await page.getByText("Search creators or aliases", { exact: true }).click();
  const search = page.getByRole("searchbox", { name: "Search creators or aliases" });
  await expect(search).toBeVisible();
  const bounds = await search.locator("..").boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual((page.viewportSize()?.width ?? 0) + 1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});


test("menu maker keeps a creator alias search from the Library", async ({ page }) => {
  await fixtures(page);
  await page.goto("/library");
  await page.getByRole("searchbox", { name: "Search recipes" }).fill("阿林");
  await expect(page.getByRole("list").getByRole("listitem")).toHaveCount(2);
  await page.getByRole("button", { name: "Make a menu", exact: true }).click();
  const selection = page.getByRole("region", { name: "Choose dishes" });
  await expect(selection.getByRole("checkbox")).toHaveCount(2);
  await expect(selection.getByText("By Lin", { exact: true })).toHaveCount(2);
  await selection.getByRole("checkbox").first().check();
  await expect(selection.getByRole("checkbox").first()).toBeChecked();
});

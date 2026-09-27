import { expect, test, type Page, type Route, type TestInfo } from '@playwright/test';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { API_BASE } from './api';

// Local UI fixtures only. These tests never call a paid provider or write a real account.
test.use({ actionTimeout: 15_000 });
const origin = process.env.MENU_QA_ORIGIN ?? `http://127.0.0.1:${process.env.PORT ?? '3000'}`;
const evidence = process.env.MENU_STUDIO_QA_DIR ?? '/private/tmp/menu-studio-web-qa';
const names = ['Roasted tomato soup', 'Golden mushroom toast', '春日芝麻面', 'Herb roast chicken', 'Lemon olive oil cake', 'Strawberry soda'];
const recipes = names.map((title, index) => ({ id: `studio-dish-${index}`, title,
  description: ['Slow roasted tomatoes, basil and cream.', 'Sourdough, forest mushrooms and thyme.', '芝麻酱、春蔬与手工面。', 'Golden roast chicken with garden herbs.', 'A bright slice with fresh lemon.', 'Strawberries, bubbles and a little joy.'][index],
  ingredients: [], library_tags: ['western'], thumbnail_url: index === 5 ? null : `${API_BASE}/uploads/recipes/studio-fixture/${index}.png` }));
const proposal = {
  version: 1, layout: 'category-board',
  palette: { background: '#F1DB83', panel: '#FFF9E6', text: '#352B24', accent: '#9D3533', muted: '#625345' },
  typography: { title: 'playful', body: 'sans', align: 'center' }, columns: 3,
  density: 'comfortable', decorations: 'expressive', section_treatment: 'band', photo_frame: 'rounded',
  artwork_placement: 'header', show_descriptions: false, art_direction: 'Warm, hand-painted garden herbs and red tomatoes.',
};
async function json(route: Route, body: unknown, status = 200) {
  await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body),
    headers: { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Credentials': 'true' } });
}
async function fixtures(page: Page, options: { failPhoto?: boolean } = {}) {
  const image = await readFile(path.join(process.cwd(), 'public/brand/editorial-dinner.png'));
  const artwork = await readFile(path.join(process.cwd(), 'e2e/fixtures/menu-artwork.png'));
  const state = { creations: [] as Record<string, unknown>[], designs: [] as Record<string, unknown>[], artwork: [] as Record<string, unknown>[], photos: [] as string[], writes: [] as string[], delayDesign: false };
  let finish = () => {}; const gate = new Promise<void>(resolve => { finish = resolve; });
  await page.route(`${API_BASE}/**`, async route => {
    const request = route.request(), pathname = new URL(request.url()).pathname;
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Credentials': 'true', 'Access-Control-Allow-Methods': 'GET,POST,PATCH,OPTIONS', 'Access-Control-Allow-Headers': 'content-type' } });
    if (pathname === '/auth/me') return json(route, { id: 'studio-fixture-account', email: 'studio-fixture@example.test', is_library_public: false });
    if (pathname.startsWith('/recipes') && ['POST', 'PATCH', 'DELETE'].includes(request.method())) state.writes.push(pathname);
    if (pathname === '/recipes') return json(route, recipes);
    if (pathname === '/recipes/page' || pathname === '/recipes/catalog/page') return json(route, { items: recipes, next_cursor: null });
    if (pathname === '/menus/access') return json(route, { allowed: true, is_admin: false, daily_limit: 1, remaining: 1, resets_at: '2026-09-27T00:00:00Z' });
    if (pathname === '/menus/creations') { state.creations.push(request.postDataJSON()); return json(route, { request_id: request.postDataJSON().request_id, created_at: '2026-09-26T12:00:00Z' }); }
    if (pathname === '/menus/designs') { state.designs.push(request.postDataJSON()); if (state.delayDesign) await gate; return json(route, proposal); }
    if (pathname === '/menus/artwork/access') return json(route, { enabled: true, allowed: true, daily_limit: 3, remaining: 3, resets_at: '2026-09-27T00:00:00Z' });
    if (pathname === '/menus/artwork' && request.method() === 'POST') { state.artwork.push(request.postDataJSON()); return json(route, { request_id: request.postDataJSON().request_id, status: 'completed', file_url: 'https://fixture.invalid/not-fetched' }); }
    if (pathname.startsWith('/menus/recipe-images/')) {
      state.photos.push(pathname.split('/').pop()!);
      if (options.failPhoto && pathname.endsWith('studio-dish-0')) return json(route, { detail: { code: 'recipe_image_unavailable' } }, 404);
    }
    if (pathname.startsWith('/menus/recipe-images/') || pathname.startsWith('/uploads/recipes/') || pathname.endsWith('/file')) return route.fulfill({ status: 200, contentType: 'image/png', body: pathname.endsWith('/file') ? artwork : image,
      headers: { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Credentials': 'true' } });
    if (pathname === '/cooking-session/active') return json(route, null);
    return json(route, []);
  });
  return { state, finish };
}
async function openEditor(page: Page) {
  await page.goto('/library'); await expect(page).toHaveTitle(/Chef World/);
  await page.getByRole('button', { name: 'Make a menu', exact: true }).click();
  await page.getByRole('button', { name: 'Select all recipes', exact: true }).click();
  await page.getByRole('button', { name: 'Choose a style', exact: true }).click();
  await ready(page);
}
async function ready(page: Page) { await expect(page.getByRole('button', { name: 'Download page 1 as PNG', exact: true })).toBeEnabled({ timeout: 45_000 }); }
const preview = (page: Page) => page.frameLocator('iframe[title="Menu preview"]');
async function capture(page: Page, testInfo: TestInfo, name: string) {
  await mkdir(evidence, { recursive: true });
  await page.getByTestId('menu-preview-viewport').scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(evidence, `${testInfo.project.name}-${name}-editor.png`), fullPage: false });
  await preview(page).locator('.menu-page').first().screenshot({ path: path.join(evidence, `${testInfo.project.name}-${name}-preview.png`) });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await expect(page.locator('[data-nextjs-dialog], .vite-error-overlay')).toHaveCount(0);
}
async function exportPng(page: Page, testInfo: TestInfo, name: string) {
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download page 1 as PNG', exact: true }).click();
  const download = await pending; const target = path.join(evidence, `${testInfo.project.name}-${name}.png`);
  await download.saveAs(target); const png = await readFile(target);
  expect(png.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([1632, 2112]);
  expect(download.suggestedFilename()).toBe('Sunday-Lunch-Club-page-1.png');
}

test('three restaurant compositions retain owned photos, uploaded dishes and final names through AI review and exports', async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  const failures: string[] = []; page.on('pageerror', error => failures.push(error.message));
  const { state } = await fixtures(page); await openEditor(page);
  await expect(preview(page).locator('[data-recipe-image]')).toHaveCount(5);
  expect(new Set(state.photos)).toEqual(new Set(recipes.slice(0, 5).map(recipe => recipe.id)));
  await page.getByLabel('Menu title', { exact: true }).fill('Sunday Lunch Club');
  await page.getByLabel('Subtitle (optional)', { exact: true }).fill('Seasonal favorites · Local QA fixture');
  await page.getByRole('tab', { name: /^Dishes/ }).click();
  const dishes = page.locator('#menu-dishes-panel details');
  await dishes.first().locator('summary').click();
  await dishes.first().getByLabel('Dish name', { exact: true }).fill('Grandma’s Sunday soup');
  await dishes.first().getByLabel('Price · optional', { exact: true }).fill('$12');
  await dishes.first().getByLabel('Little label · optional', { exact: true }).fill('House favorite');
  await dishes.last().locator('summary').click();
  await dishes.last().getByLabel('Upload dish photo', { exact: true }).setInputFiles(path.join(process.cwd(), 'public/brand/login-original.jpg'));
  await expect(preview(page).locator('[data-recipe-image="studio-dish-5"]')).toHaveCount(1);
  await expect(preview(page).locator('[data-recipe-image]')).toHaveCount(6);
  await expect(preview(page).locator('text').filter({ hasText: 'Grandma’s Sunday soup' })).toHaveCount(1);
  await expect(preview(page).locator('text').filter({ hasText: '$12' })).toHaveCount(1);
  await expect(preview(page).locator('text').filter({ hasText: 'House favorite' })).toHaveCount(1);
  await page.getByLabel('Section heading', { exact: true }).first().fill('Small plates');
  for (const heading of ['Kitchen favorites', 'Something sweet']) {
    await page.getByRole('button', { name: 'Add section', exact: false }).click();
    await page.getByLabel('Section heading', { exact: true }).last().fill(heading);
  }
  for (const index of [2, 3, 4, 5]) {
    const dish = dishes.filter({ has: page.locator('summary').filter({ hasText: names[index] }) });
    if (await dish.getAttribute('open') === null) await dish.locator('summary').click();
    await dish.getByLabel('Move to section', { exact: true }).selectOption({ label: index < 4 ? 'Kitchen favorites' : 'Something sweet' });
  }
  await page.getByRole('tab', { name: 'Design', exact: true }).click();
  await page.getByRole('button', { name: 'Garden table', exact: true }).click();
  for (const [label, layout] of [['Photo menu', 'photo-grid'], ['Category board', 'category-board'], ['Illustrated list', 'illustrated-list']]) {
    await page.getByRole('button', { name: label, exact: true }).click(); await ready(page);
    await expect(preview(page).locator('svg[data-layout]').first()).toHaveAttribute('data-layout', layout);
    await expect(preview(page).locator('[data-recipe-image]')).toHaveCount(6);
    await capture(page, testInfo, layout); await exportPng(page, testInfo, layout);
  }
  await page.getByLabel('Describe your menu', { exact: true }).fill('A charming yellow cafe board with hand-drawn headings and six food photos.');
  await page.getByRole('button', { name: /Design with AI/ }).click();
  await expect(page.getByRole('button', { name: 'Use this design', exact: true })).toBeVisible();
  await expect(preview(page).locator('svg[data-layout]').first()).toHaveAttribute('data-layout', 'illustrated-list');
  expect(state.designs).toHaveLength(1);
  expect(state.designs[0].menu_creation_id).toBe(state.creations[0].request_id);
  expect(state.designs[0].content).toEqual({ item_count: 6, section_count: 3, photo_count: 6, language: 'en' });
  expect(JSON.stringify(state.designs)).not.toContain('Grandma');
  await page.getByRole('button', { name: 'Use this design', exact: true }).click(); await ready(page);
  await expect(preview(page).locator('svg[data-layout]').first()).toHaveAttribute('data-layout', 'category-board');
  await expect.poll(async () => (await preview(page).locator('text').allTextContents()).join(' ').replace(/\s+/g, ' ')).toContain('Grandma’s Sunday soup');
  await capture(page, testInfo, 'ai-design-applied'); await exportPng(page, testInfo, 'final-menu');
  const opening = page.waitForEvent('popup'); await page.getByRole('button', { name: 'Print / PDF', exact: true }).click();
  const printed = await opening; await expect(printed).toHaveTitle('Sunday Lunch Club');
  await expect(printed.locator('[data-recipe-image]')).toHaveCount(6);
  expect((await printed.locator('text').allTextContents()).join(' ').replace(/\s+/g, ' ')).toContain('Grandma’s Sunday soup');
  await expect(printed.locator('text').filter({ hasText: 'House favorite' })).toHaveCount(1);
  await expect(printed.locator('text').filter({ hasText: 'Roasted tomato soup' })).toHaveCount(0);
  const pdf = await printed.pdf({ path: path.join(evidence, `${testInfo.project.name}-final-menu.pdf`), preferCSSPageSize: true, printBackground: true });
  expect(pdf.subarray(0, 4).toString()).toBe('%PDF'); await printed.close();
  expect(state.creations).toHaveLength(1); expect(state.writes).toEqual([]); expect(failures).toEqual([]);
});

test('cancelled AI proposal keeps editable names and never silently applies a late design', async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  const { state, finish } = await fixtures(page); state.delayDesign = true; await openEditor(page);
  await page.getByLabel('Menu title', { exact: true }).fill('Keep this dinner');
  await page.getByRole('button', { name: 'Illustrated list', exact: true }).click(); await ready(page);
  await page.getByLabel('Describe your menu', { exact: true }).fill('A completely different red cafe board');
  await page.getByRole('button', { name: /Design with AI/ }).click();
  await expect.poll(() => state.designs.length).toBe(1);
  await page.getByRole('button', { name: 'Cancel generation', exact: true }).click(); finish();
  await expect(page.getByText('Design cancelled. Your menu is unchanged.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Use this design', exact: true })).toHaveCount(0);
  await expect(page.getByLabel('Menu title', { exact: true })).toHaveValue('Keep this dinner');
  await expect(preview(page).locator('svg[data-layout]').first()).toHaveAttribute('data-layout', 'illustrated-list');
  await capture(page, testInfo, 'cancelled-proposal');
  expect(state.designs).toHaveLength(1); expect(state.creations).toHaveLength(1); expect(state.writes).toEqual([]);
});

test('unavailable and removed photos stay absent while a manual upload fills an originally missing photo', async ({ page }) => {
  test.setTimeout(90_000);
  await fixtures(page, { failPhoto: true }); await openEditor(page);
  await expect(preview(page).locator('[data-recipe-image]')).toHaveCount(4);
  await page.getByRole('tab', { name: /^Dishes/ }).click();
  await expect(page.getByText('Some photos could not be loaded. You can upload a photo for each dish.', { exact: false })).toBeVisible();
  const dishes = page.locator('#menu-dishes-panel details');
  await dishes.nth(1).locator('summary').click(); await dishes.nth(1).getByRole('button', { name: 'Remove photo', exact: true }).click();
  await expect(preview(page).locator('[data-recipe-image="studio-dish-1"]')).toHaveCount(0);
  await page.getByRole('button', { name: 'Retry photos', exact: true }).click(); await ready(page);
  await expect(preview(page).locator('[data-recipe-image="studio-dish-1"]')).toHaveCount(0);
  await dishes.first().locator('summary').click();
  await dishes.first().getByLabel('Upload dish photo', { exact: true }).setInputFiles(path.join(process.cwd(), 'public/brand/login-original.jpg'));
  await expect(preview(page).locator('[data-recipe-image="studio-dish-0"]')).toHaveCount(1);
});

import { expect,test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { menuArtworkFixturePath,menuFixtures,openSimpleMenu } from './menu-fixtures';
test.use({ actionTimeout:15_000 });

test('compact recipe selection and one prompt generate a whole downloadable menu image',async ({ page },testInfo) => {
 const errors:string[]=[]; page.on('pageerror',error => errors.push(error.message));
 const { state,recipes }=await menuFixtures(page); await openSimpleMenu(page);
 await expect(page.getByRole('checkbox')).toHaveCount(9);
 await expect(page.getByLabel('Menu title (optional)',{ exact:true })).toBeVisible();
 await expect(page.getByLabel('Describe your menu (optional)',{ exact:true })).toBeVisible();
 await expect(page.getByRole('tab',{ name:'Design',exact:true })).toHaveCount(0);
 await expect(page.locator('iframe[title="Menu preview"]')).toHaveCount(0);
 await page.getByRole('searchbox').fill('tomato'); await page.getByRole('checkbox').check();
 await expect(page.getByText('1 dishes selected')).toBeVisible();
 await page.getByRole('button',{ name:'Select all recipes',exact:true }).click();
 await expect(page.getByText('9 dishes selected')).toBeVisible();
 await page.getByRole('searchbox').clear();
 const row=page.getByRole('checkbox').first().locator('..'); const bounds=await row.boundingBox(); expect(bounds!.height).toBeLessThan(76);
 const list=page.getByRole('checkbox').first().locator('../..'); const listBounds=await list.boundingBox(); expect(listBounds!.height).toBeLessThanOrEqual(290);
 await page.getByLabel('Menu title (optional)',{ exact:true }).fill('Our Little Kitchen');
 await page.getByLabel('Describe your menu (optional)',{ exact:true }).fill('Cute watercolor dishes, warm cream paper, tomatoes and green gingham. Local UI fixture.');
 await page.screenshot({ path:testInfo.outputPath('compact-form.png'),fullPage:true });
 await page.getByRole('searchbox').blur(); await page.evaluate(() => window.scrollTo(0,0));
 await page.screenshot({ path:testInfo.outputPath('first-viewport.png'),fullPage:false });
 await page.getByRole('button',{ name:'Generate menu',exact:true }).click();
 const generated=page.getByRole('img',{ name:'AI-generated menu with your selected dishes' }); await expect(generated).toBeVisible();
 expect(state.posts).toHaveLength(1); expect(state.posts[0]).toEqual({ request_id:expect.any(String),mode:'full-menu-v1',title:'Our Little Kitchen',brief:expect.stringContaining('Local UI fixture'),recipes:recipes.map(recipe => ({ recipe_id:recipe.id,name:recipe.title })) });
 expect(state.creations).toEqual([]); expect(state.writes).toEqual([]);
 await expect(page.getByRole('button',{ name:'Generate menu',exact:true })).toBeDisabled();
 const downloading=page.waitForEvent('download'); await page.getByRole('link',{ name:'Download menu',exact:true }).click();
 const downloaded=await downloading; const destination=testInfo.outputPath('full-menu-fixture.png'); await downloaded.saveAs(destination);
 expect(await readFile(destination)).toEqual(await readFile(menuArtworkFixturePath));
 expect(downloaded.suggestedFilename()).toBe('Our-Little-Kitchen.png');
 await generated.scrollIntoViewIfNeeded(); await page.screenshot({ path:testInfo.outputPath('generated-fixture.png'),fullPage:true });
 expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth+1)).toBe(true);
 await generated.screenshot({ path:testInfo.outputPath('result-image.png') });
 await expect(page.locator('[data-nextjs-dialog], .vite-error-overlay')).toHaveCount(0);
 expect(errors).toEqual([]);
});

test('Select all includes the entire paginated library and explains the 24-dish limit without spending an allowance',async ({ page }) => {
 const { state }=await menuFixtures(page,{ count:25 }); await openSimpleMenu(page);
 await page.getByRole('searchbox').fill('tomato'); await page.getByRole('button',{ name:'Select all recipes',exact:true }).click();
 await expect(page.getByText('25 dishes selected')).toBeVisible();
 await expect(page.getByText('Choose up to 24 dishes so everything fits clearly on one menu.')).toBeVisible();
 await expect(page.getByRole('button',{ name:'Generate menu',exact:true })).toBeDisabled();
 expect(state.posts).toEqual([]); expect(state.creations).toEqual([]);
});

test('one daily menu limit blocks generation while retaining the selection',async ({ page }) => {
 const { state }=await menuFixtures(page,{ denied:true }); await openSimpleMenu(page);
 await page.getByRole('checkbox').first().check();
 await expect(page.getByText('1 dishes selected')).toBeVisible();
 await expect(page.getByTestId('menu-maker').getByRole('alert')).toContainText('You’ve created today’s menu.');
 await expect(page.getByRole('button',{ name:'Generate menu',exact:true })).toBeDisabled();
 expect(state.posts).toEqual([]); expect(state.creations).toEqual([]);
});

import { expect,test } from '@playwright/test';
import { API_BASE } from './api';
import { menuFixtures,menuJson,menuRecipes,openSimpleMenu } from './menu-fixtures';
// Regression coverage for the simple full-image flow replacing the former studio.
test.use({ actionTimeout:15_000 });

test('cancelled waiting recovers the same original menu without a second generation',async ({ page }) => {
 const { state,finish }=await menuFixtures(page,{ delayed:true }); await openSimpleMenu(page);
 await page.getByRole('checkbox').first().check();
 await page.getByLabel('Menu title (optional)',{ exact:true }).fill('Keep this dinner');
 await page.getByRole('button',{ name:'Generate menu',exact:true }).click();
 await expect.poll(() => state.posts.length).toBe(1);
 await page.getByRole('button',{ name:'Stop waiting',exact:true }).click(); finish();
 await expect(page.getByRole('img',{ name:'AI-generated menu with your selected dishes' })).toHaveCount(0);
 await expect(page.getByLabel('Menu title (optional)',{ exact:true })).toHaveValue('Keep this dinner');
 await expect(page.getByLabel('Menu title (optional)',{ exact:true })).toBeDisabled();
 page.once('dialog',dialog => dialog.dismiss()); await page.getByRole('button',{ name:'Close menu',exact:true }).click();
 await expect(page.getByLabel('Menu title (optional)',{ exact:true })).toHaveValue('Keep this dinner');
 await page.getByRole('button',{ name:'Check my menu',exact:true }).click();
 await expect(page.getByRole('link',{ name:'Download menu',exact:true })).toHaveAttribute('download','Keep-this-dinner.png');
 expect(state.posts).toHaveLength(1); expect(state.checks).toEqual([state.posts[0].request_id]); expect(state.creations).toEqual([]); expect(state.writes).toEqual([]);
});

test('an authoritative quota rejection keeps form choices and switching account drops the private form',async ({ page }) => {
 const { state }=await menuFixtures(page,{ rejected:true }); await openSimpleMenu(page);
 await page.getByRole('checkbox').first().check(); await page.getByLabel('Menu title (optional)',{ exact:true }).fill('Private dinner');
 await page.getByRole('button',{ name:'Generate menu',exact:true }).click();
 await expect(page.getByTestId('menu-maker').getByRole('alert')).toContainText('You’ve created today’s menu.');
 await expect(page.getByLabel('Menu title (optional)',{ exact:true })).toHaveValue('Private dinner');
 await page.route(`${API_BASE}/auth/me`,route => menuJson(route,{ id:'second-account',email:'second@example.test',is_library_public:false }));
 await page.evaluate(() => { localStorage.setItem('cooking-auth-user','second-account'); window.dispatchEvent(new StorageEvent('storage',{ key:'cooking-auth-user',newValue:'second-account' })); });
 await expect(page.getByTestId('menu-maker')).toHaveCount(0);
 await page.getByRole('button',{ name:'Make a menu',exact:true }).click();
 await expect(page.getByLabel('Menu title (optional)',{ exact:true })).toHaveValue('');
 await expect(page.getByText('0 dishes selected')).toBeVisible(); expect(state.writes).toEqual([]);
});

test('admins can explicitly generate a second menu with a different id',async ({ page }) => {
 const { state }=await menuFixtures(page,{ admin:true }); await openSimpleMenu(page);
 await expect(page.getByText('Unlimited menu creation for admins.')).toBeVisible();
 await page.getByRole('checkbox').first().check(); await page.getByRole('button',{ name:'Generate menu',exact:true }).click();
 await expect(page.getByRole('img',{ name:'AI-generated menu with your selected dishes' })).toBeVisible();
 await expect(page.getByRole('button',{ name:'Generate menu',exact:true })).toBeEnabled();
 await page.getByLabel('Menu title (optional)',{ exact:true }).fill('Another dinner');
 await page.getByRole('button',{ name:'Generate menu',exact:true }).click();
 await expect(page.getByRole('link',{ name:'Download menu',exact:true })).toHaveAttribute('download','Another-dinner.png');
 expect(state.posts).toHaveLength(2); expect(state.posts[0].request_id).not.toBe(state.posts[1].request_id); expect(state.creations).toEqual([]);
});


test('refreshing changed recipes keeps the menu prompt and submits the current dish name',async ({ page }) => {
 const { state }=await menuFixtures(page); await openSimpleMenu(page);
 await page.getByRole('checkbox',{ name:'Select Roasted tomato soup',exact:true }).check();
 await page.getByLabel('Menu title (optional)',{ exact:true }).fill('Keep my title');
 await page.getByLabel('Describe your menu (optional)',{ exact:true }).fill('Keep my watercolor notes');
 let rejected=false;
 await page.route(`${API_BASE}/menus/artwork`,async route => {
  if (!rejected && route.request().method() === 'POST') { rejected=true; return menuJson(route,{ detail:{ code:'recipe_changed',message:'Recipe changed' } },409); }
  return route.fallback();
 });
 await page.getByRole('button',{ name:'Generate menu',exact:true }).click();
 await expect(page.getByTestId('menu-maker').getByRole('alert')).toContainText('Your library changed.');
 const updated=menuRecipes.map(recipe => recipe.title === 'Roasted tomato soup' ? { ...recipe,title:'Fresh tomato soup' } : recipe);
 await page.route(`${API_BASE}/recipes`,route => menuJson(route,updated));
 await page.getByRole('button',{ name:'Refresh',exact:true }).click();
 await expect(page.getByRole('checkbox',{ name:'Select Fresh tomato soup',exact:true })).toBeChecked();
 await expect(page.getByLabel('Menu title (optional)',{ exact:true })).toHaveValue('Keep my title');
 await expect(page.getByRole('textbox',{ name:'Describe your menu (optional)',exact:true })).toHaveValue('Keep my watercolor notes');
 await page.getByRole('button',{ name:'Generate menu',exact:true }).click();
 await expect(page.getByRole('link',{ name:'Download menu',exact:true })).toHaveAttribute('download','Keep-my-title.png');
 expect(state.posts).toHaveLength(1); expect(state.posts[0].recipes).toEqual([{ recipe_id:menuRecipes[1].id,name:'Fresh tomato soup' }]);
});

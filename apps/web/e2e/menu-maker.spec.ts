import { expect, test, type Page, type Route } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { API_BASE } from './api';
test.use({ actionTimeout: 15000 });
const origin = process.env.MENU_QA_ORIGIN ?? `http://127.0.0.1:${process.env.PORT ?? '3000'}`;
const recipes = Array.from({length:42}, (_,index) => ({ id:`menu-dish-${index}`, title:`${String(index+1).padStart(2,'0')} 家常菜 · Garden dish`, description:`A thoughtful dish ${index+1}, with seasonal vegetables and herbs.`, ingredients:[],library_tags:['chinese'],thumbnail_url:null }));
async function fulfill(route:Route,body:unknown,status=200) { await route.fulfill({status,contentType:'application/json',headers:{'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Credentials':'true'},body:JSON.stringify(body)}); }
async function fixtures(page:Page, options:{ fail?:boolean; delayed?:boolean; creationDenied?:boolean; admin?:boolean }={}) {
 const posts:unknown[]=[]; const writes:string[]=[]; const creations:unknown[]=[];
 let finish:(() => void)|undefined; const gate=new Promise<void>(resolve=>{finish=resolve;});
 await page.route(`${API_BASE}/**`,async route=>{
  const request=route.request(), pathname=new URL(request.url()).pathname;
  if (request.method()==='OPTIONS') return route.fulfill({status:204,headers:{'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Credentials':'true','Access-Control-Allow-Methods':'GET,POST,PATCH,OPTIONS','Access-Control-Allow-Headers':'content-type'}});
  if(pathname==='/auth/me') return fulfill(route,{id:'menu-account',email:'menu@example.com',is_library_public:false});
  if(pathname.startsWith('/recipes') && ['POST','PATCH'].includes(request.method())) writes.push(pathname);
  if(pathname==='/recipes') return fulfill(route,recipes);
  if(pathname==='/recipes/page') return fulfill(route,{items:recipes.slice(0,12),next_cursor:'another-page'});
  if(pathname==='/recipes/catalog/page') return fulfill(route,{items:recipes.slice(0,2),next_cursor:null});
  if(pathname==='/recipes/catalog') return fulfill(route,recipes.slice(0,2));
  if(pathname==='/menus/access') return fulfill(route,{allowed:!options.creationDenied,is_admin:!!options.admin,daily_limit:options.admin?null:1,remaining:options.admin?null:options.creationDenied?0:1,resets_at:'2026-09-27T00:00:00Z'});
  if(pathname==='/menus/creations') { creations.push(request.postDataJSON()); return fulfill(route,{request_id:request.postDataJSON().request_id,created_at:'2026-09-26T00:00:00Z'}); }
  if(pathname==='/menus/artwork/access') return fulfill(route,{enabled:true,allowed:true,reason:null,daily_limit:3,remaining:3-posts.length,resets_at:'2026-09-27T00:00:00Z'});
  if(pathname==='/menus/artwork' && request.method()==='POST') {
   posts.push(request.postDataJSON()); if(options.delayed) await gate;
   return fulfill(route,options.fail ? {detail:{code:'daily_limit',message:'Limit'}} : {request_id:request.postDataJSON().request_id,status:'completed',file_url:'https://private.invalid/never-fetch.png'},options.fail?429:200);
  }
  if(pathname.endsWith('/file')) return route.fulfill({status:200,contentType:'image/png',headers:{'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Credentials':'true'},body:await readFile(path.join(process.cwd(),'e2e/fixtures/menu-artwork.png'))});
  if(pathname==='/cooking-session/active') return fulfill(route,null);
  return fulfill(route,[]);
 });
 return {posts,writes,creations,finish:()=>finish?.()};
}
async function openMenu(page:Page) { await page.goto('/library'); await page.getByRole('button',{name:'Make a menu',exact:true}).click(); }
async function enterEditor(page:Page) { await page.getByRole('button',{name:'Select all recipes',exact:true}).click(); await page.getByRole('button',{name:'Choose a style',exact:true}).click(); await expect(page.getByRole('button',{name:'Download page 1 as PNG'})).toBeEnabled({timeout:45000}); }

test('complete library selection, six styles, local edits, sections, accepted artwork and PNG/PDF',async({page},testInfo)=>{
 test.setTimeout(120000); if(testInfo.project.name === 'desktop') await page.setViewportSize({width:1280,height:720}); const state=await fixtures(page); await page.goto('/library');
 await page.getByRole('tab',{name:'Public library',exact:true}).click(); await expect(page.getByRole('button',{name:'Make a menu',exact:true})).toHaveCount(0);
 await page.getByRole('tab',{name:'My library',exact:true}).click(); await page.getByRole('button',{name:'Make a menu',exact:true}).click();
 const first=page.getByRole('checkbox').first(); await first.focus(); await page.keyboard.press('Space'); await expect(page.getByText('1 dishes selected')).toBeVisible();
 await page.getByRole('searchbox').fill('01 家常'); await page.getByRole('button',{name:'Clear selection'}).click(); await page.getByRole('button',{name:'Select matching recipes'}).click(); await expect(page.getByText('1 dishes selected')).toBeVisible();
 await enterEditor(page); await expect(page.getByLabel('Dish name',{exact:true})).toHaveCount(42);
 for(const style of ['French bistro','Garden table','Italian supper','Chinese teahouse','Minimal modern','Cozy cafe']) { await page.getByRole('button',{name:style,exact:true}).click(); }
 await page.getByLabel('Menu title',{exact:true}).fill('家宴 / Garden supper');
 await page.getByRole('tab',{name:/^Dishes/}).click(); await page.locator('#menu-dishes-panel details').first().locator('summary').click();
 await page.getByLabel('Dish name',{exact:true}).first().fill('妈妈的茄子煲');
 await page.getByRole('button',{name:'Back to dishes',exact:true}).click(); await page.getByRole('button',{name:'Choose a style',exact:true}).click();
 await page.getByRole('tab',{name:/^Dishes/}).click(); await page.locator('#menu-dishes-panel details').first().locator('summary').click();
 await expect(page.getByLabel('Dish name',{exact:true}).first()).toHaveValue('妈妈的茄子煲');
 await page.getByRole('button',{name:'Add section'}).click(); await page.getByLabel('Section heading',{exact:true}).last().fill('甜点 · Dessert');
 await page.locator('#menu-dishes-panel details').last().locator('summary').click(); await page.getByLabel('Move to section',{exact:true}).last().selectOption({label:'甜点 · Dessert'});
 await page.getByRole('tab',{name:'Design',exact:true}).click();
 await page.getByLabel('Artwork notes',{exact:true}).fill('Sage green botanical border'); await page.getByRole('button',{name:'Generate artwork',exact:true}).click(); await expect(page.getByRole('button',{name:'Use artwork',exact:true})).toBeVisible();
 await expect(page.getByText('Artwork in use',{exact:false})).toHaveCount(0); await page.getByRole('button',{name:'Garden table',exact:true}).click(); await expect(page.getByText('Artwork created for Cozy cafe')).toBeVisible();
 await page.getByRole('button',{name:'Use artwork',exact:true}).click(); await expect(page.getByText('Artwork in use',{exact:false})).toBeVisible();
 await expect(page.getByRole('button',{name:'Download page 1 as PNG'})).toBeEnabled();
 if(testInfo.project.name === 'desktop') { await page.getByRole('button',{name:'Download page 1 as PNG'}).scrollIntoViewIfNeeded(); const buttonBox=await page.getByRole('button',{name:'Print / PDF',exact:true}).boundingBox(); expect(buttonBox!.y+buttonBox!.height).toBeLessThanOrEqual(720); expect(await page.evaluate(()=>scrollY)).toBeLessThan(2000); }
 const iframe=page.locator('iframe[title="Menu preview"]'); const frame=page.frameLocator('iframe[title="Menu preview"]');
 const pageCount=await frame.locator('.menu-page').count(); expect(pageCount).toBeGreaterThan(2);
 await expect(frame.locator('text').filter({hasText:'妈妈的茄子煲'})).toHaveCount(1);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 const box=await page.getByTestId('menu-preview-viewport').boundingBox(); expect(box!.width).toBeLessThanOrEqual(testInfo.project.use.viewport?.width ?? 2000);
 const downloadPromise=page.waitForEvent('download'); await page.getByRole('button',{name:'Download page 1 as PNG'}).click(); const download=await downloadPromise;
 await download.saveAs(testInfo.outputPath('menu-page-1.png')); const png=await readFile(testInfo.outputPath('menu-page-1.png')); expect(png.subarray(0,8)).toEqual(Buffer.from([137,80,78,71,13,10,26,10])); expect(png.readUInt32BE(16)).toBe(1632); expect(png.readUInt32BE(20)).toBe(2112); expect(download.suggestedFilename()).not.toContain('/');
 await page.getByRole('button',{name:'Next page',exact:true}).click(); await expect(page.getByRole('button',{name:'Download page 2 as PNG'})).toBeEnabled();
 const popupPromise=page.waitForEvent('popup'); await page.getByRole('button',{name:'Print / PDF',exact:true}).click(); const popup=await popupPromise; await expect(popup.locator('.menu-page')).toHaveCount(pageCount);
 await expect(popup.locator('text').filter({hasText:'妈妈的茄子煲'})).toHaveCount(1); await expect(popup.locator('text').filter({hasText:'42 家常菜'})).toHaveCount(1);
 const pdf=await popup.pdf({path:testInfo.outputPath('menu.pdf'),preferCSSPageSize:true,printBackground:true}); expect(pdf.subarray(0,4).toString()).toBe('%PDF'); await testInfo.attach('menu.pdf',{body:pdf,contentType:'application/pdf'}); await popup.close();
 expect(state.creations).toHaveLength(1); expect(state.posts).toHaveLength(1); expect(Object.keys(state.posts[0] as object).sort()).toEqual(['design','instructions','request_id','style_id']); expect(state.writes).toEqual([]);
 await testInfo.attach('menu-editor',{body:await page.screenshot({path:testInfo.outputPath('menu-editor.png'),fullPage:false}),contentType:'image/png'});
 await expect(iframe).toHaveAttribute('sandbox','allow-scripts');
});

test('failed and cancelled generation preserve edits and accepted template',async({page})=>{
 test.setTimeout(90000); const state=await fixtures(page,{delayed:true}); await openMenu(page); await page.getByRole('checkbox').first().check(); await page.getByRole('button',{name:'Choose a style',exact:true}).click();
 await page.getByLabel('Menu title',{exact:true}).fill('Keep my menu'); await page.getByRole('button',{name:'Generate artwork',exact:true}).click(); await page.getByRole('button',{name:'Cancel generation',exact:true}).click(); state.finish();
 await expect(page.getByRole('button',{name:'Use artwork',exact:true})).toHaveCount(0); await expect(page.getByLabel('Menu title',{exact:true})).toHaveValue('Keep my menu');
 await expect(page.getByRole('button',{name:'Check again',exact:true})).toBeVisible();
 page.once('dialog',dialog=>dialog.dismiss()); await page.getByRole('button',{name:'Close menu',exact:true}).click(); await expect(page.getByLabel('Menu title',{exact:true})).toHaveValue('Keep my menu');
 page.once('dialog',dialog=>dialog.dismiss()); await page.getByRole('link',{name:'Add Recipe',exact:true}).first().click(); await expect(page.getByLabel('Menu title',{exact:true})).toHaveValue('Keep my menu');
 page.once('dialog',dialog=>dialog.dismiss()); await page.goBack(); await expect(page.getByLabel('Menu title',{exact:true})).toHaveValue('Keep my menu');
 expect(state.posts).toHaveLength(1); expect(state.writes).toEqual([]);
});

test('generation rejection preserves the menu and an account switch drops private drafts',async({page})=>{
 test.setTimeout(60000); const state=await fixtures(page,{fail:true}); await openMenu(page); await page.getByRole('checkbox').first().check(); await page.getByRole('button',{name:'Choose a style',exact:true}).click();
 await page.getByLabel('Menu title',{exact:true}).fill('Private dinner'); await page.getByRole('button',{name:'Generate artwork',exact:true}).click();
 await expect(page.getByText('You’ve used today’s image allowance. You can still edit and export your menu.')).toBeVisible();
 await expect(page.getByLabel('Menu title',{exact:true})).toHaveValue('Private dinner'); await expect(page.getByRole('button',{name:'Use artwork',exact:true})).toHaveCount(0);
 await page.route(`${API_BASE}/auth/me`,route=>fulfill(route,{id:'second-account',email:'second@example.com',is_library_public:false}));
 await page.evaluate(()=>{localStorage.setItem('cooking-auth-user','second-account');window.dispatchEvent(new StorageEvent('storage',{key:'cooking-auth-user',newValue:'second-account'}));});
 await expect(page.getByTestId('menu-maker')).toHaveCount(0); await page.getByRole('button',{name:'Make a menu',exact:true}).click(); await expect(page.getByText('0 dishes selected')).toBeVisible(); expect(state.writes).toEqual([]);
});


test('the daily menu limit preserves recipe selection and blocks a second creation', async ({page}) => {
 const state=await fixtures(page,{creationDenied:true}); await openMenu(page);
 await page.getByRole('button',{name:'Select all recipes',exact:true}).click();
 await expect(page.getByText('42 dishes selected')).toBeVisible();
 await expect(page.getByText(/You’ve created today’s menu/)).toBeVisible();
 await expect(page.getByRole('button',{name:'Choose a style',exact:true})).toBeDisabled();
 expect(state.creations).toHaveLength(0); expect(state.posts).toHaveLength(0);
});

test('admins can start another menu with a distinct creation ID', async ({page}) => {
 const state=await fixtures(page,{admin:true}); await openMenu(page);
 await expect(page.getByText('Unlimited menu creation for admins.')).toBeVisible();
 await page.getByRole('checkbox').first().check();
 await page.getByRole('button',{name:'Choose a style',exact:true}).click();
 await expect(page.getByLabel('Menu title',{exact:true})).toBeVisible();
 page.once('dialog',dialog=>dialog.accept()); await page.getByRole('button',{name:'Close menu',exact:true}).click();
 await page.getByRole('button',{name:'Make a menu',exact:true}).click();
 await page.getByRole('checkbox').first().check();
 await page.getByRole('button',{name:'Choose a style',exact:true}).click();
 await expect(page.getByLabel('Menu title',{exact:true})).toBeVisible();
 expect(state.creations).toHaveLength(2);
 expect(state.creations[0]).not.toEqual(state.creations[1]);
});

import { type Page, type Route } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { API_BASE } from './api';
export const menuOrigin=process.env.MENU_QA_ORIGIN ?? `http://127.0.0.1:${process.env.PORT ?? '3000'}`;
export const menuArtworkFixturePath=process.env.MENU_QA_ARTWORK ?? path.join(process.cwd(),'e2e/fixtures/menu-artwork.png');
const names=['番茄炒蛋','Roasted tomato soup','春日芝麻面','Herb roast chicken','Lemon olive oil cake','Strawberry soda','Golden mushroom toast','家常豆腐','Sunday pancakes'];
export const menuRecipes=names.map((title,index) => ({ id:`menu-fixture-${index}`,title,description:'Menu UI fixture only',ingredients:[],library_tags:['chinese'],thumbnail_url:`${API_BASE}/uploads/menu-fixture/${index}.png` }));
export async function menuJson(route:Route,body:unknown,status=200) { await route.fulfill({ status,contentType:'application/json',headers:{ 'Access-Control-Allow-Origin':menuOrigin,'Access-Control-Allow-Credentials':'true' },body:JSON.stringify(body) }); }
/** All API calls are intercepted fixtures. No real account or image provider is used. */
export async function menuFixtures(page:Page,options:{ count?:number; denied?:boolean; admin?:boolean; delayed?:boolean; rejected?:boolean }={}) {
 const image=await readFile(menuArtworkFixturePath);
 const thumbnail=await readFile(path.join(process.cwd(),'public/brand/editorial-dinner.png'));
 const recipes=Array.from({ length:options.count ?? menuRecipes.length },(_,i) => menuRecipes[i] ?? { ...menuRecipes[0],id:`menu-fixture-${i}`,title:`Extra dish ${i}` });
 const state={ posts:[] as Record<string,unknown>[],creations:[] as unknown[],writes:[] as string[],files:[] as string[],checks:[] as string[] };
 let finish=() => {}; const gate=new Promise<void>(resolve => { finish=resolve; });
 await page.route(`${API_BASE}/**`,async route => {
  const request=route.request(),pathname=new URL(request.url()).pathname;
  if (request.method() === 'OPTIONS') return route.fulfill({ status:204,headers:{ 'Access-Control-Allow-Origin':menuOrigin,'Access-Control-Allow-Credentials':'true','Access-Control-Allow-Methods':'GET,POST,PATCH,OPTIONS','Access-Control-Allow-Headers':'content-type' } });
  if (pathname === '/auth/me') return menuJson(route,{ id:'menu-fixture-account',email:'menu-fixture@example.test',is_library_public:false });
  if (pathname.startsWith('/recipes') && ['POST','PATCH','DELETE'].includes(request.method())) state.writes.push(pathname);
  if (pathname === '/recipes') return menuJson(route,recipes);
  if (pathname === '/recipes/page') return menuJson(route,{ items:recipes.slice(0,4),next_cursor:recipes.length > 4 ? 'next-fixture-page' : null });
  if (pathname === '/recipes/catalog/page') return menuJson(route,{ items:recipes.slice(0,2),next_cursor:null });
  if (pathname === '/menus/access') return menuJson(route,{ allowed:!options.denied && (!state.posts.length || !!options.admin),is_admin:!!options.admin,daily_limit:options.admin ? null : 1,remaining:options.admin ? null : options.denied || state.posts.length ? 0 : 1,resets_at:'2026-09-28T00:00:00Z' });
  if (pathname === '/menus/creations') { state.creations.push(request.postDataJSON()); return menuJson(route,{ error:'Unexpected non-atomic admission' },500); }
  if (pathname === '/menus/artwork/access') return menuJson(route,{ enabled:true,allowed:true,reason:null,daily_limit:3,remaining:3,resets_at:'2026-09-28T00:00:00Z' });
  if (pathname === '/menus/artwork' && request.method() === 'POST') {
   state.posts.push(request.postDataJSON()); if (options.delayed) await gate;
   return menuJson(route,options.rejected ? { detail:{ code:'menu_daily_limit',message:'Daily menu limit reached' } } : { request_id:request.postDataJSON().request_id,status:'completed',file_url:'https://fixture.invalid/never-fetch' },options.rejected ? 429 : 200);
  }
  if (pathname.startsWith('/menus/artwork/') && !pathname.endsWith('/file')) { const id=pathname.split('/').pop()!; state.checks.push(id); return menuJson(route,{ request_id:id,status:'completed' }); }
  if (pathname.endsWith('/file')) { state.files.push(pathname); return route.fulfill({ status:200,contentType:'image/png',body:image,headers:{ 'Access-Control-Allow-Origin':menuOrigin,'Access-Control-Allow-Credentials':'true' } }); }
  if (pathname.startsWith('/uploads/menu-fixture/')) return route.fulfill({ status:200,contentType:'image/png',body:thumbnail });
  if (pathname === '/cooking-session/active') return menuJson(route,null);
  return menuJson(route,[]);
 });
 return { state,recipes,finish };
}
export async function openSimpleMenu(page:Page) { await page.goto(`${menuOrigin}/library`); await page.getByRole('button',{ name:'Make a menu',exact:true }).click(); }

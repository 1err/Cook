import { expect, test, type Page } from "@playwright/test";
import { API_BASE } from "./api";
import { recipePageFixture } from "./recipePageFixture";
const photo="data:image/svg+xml,"+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="320" height="240"><rect width="320" height="240" fill="#af7351"/></svg>');
const recipe={id:"shared-recipe",title:"Shared noodles",description:"A shared dinner.",thumbnail_url:photo,source_url:"https://example.com/recipe",ingredients:[{name:"Noodles",quantity:"200 g"}],steps:[{text:"Cook the noodles.",image_url:photo}],is_public_catalog:true,library_tags:["weeknight"],shared_media_status:"pending"};
async function fixtures(page:Page,origin:string){
 const calls:string[]=[], errors:string[]=[];page.on("pageerror",error=>errors.push(error.message));
 await page.addInitScript(()=>localStorage.setItem("cooking-ui-language","en"));
 await page.route(`${API_BASE}/**`,async route=>{
  const request=route.request(),url=new URL(request.url()),path=url.pathname;
  const headers={"Access-Control-Allow-Origin":origin,"Access-Control-Allow-Credentials":"true"};
  if(request.method()==="OPTIONS")return route.fulfill({status:204,headers:{...headers,"Access-Control-Allow-Headers":request.headers()["access-control-request-headers"]??"content-type,x-chef-world-account-id","Access-Control-Allow-Methods":"GET,POST,DELETE,OPTIONS"}});
  calls.push(`${request.method()} ${path}`);
  if(path==="/auth/me")return route.fulfill({headers,json:{id:"viewer",email:"viewer@example.com",is_library_public:true,is_admin:false,email_verified:true,email_verification_required:true}});
  if(path==="/auth/capabilities")return route.fulfill({headers,json:{email_verification:false,password_recovery:false}});
  if(path==="/recipes/catalog/page" || path==="/users/friend/recipes/page")return route.fulfill({headers,json:recipePageFixture([recipe],request.url())});
  if(path==="/recipes/catalog")return route.fulfill({headers,json:[recipe]});
  if(path==="/recipes/page" || path==="/recipes")return route.fulfill({headers,json:path.endsWith('/page')?recipePageFixture([],request.url()):[]});
  if(path==="/users/friend/recipes/shared-recipe")return route.fulfill({headers,json:{...recipe,already_saved:false}});
  if(path.endsWith("/copy")){
   expect(request.headers()["x-chef-world-account-id"]).toBe("viewer");
   return route.fulfill({headers,json:{...recipe,id:"saved-copy",is_public_catalog:false,catalog_source_recipe_id:recipe.id}});
  }
  if(path==="/analytics/events")return route.fulfill({status:202,headers,json:{ok:true}});
  return route.fulfill({headers,json:[]});
 });
 return {calls,errors};
}
async function clean(page:Page){
 await expect(page.getByRole("button",{name:/Report recipe|Block user|Block author|Unblock|Approve photos|Reject photos/i})).toHaveCount(0);
 await expect(page.getByText(/Photos awaiting review|Photos unavailable for sharing|Copies include text only|You have no blocked accounts/i)).toHaveCount(0);
 await expect(page.getByRole("heading",{name:"Blocked accounts"})).toHaveCount(0);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
}
async function originalPhoto(page:Page){
 const dish=page.locator('img[src^="data:image/svg+xml,"]').first();await expect(dish).toBeVisible();
 await expect.poll(()=>dish.evaluate(node=>(node as HTMLImageElement).complete && (node as HTMLImageElement).naturalWidth>0)).toBe(true);
}
for(const surface of ["catalog","public detail","friend library","friend detail"] as const){
 test(`${surface} retains photos and copying with the original clean sharing UI`,async({page},info)=>{
  const evidence=await fixtures(page,new URL(info.project.use.baseURL as string).origin);
  const path=surface==="catalog"?"/library?view=public":surface==="public detail"?"/library/public/shared-recipe":surface==="friend library"?"/library/friends/friend?email=friend@example.com":"/library/friends/friend/shared-recipe?email=friend@example.com";
  await page.goto(path);await expect(page.getByRole("heading",{name:"Shared noodles",exact:true})).toBeVisible();
  await originalPhoto(page);await clean(page);
  const copy=page.getByRole("button",{name:surface==="catalog"?/Add to my library: Shared noodles/:surface==="public detail"?"Add to my library":"Add to library",exact:surface!=="catalog"}).first();
  await expect(copy).toBeEnabled();await copy.click();
  await expect.poll(()=>evidence.calls.some(call=>call.startsWith('POST ')&&call.endsWith('/copy'))).toBe(true);
  await clean(page);expect(evidence.errors).toEqual([]);
  expect(evidence.calls.filter(call=>/\/users\/(blocks|reports)|\/admin\/(media-reviews|content-reports)|\/block$/.test(call))).toEqual([]);
  await page.screenshot({path:`/private/tmp/chefworld-sharing-restored-${surface.replaceAll(' ','-')}-${info.project.name}.png`,fullPage:true});
 });
}
test("Settings and Friends retain sharing/account controls without a blocked-accounts box",async({page},info)=>{
 const evidence=await fixtures(page,new URL(info.project.use.baseURL as string).origin);
 await page.goto('/settings');await expect(page.getByRole('checkbox',{name:'Share my library'})).toBeChecked();
 await expect(page.getByRole('button',{name:'Delete account',exact:true})).toBeVisible();await expect(page.getByText('Email verified',{exact:true})).toBeVisible();await clean(page);
 await page.getByRole('button',{name:'Account for viewer@example.com'}).click();await expect(page.locator('a[href="/moderation"]')).toHaveCount(0);await expect(page.getByRole('link',{name:'Delete account',exact:true})).toBeVisible();
 await page.goto('/library/friends');await expect(page.getByRole('heading',{name:'Find a friend'})).toBeVisible();await clean(page);
 expect(evidence.calls).not.toContain('GET /users/blocks');expect(evidence.errors).toEqual([]);
});

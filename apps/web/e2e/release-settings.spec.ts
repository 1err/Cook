import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { API_BASE } from "./api";

test("phone Settings deletion supports cancel, wrong-password retry and successful sign-out", async ({page}, info) => {
 let deleted=false;
 const attempts:string[]=[];
 const origin = new URL(info.project.use.baseURL as string).origin;
 await page.route(`${API_BASE}/**`,async route=>{
  const request=route.request(),path=new URL(request.url()).pathname;
  const headers={"Access-Control-Allow-Origin":origin,"Access-Control-Allow-Credentials":"true"};
  if(request.method()==="OPTIONS") return route.fulfill({status:204,headers:{...headers,"Access-Control-Allow-Headers":request.headers()["access-control-request-headers"] ?? "content-type,x-chef-world-account-id","Access-Control-Allow-Methods":"GET,POST,DELETE,OPTIONS"}});
  if(path==="/auth/account" && request.method()==="DELETE"){
   expect(request.headers()["x-chef-world-account-id"]).toBe("release-fixture");
   const password=request.postDataJSON().password as string;attempts.push(password);
   if(password!=="fixture-password") return route.fulfill({status:403,headers,json:{detail:"Incorrect password"}});
   deleted=true;return route.fulfill({headers,json:{ok:true}});
  }
  if(path==="/users/blocks") return route.fulfill({headers,json:{users:[]}});
  if(path==="/auth/capabilities") return route.fulfill({headers,json:{email_verification:false}});
  if(path==="/auth/me") return route.fulfill({status:deleted?401:200,headers,json:deleted?{detail:"Sign in"}:{id:"release-fixture",email:"release@example.com",is_library_public:false}});
  return route.fulfill({headers,json:[]});
 });
 const errors:string[]=[];page.on("pageerror",error=>errors.push(error.message));
 await page.goto("/settings");
 await page.getByRole("button",{name:"Delete account",exact:true}).click();
 await page.getByLabel("Current password").fill("fixture-password");
 await page.getByRole("button",{name:"Cancel",exact:true}).click();
 expect(attempts).toEqual([]);
 await page.getByRole("button",{name:"Delete account",exact:true}).click();
 await page.getByLabel("Current password").fill("wrong");
 await page.getByRole("checkbox").last().check();
 await page.getByRole("button",{name:"Delete account permanently",exact:true}).click();
 await expect(page.getByRole("main").getByRole("alert")).toHaveText("The password is incorrect. Your account has not been deleted.");
 await expect(page.getByLabel("Current password")).toHaveValue("wrong");
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
 const results=await new AxeBuilder({page}).withTags(["wcag2a","wcag2aa","wcag21aa"]).analyze();
 expect(results.violations,JSON.stringify(results.violations)).toEqual([]);
 await page.screenshot({path:`/private/tmp/chefworld-release-settings-${info.project.name}.png`,fullPage:true});
 await page.getByLabel("Current password").fill("fixture-password");
 await page.getByRole("button",{name:"Delete account permanently",exact:true}).click();
 await expect(page).toHaveURL(/\/login(?:\?|$)/);expect(attempts).toEqual(["wrong","fixture-password"]);expect(errors).toEqual([]);
});

import { afterEach, expect, test, vi } from "vitest";
import { ApiError, createApiClient } from "./index";
afterEach(() => vi.unstubAllGlobals());
const client = () => createApiClient({ baseUrl: "https://api.example", auth: { kind: "bearer", getToken: () => "current-token" } });
test("deletion targets the authenticated account, verifies password and excludes OS cookies", async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response('{"ok":true}'));
  vi.stubGlobal("fetch", fetcher);
  await client().auth.deleteAccount("synthetic-password");
  const [url, init] = fetcher.mock.calls[0];
  expect(url).toBe("https://api.example/auth/account");
  expect(init.method).toBe("DELETE");
  expect(JSON.parse(init.body)).toEqual({ password: "synthetic-password" });
  expect(init.credentials).toBe("omit");
  expect(init.headers.get("Authorization")).toBe("Bearer current-token");
});
test("wrong delete password does not trigger auth expiry", async () => {
  const unauthorized = vi.fn();
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response('{"detail":"Incorrect password"}', {status:403})));
  const api = createApiClient({ baseUrl:"https://api.example", auth:{kind:"cookie"}, onUnauthorized:unauthorized });
  await expect(api.auth.deleteAccount("wrong")).rejects.toMatchObject({status:403,message:"Incorrect password"} satisfies Partial<ApiError>);
  expect(unauthorized).not.toHaveBeenCalled();
});
test("report, block, unblock and author block use encoded server-authorized endpoints", async () => {
  const fetcher = vi.fn().mockImplementation(() => Promise.resolve(new Response('{"ok":true}')));
  vi.stubGlobal("fetch", fetcher);
  const api=client();
  await api.users.reportRecipe("recipe/id","privacy","Personal data");
  await api.users.blockUser("friend/id");
  await api.users.unblockUser("friend/id");
  await api.users.blockRecipeAuthor("recipe/id");
  expect(fetcher.mock.calls.map(([url,init])=>[url,init.method])).toEqual([
    ["https://api.example/users/reports","POST"],
    ["https://api.example/users/friend%2Fid/block","PUT"],
    ["https://api.example/users/friend%2Fid/block","DELETE"],
    ["https://api.example/users/recipe-authors/recipe%2Fid/block","PUT"]
  ]);
  expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({recipe_id:"recipe/id",reason:"privacy",notes:"Personal data"});
});

test("cookie safety actions bind to the account shown by the UI",async()=>{
 const fetcher=vi.fn().mockImplementation(()=>Promise.resolve(new Response('{"ok":true}')));vi.stubGlobal("fetch",fetcher);
 const api=createApiClient({baseUrl:"https://api.example",auth:{kind:"cookie"}});
 await api.users.reportRecipe("recipe","privacy",undefined,"alice");await api.users.blockUser("friend","alice");await api.users.unblockUser("friend","alice");await api.users.blockRecipeAuthor("recipe","alice");await api.users.blockedUsers("alice");await api.moderation.list({expectedAccountId:"alice"});await api.moderation.resolve("report","dismiss",undefined,"alice");
 expect(fetcher.mock.calls.every(([,init])=>init.headers.get("X-Chef-World-Account-ID")==="alice")).toBe(true);
 expect(fetcher.mock.calls.every(([,init])=>init.credentials==="include")).toBe(true);
});

test("photo approval binds exact media digest and reviewing account",async()=>{
 const fetcher=vi.fn().mockResolvedValue(new Response('{}'));vi.stubGlobal("fetch",fetcher);
 const api=createApiClient({baseUrl:"https://api.example",auth:{kind:"cookie"}}), digest="a".repeat(64);
 await api.mediaReview.review("review/id","approve",digest,"Checked the photos","moderator");
 const [url,init]=fetcher.mock.calls[0];expect(url).toBe("https://api.example/admin/media-reviews/review%2Fid/review");expect(JSON.parse(init.body)).toEqual({decision:"approve",media_digest:digest,notes:"Checked the photos"});expect(init.headers.get("X-Chef-World-Account-ID")).toBe("moderator");
});


test("deletion and paged sharing reads bind to the account while keeping live query filters", async () => {
 const fetcher=vi.fn().mockImplementation(()=>Promise.resolve(new Response('{}')));vi.stubGlobal("fetch",fetcher);
 const api=createApiClient({baseUrl:"https://api.example",auth:{kind:"cookie"}});
 await api.auth.deleteAccount("password","alice");
 await api.recipes.catalogPage({q:"noodles",tags:["chinese"],cursor:"next",expectedAccountId:"alice"});
 await api.users.libraryPage("friend/id",{limit:20,expectedAccountId:"alice"});
 expect(fetcher.mock.calls.every(([,init])=>init.headers.get("X-Chef-World-Account-ID")==="alice")).toBe(true);
 expect(fetcher.mock.calls[1][0]).toBe("https://api.example/recipes/catalog/page?limit=40&cursor=next&q=noodles&tags=chinese");
 expect(fetcher.mock.calls[2][0]).toBe("https://api.example/users/friend%2Fid/recipes/page?limit=20");
});

test("media multipart upload keeps the browser boundary even with default JSON headers", async () => {
 const fetcher=vi.fn().mockResolvedValue(new Response('{}'));vi.stubGlobal("fetch",fetcher);
 const api=createApiClient({baseUrl:"https://api.example",auth:{kind:"cookie"},defaultHeaders:{"Content-Type":"application/json"}});
 const form=new FormData();form.append("file",new Blob(["synthetic media"]));
 await api.recipes.createMediaImportJob(form);
 expect(fetcher.mock.calls[0][1].headers.has("Content-Type")).toBe(false);
 expect(fetcher.mock.calls[0][1].body).toBe(form);
});


test.each(["page", "searchPage"] as const)("private %s reads retain the visible account identity", async method => {
  const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({items: [], has_more: false, total: 0, next_cursor: null})));
  vi.stubGlobal("fetch", fetcher);
  const api = createApiClient({baseUrl: "https://api.example", auth: {kind: "cookie"}});
  await api.recipes[method]({expectedAccountId: "alice"});
  expect(fetcher.mock.calls[0][1].headers.get("X-Chef-World-Account-ID")).toBe("alice");
  expect(fetcher.mock.calls[0][1].credentials).toBe("include");
});

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

import { expect, test, vi } from "vitest";
import { createApiClient } from "./index";
import { RecipePager } from "./recipePager";
test("ingredient filters and collection reach the server without being confused with title search",async()=>{
 const fetcher=vi.fn().mockResolvedValue(new Response(JSON.stringify({items:[],next_cursor:null,total_count:0})));
 vi.stubGlobal("fetch",fetcher);
 const client=createApiClient({baseUrl:"https://api.example.test",auth:{kind:"cookie"}});
 await client.recipes.searchPage({scope:"catalog",ingredients:["chicken","土豆"],match:"any",includeIngredients:true});
 const url=new URL(fetcher.mock.calls[0][0]);expect(url.pathname).toBe("/recipes/search/page");
 expect(url.searchParams.getAll("ingredients")).toEqual(["chicken","土豆"]);
 expect(url.searchParams.get("scope")).toBe("catalog");expect(url.searchParams.get("match")).toBe("any");expect(url.searchParams.has("q")).toBe(false);
 vi.unstubAllGlobals();
});
test("result count remains the full server count as subsequent pages are appended",async()=>{
 const fetcher=vi.fn().mockResolvedValueOnce({items:[{id:"a",title:"a",ingredient_count:0,step_count:0,already_saved:false}],next_cursor:"next",total_count:52}).mockResolvedValueOnce({items:[{id:"b",title:"b",ingredient_count:0,step_count:0,already_saved:false}],next_cursor:null,total_count:52});
 const pager=new RecipePager(fetcher);await pager.refresh();await pager.more();expect(pager.state.total).toBe(52);expect(pager.state.items).toHaveLength(2);
});

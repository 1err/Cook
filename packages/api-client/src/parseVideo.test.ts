import { afterEach, expect, test, vi } from "vitest";
import { createApiClient } from "./index";
afterEach(() => {vi.unstubAllGlobals();vi.useRealTimers();});
const client=()=>createApiClient({baseUrl:"https://api.example",auth:{kind:"bearer",getToken:()=>"synthetic"}});
const recipe={id:"draft",title:"Video recipe",ingredients:[]};
const response=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status});

test("native media compatibility uses multipart jobs and returns only the completed recipe",async()=>{
 vi.useFakeTimers();
 const fetcher=vi.fn().mockResolvedValueOnce(response({id:"job/one",status:"queued"}))
   .mockResolvedValueOnce(response({id:"job/one",status:"processing"}))
   .mockResolvedValueOnce(response({id:"job/one",status:"completed",recipe}));
 vi.stubGlobal("fetch",fetcher);const form=new FormData();form.append("file",new Blob(["synthetic video"]));
 const pending=client().recipes.parseVideo(form);
 await vi.runAllTimersAsync();expect(await pending).toEqual(recipe);
 expect(fetcher.mock.calls.map(([url,init])=>[url,init.method??"GET"])).toEqual([
 ["https://api.example/recipes/import-jobs/media","POST"],
 ["https://api.example/recipes/import-jobs/job%2Fone","GET"],
 ["https://api.example/recipes/import-jobs/job%2Fone","GET"]]);
 expect(fetcher.mock.calls[0][1].body).toBe(form);expect(fetcher.mock.calls[0][1].headers.has("Content-Type")).toBe(false);
 expect(fetcher.mock.calls.every(([,init])=>init.credentials==="omit")).toBe(true);
});

test("cancel during media upload waits for its job ID then cancels without publishing a draft",async()=>{
 let finish!:(value:Response)=>void;
 const fetcher=vi.fn().mockImplementationOnce(()=>new Promise<Response>(resolve=>{finish=resolve;})).mockResolvedValue(response({id:"job",status:"cancelled"}));
 vi.stubGlobal("fetch",fetcher);const controller=new AbortController();
 const pending=client().recipes.parseVideo(new FormData(),{signal:controller.signal});
 const rejected=expect(pending).rejects.toMatchObject({name:"AbortError"});controller.abort();
 finish(response({id:"job",status:"queued"}));await rejected;
 expect(fetcher.mock.calls[1][0]).toBe("https://api.example/recipes/import-jobs/job");
 expect(fetcher.mock.calls[1][1].method).toBe("DELETE");
});

test("failed media job retains the provider-safe server error and never returns a partial draft",async()=>{
 vi.stubGlobal("fetch",vi.fn().mockResolvedValue(response({id:"job",status:"failed",recipe,error:{code:"unavailable",message:"Video analysis unavailable"}})));
 await expect(client().recipes.parseVideo(new FormData())).rejects.toThrow("Video analysis unavailable");
});

test("already cancelled media import makes no API call",async()=>{
 const fetcher=vi.fn();vi.stubGlobal("fetch",fetcher);const controller=new AbortController();controller.abort();
 await expect(client().recipes.parseVideo(new FormData(),{signal:controller.signal})).rejects.toMatchObject({name:"AbortError"});
 expect(fetcher).not.toHaveBeenCalled();
});

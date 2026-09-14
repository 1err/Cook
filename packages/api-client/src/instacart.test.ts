import { afterEach, expect, it, vi } from "vitest";
import { ApiError, createApiClient } from "./index";

afterEach(() => vi.unstubAllGlobals());

it("sends an authenticated list and cancellation signal without provider credentials", async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ url: "https://www.instacart.com/store/recipes/1" })));
  vi.stubGlobal("fetch", fetcher);
  const client = createApiClient({ baseUrl: "http://localhost:8000", auth: { kind: "bearer", getToken: () => "app-token" } });
  const signal = new AbortController().signal;
  const body = { title: "Groceries", items: [{ name: "Rice", quantity: "2 cups" }] };
  expect(await client.shopping.createInstacartLink(body, { signal })).toEqual({ url: "https://www.instacart.com/store/recipes/1" });
  const [url, options] = fetcher.mock.calls[0];
  expect(url).toBe("http://localhost:8000/shopping-list/instacart");
  expect(options.method).toBe("POST");
  expect(options.signal).toBe(signal);
  expect(JSON.parse(options.body)).toEqual(body);
  expect(options.headers.get("Authorization")).toBe("Bearer app-token");
});

it("preserves the missing-setup error code and cookie auth", async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ detail: { code: "instacart_not_configured", message: "Not connected" } }), { status: 503 }));
  vi.stubGlobal("fetch", fetcher);
  const client = createApiClient({ baseUrl: "http://localhost:8000", auth: { kind: "cookie" } });
  await expect(client.shopping.createInstacartLink({ title: "Groceries", items: [] })).rejects.toMatchObject({
    name: "ApiError", code: "instacart_not_configured", status: 503,
  } satisfies Partial<ApiError>);
  expect(fetcher.mock.calls[0][1].credentials).toBe("include");
});

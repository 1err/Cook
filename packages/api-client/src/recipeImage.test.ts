import { afterEach, expect, it, vi } from "vitest";
import { createApiClient } from "./index";

afterEach(() => vi.unstubAllGlobals());

it("uses cookie auth and sends one idempotent image request with an abort signal", async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({
    request_id: "a4198bd0-7dfb-4e4e-8c2e-1dfb95d86a24", status: "completed", file_url: "https://images.example/cover.png",
  })));
  vi.stubGlobal("fetch", fetcher);
  const client = createApiClient({ baseUrl: "https://api.example", auth: { kind: "cookie" } });
  const signal = new AbortController().signal;
  const payload = { request_id: "a4198bd0-7dfb-4e4e-8c2e-1dfb95d86a24", title: "Tofu", description: "", ingredients: ["tofu"], steps: [] };
  await expect(client.recipes.generateImage(payload, { signal })).resolves.toMatchObject({ status: "completed" });
  const [url, options] = fetcher.mock.calls[0];
  expect(url).toBe("https://api.example/recipes/generate-image");
  expect(options.credentials).toBe("include");
  expect(options.method).toBe("POST");
  expect(options.signal).toBe(signal);
  expect(JSON.parse(options.body)).toEqual(payload);
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it("reads access and request status with native bearer auth", async () => {
  const fetcher = vi.fn().mockImplementation(() => Promise.resolve(new Response("{}")));
  vi.stubGlobal("fetch", fetcher);
  const client = createApiClient({ baseUrl: "https://api.example/", auth: { kind: "bearer", getToken: () => "app-token" } });
  await client.recipes.imageGenerationAccess();
  await client.recipes.imageGenerationStatus("request/id");
  expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
    "https://api.example/recipes/image-generation/access",
    "https://api.example/recipes/image-generation/request%2Fid",
  ]);
  for (const [, options] of fetcher.mock.calls) {
    expect(options.credentials).toBe("omit");
    expect(options.headers.get("Authorization")).toBe("Bearer app-token");
  }
});

it("preserves membership and quota error codes without retrying the provider request", async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({
    detail: { code: "daily_limit", message: "Today's image limit has been reached." },
  }), { status: 429 }));
  vi.stubGlobal("fetch", fetcher);
  const client = createApiClient({ baseUrl: "https://api.example", auth: { kind: "cookie" } });
  await expect(client.recipes.generateImage({ request_id: "request", title: "Tofu", description: "", ingredients: [], steps: [] }))
    .rejects.toMatchObject({ status: 429, code: "daily_limit" });
  expect(fetcher).toHaveBeenCalledTimes(1);
});

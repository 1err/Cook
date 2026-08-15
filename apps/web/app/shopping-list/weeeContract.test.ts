import { afterEach, expect, test, vi } from "vitest";
import { createApiClient } from "@cooking/api-client";

afterEach(() => vi.unstubAllGlobals());

test("requests Weee products without a store selector", async () => {
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(JSON.stringify([]), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
  );
  vi.stubGlobal("fetch", fetchMock);

  const client = createApiClient({
    baseUrl: "https://api.example.test",
    auth: { kind: "cookie" },
  });

  await client.shopping.storeProducts("silken tofu");

  expect(fetchMock).toHaveBeenCalledWith(
    "https://api.example.test/store-products?query=silken%20tofu",
    expect.objectContaining({ credentials: "include" }),
  );
});

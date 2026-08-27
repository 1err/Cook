import { afterEach, expect, test, vi } from "vitest";
import { createApiClient, type StoreProductsBatchResponse } from "@cooking/api-client";
import { isSafeWeeeProductUrl } from "@cooking/shared";

afterEach(() => vi.unstubAllGlobals());

test("requests Weee products without a store selector", async () => {
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ products: [], expires_at: null }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
  );
  vi.stubGlobal("fetch", fetchMock);

  const client = createApiClient({
    baseUrl: "https://api.example.test",
    auth: { kind: "cookie" },
  });

  await expect(client.shopping.storeProducts("silken tofu")).resolves.toEqual({
    products: [],
    expires_at: null,
  });

  expect(fetchMock).toHaveBeenCalledWith(
    "https://api.example.test/store-products?query=silken%20tofu",
    expect.objectContaining({ credentials: "include" }),
  );
});

test("posts a cache-only product batch without a store selector", async () => {
  const payload = {
    entries: [
      { query: "garlic", status: "missing", products: [], expires_at: null },
    ],
  } satisfies StoreProductsBatchResponse;
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
  );
  vi.stubGlobal("fetch", fetchMock);
  const client = createApiClient({
    baseUrl: "https://api.example.test",
    auth: { kind: "cookie" },
  });

  await expect(client.shopping.storeProductsBatch(["garlic"])).resolves.toEqual(payload);
  expect(fetchMock).toHaveBeenCalledWith(
    "https://api.example.test/store-products/batch",
    expect.objectContaining({
      method: "POST",
      credentials: "include",
      body: JSON.stringify({ queries: ["garlic"] }),
    }),
  );
});

test.each([
  "https://sayweee.com/product/tofu",
  "https://WWW.SAYWEEE.COM/product/tofu",
  "https://shop.sayweee.com/product/tofu",
  "https://sayweee.com:443/product/tofu",
  "https://www.weee.com/en/product/Dutch-Farms-Grade-A-Jumbo-Eggs/108411",
  "https://shop.weee.com/zh/product/tofu/100",
])("accepts a safe Weee product URL: %s", (url) => {
  expect(isSafeWeeeProductUrl(url)).toBe(true);
});

test.each([
  "http://sayweee.com/product/tofu",
  "https://sayweee.com.evil.test/product/tofu",
  "https://evil-sayweee.com/product/tofu",
  "https://user@sayweee.com/product/tofu",
  "https://sayweee.com:444/product/tofu",
  "https://sayweee.com/search?query=tofu",
  "https://weee.com.evil.test/en/product/tofu/1",
  "https://evil-weee.com/en/product/tofu/1",
])("rejects an unsafe Weee product URL: %s", (url) => {
  expect(isSafeWeeeProductUrl(url)).toBe(false);
});

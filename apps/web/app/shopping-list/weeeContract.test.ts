import { afterEach, expect, test, vi } from "vitest";
import { createApiClient } from "@cooking/api-client";
import { isSafeWeeeProductUrl } from "@cooking/shared";

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

test.each([
  "https://sayweee.com/product/tofu",
  "https://WWW.SAYWEEE.COM/product/tofu",
  "https://shop.sayweee.com/product/tofu",
  "https://sayweee.com:443/product/tofu",
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
])("rejects an unsafe Weee product URL: %s", (url) => {
  expect(isSafeWeeeProductUrl(url)).toBe(false);
});

import { afterEach, expect, test, vi } from "vitest";
import { createApiClient } from "./index";

const product = { name: "Corn starch", price: "$2.99", image: "", url: "https://www.sayweee.com/en/product/corn-starch/123" };
const client = () => createApiClient({ baseUrl: "https://api.example.test", auth: { kind: "bearer", getToken: () => "test-token" } });
const localStart = Date.parse("2026-09-24T17:41:25Z");

function serve(body: unknown, elapsedMs = 0) {
  vi.spyOn(Date, "now").mockReturnValue(localStart);
  vi.stubGlobal("fetch", async () => {
    vi.mocked(Date.now).mockReturnValue(localStart + elapsedMs);
    return new Response(JSON.stringify(body), { status: 200 });
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

test.each([
  ["behind", "2026-09-24T17:41:27Z", "2026-09-25T17:41:27Z"],
  ["ahead", "2026-09-24T17:41:23Z", "2026-09-25T17:41:23Z"],
])("fresh products load on the first response when the device clock is %s", async (_, serverTime, expiresAt) => {
  serve({ products: [product], expires_at: expiresAt, server_time: serverTime });
  expect(await client().shopping.storeProducts("淀粉")).toEqual({
    products: [product], expires_at: "2026-09-25T17:41:25.000Z",
  });
});

test("charges request latency against freshness instead of granting a new TTL on receipt", async () => {
  serve({ products: [product], expires_at: "2026-09-25T17:41:38Z", server_time: "2026-09-24T17:41:39Z" }, 12_000);
  expect((await client().shopping.storeProducts("淀粉")).expires_at).toBe("2026-09-25T17:41:24.000Z");
});

test("translates batch hits using the same clock and preserves misses and product age", async () => {
  serve({ server_time: "2026-09-24T17:41:27Z", entries: [
    { query: "淀粉", status: "fresh", products: [product], expires_at: "2026-09-25T17:41:27Z" },
    { query: "rice", status: "fresh", products: [product], expires_at: "2026-09-24T18:41:27Z" },
    { query: "tofu", status: "missing", products: [], expires_at: null },
  ] });
  expect(await client().shopping.storeProductsBatch(["淀粉", "rice", "tofu"])).toEqual({ entries: [
    { query: "淀粉", status: "fresh", products: [product], expires_at: "2026-09-25T17:41:25.000Z" },
    { query: "rice", status: "fresh", products: [product], expires_at: "2026-09-24T18:41:25.000Z" },
    { query: "tofu", status: "missing", products: [], expires_at: null },
  ] });
});

test("keeps usable batch hits when another entry expires in transit or has invalid metadata", async () => {
  serve({ server_time: "2026-09-24T17:41:27Z", entries: [
    { query: "fresh", status: "fresh", products: [product], expires_at: "2026-09-25T17:41:27Z" },
    { query: "expired", status: "fresh", products: [product], expires_at: "2026-09-24T17:41:28Z" },
    { query: "invalid", status: "fresh", products: [product], expires_at: "not-a-date" },
  ] }, 1_000);
  expect(await client().shopping.storeProductsBatch(["fresh", "expired", "invalid"])).toEqual({ entries: [
    { query: "fresh", status: "fresh", products: [product], expires_at: "2026-09-25T17:41:25.000Z" },
    { query: "expired", status: "missing", products: [], expires_at: null },
    { query: "invalid", status: "missing", products: [], expires_at: null },
  ] });
});

test.each([
  ["expired", "2026-09-24T17:41:27Z", "2026-09-24T17:41:27Z"],
  ["future", "2026-09-25T17:41:27.001Z", "2026-09-24T17:41:27Z"],
  ["invalid expiry", "tomorrow", "2026-09-24T17:41:27Z"],
  ["ambiguous expiry timezone", "2026-09-25T17:41:27", "2026-09-24T17:41:27Z"],
  ["invalid server clock", "2026-09-25T17:41:27Z", "invalid"],
  ["ambiguous server timezone", "2026-09-25T17:41:27Z", "2026-09-24T17:41:27"],
])("rejects %s metadata instead of making it appear fresh", async (_, expiresAt, serverTime) => {
  serve({ products: [product], expires_at: expiresAt, server_time: serverTime });
  await expect(client().shopping.storeProducts("淀粉")).rejects.toThrow();
});

test("does not serve a response whose remaining lifetime elapsed in transit", async () => {
  serve({ products: [product], expires_at: "2026-09-24T17:41:28Z", server_time: "2026-09-24T17:41:27Z" }, 1_000);
  await expect(client().shopping.storeProducts("淀粉")).rejects.toThrow();
});

test("preserves confirmed empty results without manufacturing an expiry", async () => {
  serve({ products: [], expires_at: null, server_time: "2026-09-24T17:41:27Z" });
  expect(await client().shopping.storeProducts("unmatched")).toEqual({ products: [], expires_at: null });
});

test("keeps old server responses compatible without relaxing their absolute expiry", async () => {
  const legacy = { products: [product], expires_at: "2026-09-25T16:00:00Z" };
  serve(legacy);
  expect(await client().shopping.storeProducts("淀粉")).toEqual(legacy);
});

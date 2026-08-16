import { expect, test, vi } from "vitest";
import type { StoreProduct, StoreProductsResponse } from "@cooking/api-client";
import type { ProductLookupState } from "./productLoading";
import {
  buildProductLookupStorage,
  canonicalIngredientKey,
  createProductLookupCoordinator,
  parseProductLookupStorage,
  parseStoreProductsResponse,
} from "./productLookupCoordinator";

const FUTURE_EXPIRES_AT = "2099-01-01T00:00:00.000Z";

function product(name: string): StoreProduct {
  return {
    name,
    price: "$1",
    image: "",
    url: `https://www.sayweee.com/product/${encodeURIComponent(name)}`,
  };
}

function response(products: StoreProduct[]): StoreProductsResponse {
  return {
    products,
    expires_at: products.length ? FUTURE_EXPIRES_AT : null,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

test("canonicalizes ingredient identity across spelling aliases", () => {
  expect(canonicalIngredientKey("  Rice ")).toBe("rice");
  expect(canonicalIngredientKey("RICE")).toBe("rice");
});

test("caps combined manual and bulk work at four and deduplicates aliases in flight", async () => {
  const releases = new Map<string, ReturnType<typeof deferred<StoreProductsResponse>>>();
  const started: string[] = [];
  let active = 0;
  let peak = 0;
  const load = vi.fn((query: string) => {
    started.push(query);
    active += 1;
    peak = Math.max(peak, active);
    const release = deferred<StoreProductsResponse>();
    releases.set(query, release);
    return release.promise.finally(() => {
      active -= 1;
    });
  });
  const coordinator = createProductLookupCoordinator({
    load,
    shouldPublish: () => true,
    onState: vi.fn(),
  });

  const manual = coordinator.request("Rice", 1);
  const alias = coordinator.request(" rice ", 1);
  const bulk = ["Beans", "Milk", "Eggs", "Flour"].map((name) =>
    coordinator.request(name, 1),
  );

  expect(alias).toBe(manual);
  await vi.waitFor(() => expect(started).toEqual(["Rice", "Beans", "Milk", "Eggs"]));
  expect(peak).toBe(4);
  releases.get("Rice")?.resolve(response([product("Rice")]));
  await vi.waitFor(() => expect(started).toEqual(["Rice", "Beans", "Milk", "Eggs", "Flour"]));
  for (const [query, release] of releases) {
    if (query !== "Rice") release.resolve(response([product(query)]));
  }
  await Promise.all([manual, alias, ...bulk]);

  expect(load).toHaveBeenCalledTimes(5);
  expect(peak).toBe(4);
});

test("a completed empty lookup can be retried through the same coordinator", async () => {
  const load = vi
    .fn<(query: string) => Promise<StoreProductsResponse>>()
    .mockResolvedValueOnce(response([]))
    .mockResolvedValueOnce(response([product("Rice")]));
  const transitions: ProductLookupState[] = [];
  const coordinator = createProductLookupCoordinator({
    load,
    shouldPublish: () => true,
    onState: (_key, state) => transitions.push(state),
  });

  await expect(coordinator.request("Rice", 1)).resolves.toEqual({
    status: "empty",
    products: [],
  });
  await expect(coordinator.request(" rice ", 1)).resolves.toEqual({
    status: "success",
    products: [product("Rice")],
    expiresAt: FUTURE_EXPIRES_AT,
  });

  expect(load).toHaveBeenCalledTimes(2);
  expect(transitions.map(({ status }) => status)).toEqual([
    "queued",
    "loading",
    "empty",
    "queued",
    "loading",
    "success",
  ]);
});

test("a failed lookup can be retried without publishing technical details", async () => {
  const load = vi
    .fn<(query: string) => Promise<StoreProductsResponse>>()
    .mockRejectedValueOnce(new Error("upstream socket closed"))
    .mockResolvedValueOnce(response([product("Rice")]));
  const transitions: ProductLookupState[] = [];
  const coordinator = createProductLookupCoordinator({
    load,
    shouldPublish: () => true,
    onState: (_key, state) => transitions.push(state),
  });

  await expect(coordinator.request("Rice", 1)).resolves.toEqual({ status: "error" });
  await expect(coordinator.request(" rice ", 1)).resolves.toEqual({
    status: "success",
    products: [product("Rice")],
    expiresAt: FUTURE_EXPIRES_AT,
  });

  expect(transitions[2]).toEqual({ status: "error" });
  expect(load).toHaveBeenCalledTimes(2);
});

test.each(["generation change", "unmount"])(
  "suppresses terminal state after %s",
  async (cancellation) => {
    let currentGeneration: number | null = 1;
    const release = deferred<StoreProductsResponse>();
    const transitions: Array<{ key: string; status: string; generation: number }> = [];
    const coordinator = createProductLookupCoordinator({
      load: () => release.promise,
      shouldPublish: (generation) => generation === currentGeneration,
      onState: (key, state, generation) =>
        transitions.push({ key, status: state.status, generation }),
    });

    const pending = coordinator.request("Rice", 1);
    await vi.waitFor(() =>
      expect(transitions.map(({ status }) => status)).toEqual(["queued", "loading"]),
    );
    currentGeneration = cancellation === "unmount" ? null : 2;
    release.resolve(response([product("Old rice")]));
    await pending;

    expect(transitions).toEqual([
      { key: "rice", status: "queued", generation: 1 },
      { key: "rice", status: "loading", generation: 1 },
    ]);
  },
);

test("does not start queued work after its generation is cancelled", async () => {
  let currentGeneration = 1;
  const releases: Array<ReturnType<typeof deferred<StoreProductsResponse>>> = [];
  const load = vi.fn(() => {
    const release = deferred<StoreProductsResponse>();
    releases.push(release);
    return release.promise;
  });
  const coordinator = createProductLookupCoordinator({
    load,
    shouldPublish: (generation) => generation === currentGeneration,
    onState: vi.fn(),
  });
  const requests = ["a", "b", "c", "d", "e"].map((name) =>
    coordinator.request(name, 1),
  );

  await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(4));
  currentGeneration = 2;
  releases[0].resolve(response([product("a")]));
  await expect(requests[4]).resolves.toEqual({ status: "idle" });
  expect(load).toHaveBeenCalledTimes(4);
  releases.slice(1).forEach((release, index) =>
    release.resolve(response([product(String(index))])),
  );
  await Promise.all(requests);
});

test("stores only canonical terminal states and strips technical errors", () => {
  const stored = buildProductLookupStorage(
    { Rice: true, " rice ": false, Tofu: true },
    {
      Rice: { status: "loading" },
      TOFU: {
        status: "success",
        products: [product("Tofu")],
        expiresAt: FUTURE_EXPIRES_AT,
      },
      Beans: { status: "empty", products: [] },
      Milk: { status: "error", error: "Network unavailable" },
    },
  );

  expect(stored).toEqual({
    open: { rice: true, tofu: true },
    lookup: {
      tofu: {
        status: "success",
        products: [product("Tofu")],
        expiresAt: FUTURE_EXPIRES_AT,
      },
      beans: { status: "empty", products: [] },
      milk: { status: "error" },
    },
  });
});

test("revalidates stored positives and every open key without a retained success", () => {
  const hydrated = parseProductLookupStorage(
    JSON.stringify({
      open: {
        Rice: true,
        " rice ": true,
        Waiting: true,
        Queued: true,
        Missing: true,
        Legacy: true,
      },
      lookup: {
        Rice: {
          status: "success",
          products: [product("Rice")],
          expiresAt: FUTURE_EXPIRES_AT,
        },
        " rice ": { status: "error", error: "old technical detail" },
        Waiting: { status: "loading" },
        Queued: { status: "queued" },
        Legacy: {
          status: "success",
          products: [product("Legacy")],
        },
        Closed: { status: "empty", products: [] },
      },
    }),
  );

  expect(hydrated).toEqual({
    open: {
      rice: true,
      waiting: true,
      queued: true,
      missing: true,
      legacy: true,
    },
    lookup: { closed: { status: "empty", products: [] } },
    revalidate: ["rice", "legacy", "waiting", "queued", "missing"],
  });
});

test("rejects missing, invalid, and expired authoritative expiry metadata", () => {
  const now = Date.parse("2026-08-15T12:00:00.000Z");
  const products = [product("Rice")];

  expect(() => parseStoreProductsResponse({ products }, now)).toThrow();
  expect(() => parseStoreProductsResponse({ products: [] }, now)).toThrow();
  expect(() =>
    parseStoreProductsResponse({ products, expires_at: "not-a-date" }, now),
  ).toThrow();
  expect(() =>
    parseStoreProductsResponse(
      { products, expires_at: "2026-08-15T12:00:00.000Z" },
      now,
    ),
  ).toThrow();
  expect(
    parseStoreProductsResponse(
      { products, expires_at: "2026-08-15T12:00:00.001Z" },
      now,
    ),
  ).toEqual({
    products,
    expires_at: "2026-08-15T12:00:00.001Z",
  });
  expect(parseStoreProductsResponse({ products: [], expires_at: null }, now)).toEqual({
    products: [],
    expires_at: null,
  });
});

test("does not persist a success at the exact authoritative expiry boundary", () => {
  const now = Date.parse("2026-08-15T12:00:00.000Z");
  const input = {
    Rice: {
      status: "success",
      products: [product("Rice")],
      expiresAt: "2026-08-15T12:00:00.000Z",
    },
    Tofu: {
      status: "success",
      products: [product("Tofu")],
      expiresAt: "2026-08-15T12:00:00.001Z",
    },
  };

  expect(buildProductLookupStorage({}, input, now).lookup).toEqual({
    tofu: input.Tofu,
  });
});

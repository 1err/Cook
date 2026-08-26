import { expect, test, vi } from "vitest";
import type {
  StoreProduct,
  StoreProductsBatchResponse,
  StoreProductsResponse,
} from "@cooking/api-client";
import type { ProductLookupState } from "./productLoading";
import {
  buildProductLookupStorage,
  canonicalIngredientKey,
  cleanIngredientQuery,
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
  expect(cleanIngredientQuery("  Jasmine   Rice ")).toBe("Jasmine Rice");
  expect(canonicalIngredientKey("  Jasmine   Rice ")).toBe("jasmine rice");
  expect(canonicalIngredientKey("RICE")).toBe("rice");
});

test("publishes batch hits before draining misses serially in visual order", async () => {
  const releases = new Map<string, ReturnType<typeof deferred<StoreProductsResponse>>>();
  let active = 0;
  let peak = 0;
  const load = vi.fn((query: string) => {
    active += 1;
    peak = Math.max(peak, active);
    const release = deferred<StoreProductsResponse>();
    releases.set(query, release);
    return release.promise.finally(() => {
      active -= 1;
    });
  });
  const loadBatch = vi.fn().mockResolvedValue({
    entries: [
      { query: "Rice", status: "fresh", products: [product("Cached rice")], expires_at: FUTURE_EXPIRES_AT },
      { query: "Beans", status: "missing", products: [], expires_at: null },
      { query: "Milk", status: "missing", products: [], expires_at: null },
    ],
  } satisfies StoreProductsBatchResponse);
  const transitions: Array<[string, string]> = [];
  const coordinator = createProductLookupCoordinator({
    load,
    loadBatch,
    shouldPublish: () => true,
    onState: (key, state) => transitions.push([key, state.status]),
  });

  const requests = coordinator.requestBulk(["Rice", "Beans", "Milk"], 1);
  await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(1));
  expect(transitions).toContainEqual(["rice", "success"]);
  expect(load).toHaveBeenNthCalledWith(1, "Beans");
  releases.get("Beans")?.resolve(response([product("Beans")]));
  await vi.waitFor(() => expect(load).toHaveBeenNthCalledWith(2, "Milk"));
  releases.get("Milk")?.resolve(response([product("Milk")]));
  await Promise.all(requests);

  expect(peak).toBe(1);
});

test("publishes interleaved fresh batch hits before a missing entry starts loading", async () => {
  const release = deferred<StoreProductsResponse>();
  const transitions: Array<[string, string]> = [];
  const load = vi.fn(() => release.promise);
  const coordinator = createProductLookupCoordinator({
    load,
    loadBatch: vi.fn().mockResolvedValue({
      entries: [
        { query: "Rice", status: "fresh", products: [product("Cached rice")], expires_at: FUTURE_EXPIRES_AT },
        { query: "Beans", status: "missing", products: [], expires_at: null },
        { query: "Milk", status: "fresh", products: [product("Cached milk")], expires_at: FUTURE_EXPIRES_AT },
      ],
    } satisfies StoreProductsBatchResponse),
    shouldPublish: () => true,
    onState: (key, state) => transitions.push([key, state.status]),
  });

  const requests = coordinator.requestBulk(["Rice", "Beans", "Milk"], 1);
  await vi.waitFor(() => expect(load).toHaveBeenCalledWith("Beans"));
  expect(transitions).toEqual(expect.arrayContaining([
    ["rice", "success"],
    ["milk", "success"],
  ]));
  expect(transitions.findIndex(([key, state]) => key === "beans" && state === "loading")).toBeGreaterThan(
    transitions.findIndex(([key, state]) => key === "milk" && state === "success"),
  );
  release.resolve(response([product("Beans")]));
  await Promise.all(requests);
});

test("mechanically equivalent visual inputs join one request using the first cleaned spelling", async () => {
  const release = deferred<StoreProductsResponse>();
  const load = vi.fn(() => release.promise);
  const coordinator = createProductLookupCoordinator({
    load,
    loadBatch: vi.fn(),
    shouldPublish: () => true,
    onState: vi.fn(),
  });

  const [first] = coordinator.requestBulk(
    [" Rice ", "rice", "  rice   "],
    1,
  );
  await vi.waitFor(() => expect(load).toHaveBeenCalledWith("Rice"));
  release.resolve(response([product("Rice")]));
  await expect(first).resolves.toMatchObject({ status: "success" });
});

test("a manual request queued behind an active bulk miss runs before the next bulk miss", async () => {
  const releases = new Map<string, ReturnType<typeof deferred<StoreProductsResponse>>>();
  const load = vi.fn((query: string) => {
    const release = deferred<StoreProductsResponse>();
    releases.set(query, release);
    return release.promise;
  });
  const coordinator = createProductLookupCoordinator({
    load,
    loadBatch: vi.fn().mockResolvedValue({
      entries: [
        { query: "Beans", status: "missing", products: [], expires_at: null },
        { query: "Milk", status: "missing", products: [], expires_at: null },
      ],
    } satisfies StoreProductsBatchResponse),
    shouldPublish: () => true,
    onState: vi.fn(),
  });

  const bulk = coordinator.requestBulk(["Beans", "Milk"], 1);
  await vi.waitFor(() => expect(load).toHaveBeenNthCalledWith(1, "Beans"));
  const manual = coordinator.request("Rice", 1);
  releases.get("Beans")?.resolve(response([product("Beans")]));
  await vi.waitFor(() => expect(load).toHaveBeenNthCalledWith(2, "Rice"));
  releases.get("Rice")?.resolve(response([product("Rice")]));
  await vi.waitFor(() => expect(load).toHaveBeenNthCalledWith(3, "Milk"));
  releases.get("Milk")?.resolve(response([product("Milk")]));
  await Promise.all([...bulk, manual]);
});

test("an already-running manual alias is excluded from the batch and its promise is joined", async () => {
  const manualRelease = deferred<StoreProductsResponse>();
  const batchRelease = deferred<StoreProductsResponse>();
  const load = vi.fn((query: string) => query === "Rice" ? manualRelease.promise : batchRelease.promise);
  const loadBatch = vi.fn().mockResolvedValue({
    entries: [{ query: "Beans", status: "missing", products: [], expires_at: null }],
  } satisfies StoreProductsBatchResponse);
  const coordinator = createProductLookupCoordinator({ load, loadBatch, shouldPublish: () => true, onState: vi.fn() });

  const manual = coordinator.request("Rice", 1);
  const [alias, bean] = coordinator.requestBulk([" rice ", "Beans"], 1);
  expect(alias).toBe(manual);
  await vi.waitFor(() => expect(loadBatch).toHaveBeenCalledWith(["Beans"]));
  manualRelease.resolve(response([product("Rice")]));
  await vi.waitFor(() => expect(load).toHaveBeenCalledWith("Beans"));
  batchRelease.resolve(response([product("Beans")]));
  await Promise.all([manual, alias, bean]);
});

test.each([
  "rejects",
  "has duplicate entries",
  "has an unknown entry",
  "omits a requested entry",
])("a batch that %s falls back to the serial miss queue", async (caseName) => {
  const load = vi.fn((query: string) => Promise.resolve(response([product(query)])));
  const malformed = {
    "has duplicate entries": { entries: [
      { query: "Rice", status: "missing", products: [], expires_at: null },
      { query: "Rice", status: "missing", products: [], expires_at: null },
    ] },
    "has an unknown entry": { entries: [
      { query: "Rice", status: "missing", products: [], expires_at: null },
      { query: "Unknown", status: "missing", products: [], expires_at: null },
    ] },
    "omits a requested entry": { entries: [
      { query: "Rice", status: "missing", products: [], expires_at: null },
    ] },
  } as Record<string, unknown>;
  const coordinator = createProductLookupCoordinator({
    load,
    loadBatch: vi.fn().mockImplementation(() => caseName === "rejects" ? Promise.reject(new Error("cache unavailable")) : Promise.resolve(malformed[caseName])),
    shouldPublish: () => true,
    onState: vi.fn(),
  });

  await Promise.all(coordinator.requestBulk(["Rice", "Beans"], 1));
  expect(load.mock.calls.map(([query]) => query)).toEqual(["Rice", "Beans"]);
});

test("a non-empty server response containing no safe products becomes error", async () => {
  const coordinator = createProductLookupCoordinator({
    load: vi.fn().mockResolvedValue({
      products: [{ name: "Unsafe", price: "$1", image: "", url: "https://evil.test/product/unsafe" }],
      expires_at: FUTURE_EXPIRES_AT,
    }),
    loadBatch: vi.fn(),
    shouldPublish: () => true,
    onState: vi.fn(),
  });

  await expect(coordinator.request("Rice", 1)).resolves.toEqual({ status: "error" });
});

test("generation cancellation suppresses batch and GET completion publication", async () => {
  let generation = 1;
  const batch = deferred<StoreProductsBatchResponse>();
  const get = deferred<StoreProductsResponse>();
  const transitions: string[] = [];
  const coordinator = createProductLookupCoordinator({
    load: () => get.promise,
    loadBatch: () => batch.promise,
    shouldPublish: (requestGeneration) => requestGeneration === generation,
    onState: (_key, state) => transitions.push(state.status),
  });

  const cached = coordinator.requestBulk(["Rice"], 1);
  generation = 2;
  batch.resolve({ entries: [{ query: "Rice", status: "fresh", products: [product("Rice")], expires_at: FUTURE_EXPIRES_AT }] });
  await Promise.all(cached);
  const live = coordinator.request("Beans", 2);
  await vi.waitFor(() => expect(transitions).toContain("loading"));
  generation = 3;
  get.resolve(response([product("Beans")]));
  await live;
  expect(transitions).not.toContain("success");
});

test("seventy-five fresh cache hits resolve without a live GET", async () => {
  const names = Array.from({ length: 75 }, (_, index) => `Ingredient ${index}`);
  const load = vi.fn();
  const coordinator = createProductLookupCoordinator({
    load,
    loadBatch: vi.fn().mockResolvedValue({
      entries: names.map((query) => ({ query, status: "fresh" as const, products: [product(query)], expires_at: FUTURE_EXPIRES_AT })),
    } satisfies StoreProductsBatchResponse),
    shouldPublish: () => true,
    onState: vi.fn(),
  });

  await Promise.all(coordinator.requestBulk(names, 1));
  expect(load).not.toHaveBeenCalled();
});

test("a completed empty lookup can be retried through the same coordinator", async () => {
  const load = vi
    .fn<(query: string) => Promise<StoreProductsResponse>>()
    .mockResolvedValueOnce(response([]))
    .mockResolvedValueOnce(response([product("Rice")]));
  const transitions: ProductLookupState[] = [];
  const coordinator = createProductLookupCoordinator({
    load,
    loadBatch: vi.fn(),
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
    loadBatch: vi.fn(),
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
      loadBatch: vi.fn(),
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
    loadBatch: vi.fn(),
    shouldPublish: (generation) => generation === currentGeneration,
    onState: vi.fn(),
  });
  const requests = ["a", "b", "c", "d", "e"].map((name) =>
    coordinator.request(name, 1),
  );

  await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(1));
  currentGeneration = 2;
  releases[0].resolve(response([product("a")]));
  await expect(requests[4]).resolves.toEqual({ status: "idle" });
  expect(load).toHaveBeenCalledTimes(1);
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

test("retains unexpired stored positives and revalidates every open key without one", () => {
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
    lookup: {
      rice: {
        status: "success",
        products: [product("Rice")],
        expiresAt: FUTURE_EXPIRES_AT,
      },
      closed: { status: "empty", products: [] },
    },
    revalidate: ["waiting", "queued", "missing", "legacy"],
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

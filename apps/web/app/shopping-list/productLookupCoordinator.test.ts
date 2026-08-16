import { expect, test, vi } from "vitest";
import type { StoreProduct } from "@cooking/api-client";
import type { ProductLookupState } from "./productLoading";
import {
  buildProductLookupStorage,
  canonicalIngredientKey,
  createProductLookupCoordinator,
  parseProductLookupStorage,
} from "./productLookupCoordinator";

function product(name: string): StoreProduct {
  return {
    name,
    price: "$1",
    image: "",
    url: `https://www.sayweee.com/product/${encodeURIComponent(name)}`,
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
  const releases = new Map<string, ReturnType<typeof deferred<StoreProduct[]>>>();
  const started: string[] = [];
  let active = 0;
  let peak = 0;
  const load = vi.fn((query: string) => {
    started.push(query);
    active += 1;
    peak = Math.max(peak, active);
    const release = deferred<StoreProduct[]>();
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
  releases.get("Rice")?.resolve([product("Rice")]);
  await vi.waitFor(() => expect(started).toEqual(["Rice", "Beans", "Milk", "Eggs", "Flour"]));
  for (const [query, release] of releases) {
    if (query !== "Rice") release.resolve([product(query)]);
  }
  await Promise.all([manual, alias, ...bulk]);

  expect(load).toHaveBeenCalledTimes(5);
  expect(peak).toBe(4);
});

test("a completed empty lookup can be retried through the same coordinator", async () => {
  const load = vi
    .fn<(query: string) => Promise<StoreProduct[]>>()
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([product("Rice")]);
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
    .fn<(query: string) => Promise<StoreProduct[]>>()
    .mockRejectedValueOnce(new Error("upstream socket closed"))
    .mockResolvedValueOnce([product("Rice")]);
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
  });

  expect(transitions[2]).toEqual({ status: "error" });
  expect(load).toHaveBeenCalledTimes(2);
});

test.each(["generation change", "unmount"])(
  "suppresses terminal state after %s",
  async (cancellation) => {
    let currentGeneration: number | null = 1;
    const release = deferred<StoreProduct[]>();
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
    release.resolve([product("Old rice")]);
    await pending;

    expect(transitions).toEqual([
      { key: "rice", status: "queued", generation: 1 },
      { key: "rice", status: "loading", generation: 1 },
    ]);
  },
);

test("does not start queued work after its generation is cancelled", async () => {
  let currentGeneration = 1;
  const releases: Array<ReturnType<typeof deferred<StoreProduct[]>>> = [];
  const load = vi.fn(() => {
    const release = deferred<StoreProduct[]>();
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
  releases[0].resolve([product("a")]);
  await expect(requests[4]).resolves.toEqual({ status: "idle" });
  expect(load).toHaveBeenCalledTimes(4);
  releases.slice(1).forEach((release, index) => release.resolve([product(String(index))]));
  await Promise.all(requests);
});

test("stores only canonical terminal states and strips technical errors", () => {
  const stored = buildProductLookupStorage(
    { Rice: true, " rice ": false, Tofu: true },
    {
      Rice: { status: "loading" },
      TOFU: { status: "success", products: [product("Tofu")] },
      Beans: { status: "empty", products: [] },
      Milk: { status: "error", error: "Network unavailable" },
    },
  );

  expect(stored).toEqual({
    open: { rice: true, tofu: true },
    lookup: {
      tofu: { status: "success", products: [product("Tofu")] },
      beans: { status: "empty", products: [] },
      milk: { status: "error" },
    },
  });
});

test("marks hydrated positives for backend revalidation without publishing them", () => {
  const hydrated = parseProductLookupStorage(
    JSON.stringify({
      open: { Rice: true, " rice ": true },
      lookup: {
        Rice: { status: "success", products: [product("Rice")] },
        " rice ": { status: "error", error: "old technical detail" },
        Waiting: { status: "loading" },
      },
    }),
  );

  expect(hydrated).toEqual({
    open: { rice: true },
    lookup: {},
    revalidate: ["rice"],
  });
});

import { act, renderHook, waitFor } from "@testing-library/react-native";
import type { StoreProduct, StoreProductsResponse } from "@cooking/api-client";
import { useStoreProductsCache } from "./useStoreProductsCache";

const mockStoreProducts = jest.fn();
const mockStoreProductsBatch = jest.fn();
const mockReadSmartProducts = jest.fn();
const mockWriteSmartProducts = jest.fn().mockResolvedValue(undefined);
const mockApiClient = {
  shopping: {
    storeProducts: mockStoreProducts,
    storeProductsBatch: mockStoreProductsBatch,
  },
};

jest.mock("../../lib/api", () => ({
  useApiClient: () => mockApiClient,
}));

jest.mock("./storage", () => ({
  readSmartProducts: (...args: unknown[]) => mockReadSmartProducts(...args),
  writeSmartProducts: (...args: unknown[]) => mockWriteSmartProducts(...args),
  isFreshStoredProductResponse: (value: unknown, nowMs: number) => {
    if (!value || typeof value !== "object") return false;
    const response = value as Partial<StoreProductsResponse>;
    return (
      Array.isArray(response.products) &&
      response.products.length > 0 &&
      typeof response.expires_at === "string" &&
      Date.parse(response.expires_at) > nowMs
    );
  },
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const FUTURE_EXPIRES_AT = "2099-01-01T00:00:00.000Z";
const RICE: StoreProduct = {
  name: "Rice",
  price: "$2.99",
  image: "",
  url: "https://www.sayweee.com/product/rice",
};
const BEANS: StoreProduct = {
  name: "Beans",
  price: "$1.99",
  image: "",
  url: "https://www.sayweee.com/product/beans",
};
const MILK: StoreProduct = {
  name: "Milk",
  price: "$3.99",
  image: "",
  url: "https://www.sayweee.com/product/milk",
};
const FOUR_PRODUCTS: StoreProduct[] = [
  RICE,
  BEANS,
  MILK,
  { name: "Tofu", price: "$2.49", image: "", url: "https://www.sayweee.com/product/tofu" },
];

function response(
  products: StoreProduct[],
  expiresAt: string | null = products.length ? FUTURE_EXPIRES_AT : null,
): StoreProductsResponse {
  return { products, expires_at: expiresAt };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockReadSmartProducts.mockResolvedValue(null);
});

afterEach(() => {
  jest.useRealTimers();
});

test("hydrates fresh stored positives immediately without batch or GET", async () => {
  mockReadSmartProducts.mockResolvedValue({
    open: { rice: true, tofu: false },
    products: { rice: response([RICE]), tofu: response([{ ...RICE, name: "Tofu", url: "https://www.sayweee.com/product/tofu" }]) },
    errors: { rice: null, tofu: null },
  });

  const { result } = await renderHook(() => useStoreProductsCache("2026-08-10"));

  await waitFor(() => expect(result.current.products.rice).toEqual([RICE]));
  expect(result.current.products.tofu?.[0]?.name).toBe("Tofu");
  expect(mockStoreProductsBatch).not.toHaveBeenCalled();
  expect(mockStoreProducts).not.toHaveBeenCalled();
});

test("caps hydrated persisted products at the first three choices", async () => {
  mockReadSmartProducts.mockResolvedValue({
    open: { rice: true },
    products: { rice: response(FOUR_PRODUCTS) },
    errors: { rice: null },
  });
  const { result } = await renderHook(() => useStoreProductsCache("2026-08-10"));

  await waitFor(() => expect(result.current.products.rice).toEqual(FOUR_PRODUCTS.slice(0, 3)));
});

test("caps live product responses at the first three choices", async () => {
  mockStoreProducts.mockResolvedValue(response(FOUR_PRODUCTS));
  const { result } = await renderHook(() => useStoreProductsCache("2026-08-10"));

  await act(async () => {
    await result.current.togglePanel("Rice");
  });
  expect(result.current.products.rice).toEqual(FOUR_PRODUCTS.slice(0, 3));
});

test("persists the first cleaned query spelling by canonical key", async () => {
  mockStoreProducts.mockResolvedValue(response([RICE]));
  const { result } = await renderHook(() => useStoreProductsCache("2026-08-10"));

  await act(async () => {
    await result.current.togglePanel("  RICE  ");
  });
  await waitFor(() => {
    const latest = mockWriteSmartProducts.mock.calls.at(-1)?.[1];
    expect(latest?.queries).toEqual({ rice: "RICE" });
  });
});

test("caps fresh batch product responses at the first three choices", async () => {
  mockStoreProductsBatch.mockResolvedValue({
    entries: [{ query: "Rice", status: "fresh", products: FOUR_PRODUCTS, expires_at: FUTURE_EXPIRES_AT }],
  });
  const { result } = await renderHook(() => useStoreProductsCache("2026-08-10"));

  await act(async () => {
    void result.current.loadAll(["Rice"]);
  });
  await waitFor(() => expect(result.current.products.rice).toEqual(FOUR_PRODUCTS.slice(0, 3)));
});

test("hydrates a fresh positive then batch-loads and serially GETs only open misses", async () => {
  mockReadSmartProducts.mockResolvedValue({
    open: { rice: true, beans: true },
    products: { rice: response([RICE]) },
    errors: { rice: null, beans: null },
  });
  mockStoreProductsBatch.mockResolvedValue({
    entries: [{ query: "beans", status: "missing", products: [], expires_at: null }],
  });
  mockStoreProducts.mockResolvedValue(response([BEANS]));

  const { result } = await renderHook(() => useStoreProductsCache("2026-08-10"));

  await waitFor(() => expect(result.current.products.rice).toEqual([RICE]));
  await waitFor(() => expect(mockStoreProductsBatch).toHaveBeenCalledWith(["beans"]));
  await waitFor(() => expect(mockStoreProducts).toHaveBeenCalledWith("beans"));
  await waitFor(() => expect(result.current.products.beans).toEqual([BEANS]));
});

test("does not overwrite persisted products before hydration read settles", async () => {
  const stored = deferred<null>();
  mockReadSmartProducts.mockReturnValue(stored.promise);

  await renderHook(() => useStoreProductsCache("2026-08-10"));

  await Promise.resolve();
  expect(mockWriteSmartProducts).not.toHaveBeenCalled();
  await act(async () => {
    stored.resolve(null);
    await stored.promise;
  });
});

test("bulk publishes batch hits then live-loads misses one at a time", async () => {
  const beans = deferred<StoreProductsResponse>();
  const milk = deferred<StoreProductsResponse>();
  const started: string[] = [];
  mockStoreProductsBatch.mockResolvedValue({
    entries: [
      { query: "Rice", status: "fresh", products: [RICE], expires_at: FUTURE_EXPIRES_AT },
      { query: "Beans", status: "missing", products: [], expires_at: null },
      { query: "Milk", status: "missing", products: [], expires_at: null },
    ],
  });
  mockStoreProducts.mockImplementation((query: string) => {
    started.push(query);
    return query === "Beans" ? beans.promise : milk.promise;
  });
  const { result } = await renderHook(() => useStoreProductsCache("2026-08-10"));

  await act(async () => {
    void result.current.loadAll(["Rice", "Beans", "Milk"]);
  });
  await waitFor(() => expect(result.current.products.rice).toEqual([RICE]));
  expect(started).toEqual(["Beans"]);
  await act(async () => {
    beans.resolve(response([BEANS]));
    await beans.promise;
  });
  await waitFor(() => expect(started).toEqual(["Beans", "Milk"]));
  await act(async () => {
    milk.resolve(response([MILK]));
    await milk.promise;
  });
  await waitFor(() => expect(result.current.bulkLoading).toEqual({ active: false, done: 3, total: 3 }));
});

test("bulk publishes interleaved fresh hits before its first live miss", async () => {
  const beans = deferred<StoreProductsResponse>();
  mockStoreProductsBatch.mockResolvedValue({
    entries: [
      { query: "Rice", status: "fresh", products: [RICE], expires_at: FUTURE_EXPIRES_AT },
      { query: "Beans", status: "missing", products: [], expires_at: null },
      { query: "Milk", status: "fresh", products: [MILK], expires_at: FUTURE_EXPIRES_AT },
    ],
  });
  mockStoreProducts.mockReturnValue(beans.promise);
  const { result } = await renderHook(() => useStoreProductsCache("2026-08-10"));

  await act(async () => {
    void result.current.loadAll(["Rice", "Beans", "Milk"]);
  });
  await waitFor(() => expect(mockStoreProducts).toHaveBeenCalledWith("Beans"));
  expect(result.current.products.rice).toEqual([RICE]);
  expect(result.current.products.milk).toEqual([MILK]);
  await act(async () => {
    beans.resolve(response([BEANS]));
    await beans.promise;
  });
});

test("a manual request waits behind active bulk work then runs before the next bulk miss", async () => {
  const beans = deferred<StoreProductsResponse>();
  const garlic = deferred<StoreProductsResponse>();
  const milk = deferred<StoreProductsResponse>();
  const started: string[] = [];
  mockStoreProductsBatch.mockResolvedValue({
    entries: [
      { query: "Beans", status: "missing", products: [], expires_at: null },
      { query: "Milk", status: "missing", products: [], expires_at: null },
    ],
  });
  mockStoreProducts.mockImplementation((query: string) => {
    started.push(query);
    return query === "Beans" ? beans.promise : query === "Garlic" ? garlic.promise : milk.promise;
  });
  const { result } = await renderHook(() => useStoreProductsCache("2026-08-10"));

  await act(async () => {
    void result.current.loadAll(["Beans", "Milk"]);
  });
  await waitFor(() => expect(started).toEqual(["Beans"]));
  await act(async () => {
    void result.current.togglePanel("Garlic");
  });
  await act(async () => {
    beans.resolve(response([BEANS]));
    await beans.promise;
  });
  await waitFor(() => expect(started).toEqual(["Beans", "Garlic"]));
  await act(async () => {
    garlic.resolve(response([{ ...RICE, name: "Garlic", url: "https://www.sayweee.com/product/garlic" }]));
    await garlic.promise;
  });
  await waitFor(() => expect(started).toEqual(["Beans", "Garlic", "Milk"]));
  await act(async () => {
    milk.resolve(response([MILK]));
    await milk.promise;
  });
});

test("seventy-five fresh batch hits complete without a live GET", async () => {
  const names = Array.from({ length: 75 }, (_, index) => `Ingredient ${index}`);
  mockStoreProductsBatch.mockResolvedValue({
    entries: names.map((query, index) => ({
      query,
      status: "fresh" as const,
      products: [{ ...RICE, name: `Product ${index}`, url: `https://www.sayweee.com/product/${index}` }],
      expires_at: FUTURE_EXPIRES_AT,
    })),
  });
  const { result } = await renderHook(() => useStoreProductsCache("2026-08-10"));

  await act(async () => {
    void result.current.loadAll(names);
  });
  await waitFor(() => expect(result.current.bulkLoading).toEqual({ active: false, done: 75, total: 75 }));
  expect(mockStoreProducts).not.toHaveBeenCalled();
});

test.each([
  ["rejects", undefined],
  ["duplicates an entry", {
    entries: [
      { query: "Rice", status: "missing", products: [], expires_at: null },
      { query: "Rice", status: "missing", products: [], expires_at: null },
    ],
  }],
  ["includes an unknown entry", {
    entries: [
      { query: "Rice", status: "missing", products: [], expires_at: null },
      { query: "Unknown", status: "missing", products: [], expires_at: null },
    ],
  }],
  ["omits a requested entry", {
    entries: [{ query: "Rice", status: "missing", products: [], expires_at: null }],
  }],
])("a batch that %s falls back to the complete serial queue", async (_caseName, batch) => {
  if (batch) mockStoreProductsBatch.mockResolvedValue(batch);
  else mockStoreProductsBatch.mockRejectedValue(new Error("cache unavailable"));
  mockStoreProducts.mockImplementation((query: string) =>
    Promise.resolve(response(query === "Rice" ? [RICE] : [BEANS])),
  );
  const { result } = await renderHook(() => useStoreProductsCache("2026-08-10"));

  await act(async () => {
    void result.current.loadAll(["Rice", "Beans"]);
  });
  await waitFor(() => expect(result.current.bulkLoading).toEqual({ active: false, done: 2, total: 2 }));
  expect(mockStoreProducts.mock.calls.map(([query]) => query)).toEqual(["Rice", "Beans"]);
});

test("rejects a nonempty response that contains no safe product", async () => {
  mockStoreProducts.mockResolvedValue({
    products: [{ ...RICE, url: "https://evil.test/product/rice" }],
    expires_at: FUTURE_EXPIRES_AT,
  });
  const { result } = await renderHook(() => useStoreProductsCache("2026-08-10"));

  await act(async () => {
    await result.current.togglePanel("Rice");
  });
  expect(result.current.products.rice).toBeUndefined();
  expect(result.current.errors.rice).toBeTruthy();
});

test("clears a live result at its exact authoritative expiry and revalidates it", async () => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date("2026-08-15T12:00:00.000Z"));
  const revalidation = deferred<StoreProductsResponse>();
  mockStoreProducts
    .mockResolvedValueOnce(response([RICE], "2026-08-15T12:00:01.000Z"))
    .mockReturnValueOnce(revalidation.promise);
  const { result } = await renderHook(() => useStoreProductsCache("2026-08-10"));

  await act(async () => {
    await result.current.togglePanel("Rice");
  });
  expect(result.current.products.rice).toEqual([RICE]);
  await act(async () => {
    jest.advanceTimersByTime(999);
    await Promise.resolve();
  });
  expect(result.current.products.rice).toEqual([RICE]);
  expect(mockStoreProducts).toHaveBeenCalledTimes(1);
  await act(async () => {
    jest.advanceTimersByTime(1);
    await Promise.resolve();
  });
  expect(result.current.products.rice).toBeUndefined();
  expect(mockStoreProducts).toHaveBeenCalledTimes(2);
});

test("cancels exact-expiry revalidation after unmount", async () => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date("2026-08-15T12:00:00.000Z"));
  mockStoreProducts.mockResolvedValue(response([RICE], "2026-08-15T12:00:01.000Z"));
  const { result, unmount } = await renderHook(() => useStoreProductsCache("2026-08-10"));

  await act(async () => {
    await result.current.togglePanel("Rice");
  });
  await act(async () => {
    unmount();
    await Promise.resolve();
  });
  await act(async () => {
    jest.advanceTimersByTime(1_000);
    await Promise.resolve();
  });
  expect(mockStoreProducts).toHaveBeenCalledTimes(1);
});

test("keeps hydrated data visible before exact expiry, then queues its revalidation", async () => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date("2026-08-15T12:00:00.000Z"));
  mockReadSmartProducts.mockResolvedValue({
    open: { rice: true },
    products: { rice: response([RICE], "2026-08-15T12:00:01.000Z") },
    errors: { rice: null },
  });
  const revalidation = deferred<StoreProductsResponse>();
  mockStoreProducts.mockReturnValue(revalidation.promise);
  const { result } = await renderHook(() => useStoreProductsCache("2026-08-10"));

  await waitFor(() => expect(result.current.products.rice).toEqual([RICE]));
  await act(async () => {
    jest.advanceTimersByTime(999);
    await Promise.resolve();
  });
  expect(result.current.products.rice).toEqual([RICE]);
  expect(mockStoreProducts).not.toHaveBeenCalled();
  await act(async () => {
    jest.advanceTimersByTime(1);
    await Promise.resolve();
  });
  expect(result.current.products.rice).toBeUndefined();
  expect(mockStoreProducts).toHaveBeenCalledWith("rice");
});

test("hydrates the persisted first spelling for exact-expiry reloads", async () => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date("2026-08-15T12:00:00.000Z"));
  mockReadSmartProducts.mockResolvedValue({
    open: { rice: true },
    products: { rice: response([RICE], "2026-08-15T12:00:01.000Z") },
    errors: { rice: null },
    queries: { rice: "RICE" },
  });
  mockStoreProducts.mockResolvedValue(response([]));
  const { result } = await renderHook(() => useStoreProductsCache("2026-08-10"));

  await waitFor(() => expect(result.current.products.rice).toEqual([RICE]));
  await act(async () => {
    jest.advanceTimersByTime(1_000);
    await Promise.resolve();
  });
  expect(mockStoreProducts).toHaveBeenCalledWith("RICE");
});

test("week changes suppress queued publications and reset bulk progress", async () => {
  const pending = deferred<StoreProductsResponse>();
  mockStoreProductsBatch.mockResolvedValue({
    entries: [{ query: "Rice", status: "missing", products: [], expires_at: null }],
  });
  mockStoreProducts.mockReturnValue(pending.promise);
  const { result, rerender } = await renderHook(
    ({ weekStart }: { weekStart: string | null }) => useStoreProductsCache(weekStart),
    { initialProps: { weekStart: "2026-08-10" } },
  );

  await act(async () => {
    void result.current.loadAll(["Rice"]);
  });
  await waitFor(() => expect(mockStoreProducts).toHaveBeenCalledWith("Rice"));
  await rerender({ weekStart: "2026-08-17" });
  await waitFor(() => expect(result.current.bulkLoading).toEqual({ active: false, done: 0, total: 0 }));
  await act(async () => {
    pending.resolve(response([RICE]));
    await pending.promise;
  });
  expect(result.current.products.rice).toBeUndefined();
});

test("week changes discard queued live misses before they start", async () => {
  const rice = deferred<StoreProductsResponse>();
  mockStoreProductsBatch.mockResolvedValue({
    entries: [
      { query: "Rice", status: "missing", products: [], expires_at: null },
      { query: "Beans", status: "missing", products: [], expires_at: null },
    ],
  });
  mockStoreProducts.mockReturnValue(rice.promise);
  const { result, rerender } = await renderHook(
    ({ weekStart }: { weekStart: string | null }) => useStoreProductsCache(weekStart),
    { initialProps: { weekStart: "2026-08-10" } },
  );

  await act(async () => {
    void result.current.loadAll(["Rice", "Beans"]);
  });
  await waitFor(() => expect(mockStoreProducts).toHaveBeenCalledWith("Rice"));
  await rerender({ weekStart: "2026-08-17" });
  await act(async () => {
    rice.resolve(response([RICE]));
    await rice.promise;
  });
  await waitFor(() => expect(mockReadSmartProducts).toHaveBeenCalledWith("2026-08-17"));
  expect(mockStoreProducts.mock.calls.map(([query]) => query)).toEqual(["Rice"]);
});

test("bulk progress settles every key when it joins an existing manual lookup", async () => {
  const rice = deferred<StoreProductsResponse>();
  const beans = deferred<StoreProductsResponse>();
  mockStoreProducts.mockImplementation((query: string) => query === "Rice" ? rice.promise : beans.promise);
  mockStoreProductsBatch.mockResolvedValue({
    entries: [{ query: "Beans", status: "missing", products: [], expires_at: null }],
  });
  const { result } = await renderHook(() => useStoreProductsCache("2026-08-10"));

  await act(async () => {
    void result.current.togglePanel(" Rice ");
  });
  await waitFor(() => expect(mockStoreProducts).toHaveBeenCalledWith("Rice"));
  await act(async () => {
    void result.current.loadAll(["rice", "Beans"]);
  });
  await act(async () => {
    rice.resolve(response([RICE]));
    await rice.promise;
  });
  await waitFor(() => expect(mockStoreProducts).toHaveBeenCalledWith("Beans"));
  await act(async () => {
    beans.resolve(response([BEANS]));
    await beans.promise;
  });
  await waitFor(() => expect(result.current.bulkLoading).toEqual({ active: false, done: 2, total: 2 }));
});

test("promoted preflight misses are queued before any bulk miss starts", async () => {
  const batch = deferred<unknown>();
  const rice = deferred<StoreProductsResponse>();
  const beans = deferred<StoreProductsResponse>();
  const started: string[] = [];
  mockStoreProductsBatch.mockReturnValue(batch.promise);
  mockStoreProducts.mockImplementation((query: string) => {
    started.push(query);
    return query === "Beans" ? beans.promise : rice.promise;
  });
  const { result } = await renderHook(() => useStoreProductsCache("2026-08-10"));

  await act(async () => {
    void result.current.loadAll(["Rice", "Beans"]);
  });
  await act(async () => {
    void result.current.togglePanel("Beans");
  });
  await act(async () => {
    batch.resolve({
      entries: [
        { query: "Rice", status: "missing", products: [], expires_at: null },
        { query: "Beans", status: "missing", products: [], expires_at: null },
      ],
    });
    await batch.promise;
  });
  await waitFor(() => expect(started).toEqual(["Beans"]));
  await act(async () => {
    beans.resolve(response([BEANS]));
    await beans.promise;
  });
  await waitFor(() => expect(started).toEqual(["Beans", "Rice"]));
  await act(async () => {
    rice.resolve(response([RICE]));
    await rice.promise;
  });
});

test("unmount settles active and queued bulk work without publishing or starting another GET", async () => {
  const rice = deferred<StoreProductsResponse>();
  mockStoreProductsBatch.mockResolvedValue({
    entries: [
      { query: "Rice", status: "missing", products: [], expires_at: null },
      { query: "Beans", status: "missing", products: [], expires_at: null },
    ],
  });
  mockStoreProducts.mockReturnValue(rice.promise);
  const { result, unmount } = await renderHook(() => useStoreProductsCache("2026-08-10"));
  let work!: Promise<void>;

  await act(async () => {
    work = result.current.loadAll(["Rice", "Beans"]);
  });
  await waitFor(() => expect(mockStoreProducts).toHaveBeenCalledWith("Rice"));
  await act(async () => {
    unmount();
    await Promise.resolve();
  });
  await act(async () => {
    rice.resolve(response([RICE]));
    await rice.promise;
  });
  await work;
  expect(mockStoreProducts.mock.calls.map(([query]) => query)).toEqual(["Rice"]);
});

test("an empty fresh batch entry invalidates the whole batch and falls back live", async () => {
  mockStoreProductsBatch.mockResolvedValue({
    entries: [{ query: "Rice", status: "fresh", products: [], expires_at: null }],
  });
  mockStoreProducts.mockResolvedValue(response([RICE]));
  const { result } = await renderHook(() => useStoreProductsCache("2026-08-10"));

  await act(async () => {
    void result.current.loadAll(["Rice"]);
  });
  await waitFor(() => expect(mockStoreProducts).toHaveBeenCalledWith("Rice"));
  await waitFor(() => expect(result.current.products.rice).toEqual([RICE]));
});

test("retries and expiry retain the first cleaned query spelling", async () => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date("2026-08-15T12:00:00.000Z"));
  mockStoreProducts
    .mockResolvedValueOnce({ products: [{ ...RICE, url: "https://evil.test/rice" }], expires_at: FUTURE_EXPIRES_AT })
    .mockResolvedValueOnce(response([RICE], "2026-08-15T12:00:01.000Z"))
    .mockResolvedValueOnce(response([]));
  const { result } = await renderHook(() => useStoreProductsCache("2026-08-10"));

  await act(async () => {
    await result.current.togglePanel(" Rice ");
  });
  await act(async () => {
    await result.current.retry("rice");
  });
  expect(mockStoreProducts.mock.calls.map(([query]) => query)).toEqual(["Rice", "Rice"]);
  await act(async () => {
    jest.advanceTimersByTime(1_000);
    await Promise.resolve();
  });
  expect(mockStoreProducts.mock.calls.map(([query]) => query)).toEqual(["Rice", "Rice", "Rice"]);
});

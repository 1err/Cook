import { act, renderHook, waitFor } from "@testing-library/react-native";
import type { StoreProduct, StoreProductsResponse } from "@cooking/api-client";
import { useStoreProductsCache } from "./useStoreProductsCache";

const mockStoreProducts = jest.fn();
const mockReadSmartProducts = jest.fn();
const mockWriteSmartProducts = jest.fn().mockResolvedValue(undefined);
const mockApiClient = { shopping: { storeProducts: mockStoreProducts } };

jest.mock("../../lib/api", () => ({
  useApiClient: () => mockApiClient,
}));

jest.mock("./storage", () => ({
  readSmartProducts: (...args: unknown[]) => mockReadSmartProducts(...args),
  writeSmartProducts: (...args: unknown[]) => mockWriteSmartProducts(...args),
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const FUTURE_EXPIRES_AT = new Date(Date.now() + 86_400_000).toISOString();

function response(
  products: StoreProduct[],
  expiresAt: string | null = products.length ? FUTURE_EXPIRES_AT : null,
): StoreProductsResponse {
  return { products, expires_at: expiresAt };
}

beforeEach(() => {
  jest.clearAllMocks();
});

afterEach(() => {
  jest.useRealTimers();
});

test("revalidates every hydrated positive without displaying or trusting the stored result", async () => {
  const storedRice: StoreProduct = {
    name: "Stored rice",
    price: "$0.01",
    image: "",
    url: "https://sayweee.com.evil.test/product/rice",
  };
  const storedTofu: StoreProduct = {
    name: "Stored tofu",
    price: "$0.02",
    image: "",
    url: "https://www.sayweee.com/product/tofu",
  };
  mockReadSmartProducts.mockResolvedValue({
    open: { Rice: true, Tofu: false },
    products: {
      Rice: response([storedRice]),
      Tofu: response([storedTofu]),
    },
    errors: { Rice: null, Tofu: null },
  });
  const responses = new Map<string, ReturnType<typeof deferred<StoreProductsResponse>>>();
  mockStoreProducts.mockImplementation((query: string) => {
    const pending = deferred<StoreProductsResponse>();
    responses.set(query, pending);
    return pending.promise;
  });

  const { result } = await renderHook(() => useStoreProductsCache("2026-08-10"));

  await waitFor(() => {
    expect(mockStoreProducts).toHaveBeenCalledTimes(2);
  });
  expect(mockStoreProducts).toHaveBeenCalledWith("Rice");
  expect(mockStoreProducts).toHaveBeenCalledWith("Tofu");
  expect(result.current.loading).toEqual({ Rice: true, Tofu: true });
  expect(result.current.products.Rice).toBeUndefined();
  expect(result.current.products.Tofu).toBeUndefined();

  const freshRice = {
    name: "Fresh rice",
    price: "$2.99",
    image: "",
    url: "https://www.sayweee.com/product/rice",
  };
  const freshTofu = {
    name: "Fresh tofu",
    price: "$3.99",
    image: "",
    url: "https://www.sayweee.com/product/tofu",
  };
  await act(async () => {
    responses.get("Rice")?.resolve(response([freshRice]));
    responses.get("Tofu")?.resolve(response([freshTofu]));
    await Promise.all([...responses.values()].map(({ promise }) => promise));
  });

  await waitFor(() => {
    expect(result.current.products).toEqual({ Rice: [freshRice], Tofu: [freshTofu] });
  });
  expect(result.current.loading).toEqual({ Rice: false, Tofu: false });
});

test("retries a hydrated open key that has no valid terminal positive", async () => {
  mockReadSmartProducts.mockResolvedValue({
    open: { Rice: true },
    products: {},
    errors: { Rice: null },
  });
  const pending = deferred<StoreProductsResponse>();
  mockStoreProducts.mockReturnValue(pending.promise);

  const { result } = await renderHook(() => useStoreProductsCache("2026-08-10"));

  await waitFor(() => expect(mockStoreProducts).toHaveBeenCalledWith("Rice"));
  expect(result.current.open.Rice).toBe(true);
  expect(result.current.loading.Rice).toBe(true);
  expect(result.current.products.Rice).toBeUndefined();
});

test("rejects a positive response without valid unexpired backend metadata", async () => {
  mockReadSmartProducts.mockResolvedValue(null);
  mockStoreProducts.mockResolvedValue({
    products: [
      {
        name: "Rice",
        price: "$2.99",
        image: "",
        url: "https://www.sayweee.com/product/rice",
      },
    ],
  });

  const { result } = await renderHook(() => useStoreProductsCache("2026-08-10"));
  await act(async () => {
    await result.current.togglePanel("Rice");
  });

  expect(result.current.products.Rice).toBeUndefined();
  expect(result.current.errors.Rice).toBeTruthy();
});

test("clears a displayed result and revalidates at the exact backend expiry", async () => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date("2026-08-15T12:00:00.000Z"));
  mockReadSmartProducts.mockResolvedValue(null);
  const revalidation = deferred<StoreProductsResponse>();
  mockStoreProducts
    .mockResolvedValueOnce(
      response(
        [
          {
            name: "Fresh rice",
            price: "$2.99",
            image: "",
            url: "https://www.sayweee.com/product/rice",
          },
        ],
        "2026-08-15T12:00:01.000Z",
      ),
    )
    .mockReturnValueOnce(revalidation.promise);

  const { result } = await renderHook(() => useStoreProductsCache("2026-08-10"));
  await act(async () => {
    await result.current.togglePanel("Rice");
  });
  expect(result.current.products.Rice?.[0]?.name).toBe("Fresh rice");

  await act(async () => {
    jest.advanceTimersByTime(999);
    await Promise.resolve();
  });
  expect(result.current.products.Rice?.[0]?.name).toBe("Fresh rice");
  expect(mockStoreProducts).toHaveBeenCalledTimes(1);

  await act(async () => {
    jest.advanceTimersByTime(1);
    await Promise.resolve();
  });
  expect(result.current.products.Rice).toBeUndefined();
  expect(result.current.loading.Rice).toBe(true);
  expect(mockStoreProducts).toHaveBeenCalledTimes(2);

  jest.useRealTimers();
});

test("cancels expiry revalidation after unmount", async () => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date("2026-08-15T12:00:00.000Z"));
  mockReadSmartProducts.mockResolvedValue(null);
  mockStoreProducts.mockResolvedValue(
    response(
      [
        {
          name: "Fresh rice",
          price: "$2.99",
          image: "",
          url: "https://www.sayweee.com/product/rice",
        },
      ],
      "2026-08-15T12:00:01.000Z",
    ),
  );

  const { result, unmount } = await renderHook(() =>
    useStoreProductsCache("2026-08-10"),
  );
  await act(async () => {
    await result.current.togglePanel("Rice");
  });
  expect(mockStoreProducts).toHaveBeenCalledTimes(1);

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

test("week switch resets bulk progress before unresolved workers finish", async () => {
  mockReadSmartProducts.mockResolvedValue(null);
  const pending = deferred<StoreProductsResponse>();
  mockStoreProducts.mockReturnValue(pending.promise);
  const { result, rerender } = await renderHook(
    ({ weekStart }: { weekStart: string | null }) =>
      useStoreProductsCache(weekStart),
    { initialProps: { weekStart: "2026-08-10" } },
  );

  await waitFor(() => expect(mockReadSmartProducts).toHaveBeenCalledWith("2026-08-10"));
  await act(() => {
    void result.current.loadAll(["Rice"]);
  });
  await waitFor(() => {
    expect(mockStoreProducts).toHaveBeenCalledWith("Rice");
    expect(result.current.bulkLoading).toEqual({ active: true, done: 0, total: 1 });
  });

  await rerender({ weekStart: "2026-08-17" });

  await waitFor(() =>
    expect(result.current.bulkLoading).toEqual({ active: false, done: 0, total: 0 }),
  );
  expect(result.current.products.Rice).toBeUndefined();

  await act(async () => {
    pending.resolve(response([]));
    await pending.promise;
  });
  expect(result.current.bulkLoading).toEqual({ active: false, done: 0, total: 0 });
  expect(result.current.products.Rice).toBeUndefined();
});

test("leaving smart mode resets unresolved bulk progress and re-entry is enabled", async () => {
  mockReadSmartProducts.mockResolvedValue(null);
  const pending = deferred<StoreProductsResponse>();
  mockStoreProducts.mockReturnValue(pending.promise);
  const { result, rerender } = await renderHook(
    ({ weekStart }: { weekStart: string | null }) =>
      useStoreProductsCache(weekStart),
    { initialProps: { weekStart: "2026-08-10" } },
  );

  await waitFor(() => expect(mockReadSmartProducts).toHaveBeenCalledWith("2026-08-10"));
  await act(() => {
    void result.current.loadAll(["Rice"]);
  });
  await waitFor(() =>
    expect(result.current.bulkLoading).toEqual({ active: true, done: 0, total: 1 }),
  );

  await rerender({ weekStart: null });
  await waitFor(() =>
    expect(result.current.bulkLoading).toEqual({ active: false, done: 0, total: 0 }),
  );

  await rerender({ weekStart: "2026-08-10" });
  await waitFor(() => expect(mockReadSmartProducts).toHaveBeenCalledTimes(2));
  expect(result.current.bulkLoading.active).toBe(false);

  await act(async () => {
    pending.resolve(response([]));
    await pending.promise;
  });
  expect(result.current.bulkLoading).toEqual({ active: false, done: 0, total: 0 });
});

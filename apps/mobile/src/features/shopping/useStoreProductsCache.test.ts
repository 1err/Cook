import { act, renderHook, waitFor } from "@testing-library/react-native";
import type { StoreProduct } from "@cooking/api-client";
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

beforeEach(() => {
  jest.clearAllMocks();
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
    products: { Rice: [storedRice], Tofu: [storedTofu] },
    errors: { Rice: null, Tofu: null },
  });
  const responses = new Map<string, ReturnType<typeof deferred<StoreProduct[]>>>();
  mockStoreProducts.mockImplementation((query: string) => {
    const response = deferred<StoreProduct[]>();
    responses.set(query, response);
    return response.promise;
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
    responses.get("Rice")?.resolve([freshRice]);
    responses.get("Tofu")?.resolve([freshTofu]);
    await Promise.all([...responses.values()].map(({ promise }) => promise));
  });

  await waitFor(() => {
    expect(result.current.products).toEqual({ Rice: [freshRice], Tofu: [freshTofu] });
  });
  expect(result.current.loading).toEqual({ Rice: false, Tofu: false });
});

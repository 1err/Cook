import { act, renderHook, waitFor } from "@testing-library/react-native";
import {
  cartConfirmationToken,
} from "@cooking/shared";
import {
  useCartAssistant,
  type MobileCartAssistantIngredient,
} from "./useCartAssistant";

const mockReadSmartCart = jest.fn();
const mockWriteSmartCart = jest.fn().mockResolvedValue(undefined);
const mockClearSmartCart = jest.fn().mockResolvedValue(undefined);

jest.mock("./storage", () => ({
  readSmartCart: (...args: unknown[]) => mockReadSmartCart(...args),
  writeSmartCart: (...args: unknown[]) => mockWriteSmartCart(...args),
  clearSmartCart: (...args: unknown[]) => mockClearSmartCart(...args),
}));

const RICE_FIRST = {
  name: "Jasmine rice",
  price: "$2.99",
  image: "",
  url: "https://www.sayweee.com/product/first-rice",
};
const RICE_ALT = {
  name: "Brown rice",
  price: "$4.99",
  image: "",
  url: "https://www.sayweee.com/product/brown-rice",
};
const RICE: MobileCartAssistantIngredient = {
  key: "rice",
  name: "Rice",
  suggestedPurchase: "1 bag",
  products: [RICE_FIRST, RICE_ALT],
  productsSettled: true,
  productsPending: false,
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockReadSmartCart.mockResolvedValue({
    selectedUrlByIngredient: {},
    confirmedTokens: [],
  });
  mockWriteSmartCart.mockResolvedValue(undefined);
  mockClearSmartCart.mockResolvedValue(undefined);
});

test("derives the first safe default without writing before or after empty hydration", async () => {
  const stored = deferred<{
    selectedUrlByIngredient: Record<string, string>;
    confirmedTokens: string[];
  }>();
  mockReadSmartCart.mockReturnValue(stored.promise);

  const { result } = await renderHook(() => useCartAssistant("2026-08-10", [RICE]));

  expect(result.current.draft.selections[0]?.product.url).toBe(RICE_FIRST.url);
  expect(result.current.selectedUrlByIngredient).toEqual({});
  expect(mockWriteSmartCart).not.toHaveBeenCalled();

  await act(async () => {
    stored.resolve({ selectedUrlByIngredient: {}, confirmedTokens: [] });
    await stored.promise;
  });

  expect(result.current.draft.selections[0]?.product.url).toBe(RICE_FIRST.url);
  expect(mockWriteSmartCart).not.toHaveBeenCalled();
});

test("a selected default press before hydration tombstones conflicting stored progress before remount", async () => {
  const stored = deferred<{
    selectedUrlByIngredient: Record<string, string>;
    confirmedTokens: string[];
  }>();
  let storedValue = {
    selectedUrlByIngredient: { rice: RICE_ALT.url },
    confirmedTokens: [cartConfirmationToken("rice", RICE_ALT.url)],
  };
  mockReadSmartCart
    .mockReturnValueOnce(stored.promise)
    .mockImplementation(() => Promise.resolve(storedValue));
  mockWriteSmartCart.mockImplementation(async (_weekStart, value) => {
    storedValue = value;
  });
  const first = await renderHook(() => useCartAssistant("2026-08-10", [RICE]));

  expect(first.result.current.draft.selections[0]?.product.url).toBe(RICE_FIRST.url);
  await act(() => {
    first.result.current.select("rice", RICE_FIRST.url);
  });
  expect(first.result.current.selectedUrlByIngredient).toEqual({});
  expect(mockWriteSmartCart).not.toHaveBeenCalled();

  await act(async () => {
    stored.resolve(storedValue);
    await stored.promise;
  });

  expect(first.result.current.draft.selections[0]?.product.url).toBe(RICE_FIRST.url);
  expect(first.result.current.selectedUrlByIngredient).toEqual({});
  expect(first.result.current.confirmedTokens.size).toBe(0);
  await waitFor(() => expect(mockWriteSmartCart).toHaveBeenLastCalledWith("2026-08-10", {
    selectedUrlByIngredient: {},
    confirmedTokens: [],
  }));

  await first.unmount();
  const second = await renderHook(() => useCartAssistant("2026-08-10", [RICE]));
  await waitFor(() => expect(mockReadSmartCart).toHaveBeenCalledTimes(2));
  expect(second.result.current.draft.selections[0]?.product.url).toBe(RICE_FIRST.url);
  expect(second.result.current.selectedUrlByIngredient).toEqual({});
  expect(second.result.current.confirmedTokens.size).toBe(0);
});

test("a read failure after a pre-hydration default press still persists a remount-safe tombstone", async () => {
  const firstRead = deferred<{
    selectedUrlByIngredient: Record<string, string>;
    confirmedTokens: string[];
  }>();
  let storedValue = {
    selectedUrlByIngredient: { rice: RICE_ALT.url },
    confirmedTokens: [cartConfirmationToken("rice", RICE_ALT.url)],
  };
  mockReadSmartCart
    .mockReturnValueOnce(firstRead.promise)
    .mockImplementation(() => Promise.resolve(storedValue));
  mockWriteSmartCart.mockImplementation(async (_weekStart, value) => {
    storedValue = value;
  });
  const first = await renderHook(() => useCartAssistant("2026-08-10", [RICE]));

  await act(() => {
    first.result.current.select("rice", RICE_FIRST.url);
  });
  await act(async () => {
    firstRead.reject(new Error("storage read denied"));
    await expect(firstRead.promise).rejects.toThrow("storage read denied");
  });
  await waitFor(() => expect(mockWriteSmartCart).toHaveBeenLastCalledWith("2026-08-10", {
    selectedUrlByIngredient: {},
    confirmedTokens: [],
  }));

  await first.unmount();
  const second = await renderHook(() => useCartAssistant("2026-08-10", [RICE]));
  await waitFor(() => expect(mockReadSmartCart).toHaveBeenCalledTimes(2));
  expect(second.result.current.draft.selections[0]?.product.url).toBe(RICE_FIRST.url);
  expect(second.result.current.confirmedTokens.size).toBe(0);
});

test("hydrates an explicit alternative and its product-bound confirmation without overwriting it", async () => {
  const token = cartConfirmationToken(RICE.key, RICE_ALT.url);
  mockReadSmartCart.mockResolvedValue({
    selectedUrlByIngredient: { rice: RICE_ALT.url },
    confirmedTokens: [token],
  });

  const { result } = await renderHook(() => useCartAssistant("2026-08-10", [RICE]));

  await waitFor(() => expect(result.current.draft.selections[0]?.product.url).toBe(RICE_ALT.url));
  expect(result.current.draft.selections[0]?.confirmed).toBe(true);
  expect(result.current.confirmedTokens).toEqual(new Set([token]));
  expect(mockWriteSmartCart).not.toHaveBeenCalled();
});

test("selects an eligible alternative, treats the effective default as a no-op, and clears old confirmation", async () => {
  const firstToken = cartConfirmationToken(RICE.key, RICE_FIRST.url);
  const altToken = cartConfirmationToken(RICE.key, RICE_ALT.url);
  const { result } = await renderHook(() => useCartAssistant("2026-08-10", [RICE]));
  await waitFor(() => expect(mockReadSmartCart).toHaveBeenCalledWith("2026-08-10"));

  await act(() => {
    result.current.select("rice", RICE_FIRST.url);
  });
  expect(result.current.selectedUrlByIngredient).toEqual({});
  expect(mockWriteSmartCart).not.toHaveBeenCalled();

  await act(() => {
    result.current.confirm("not-the-current-selection");
  });
  expect(result.current.confirmedTokens.size).toBe(0);

  await act(() => {
    result.current.confirm(firstToken);
  });
  expect(result.current.draft.selections[0]?.confirmed).toBe(true);

  await act(() => {
    result.current.select("rice", RICE_ALT.url);
  });
  expect(result.current.draft.selections[0]?.product.url).toBe(RICE_ALT.url);
  expect(result.current.confirmedTokens.has(firstToken)).toBe(false);

  await act(() => {
    result.current.confirm(altToken);
  });
  expect(result.current.confirmedTokens.has(altToken)).toBe(true);

  await act(() => {
    result.current.undoConfirm(altToken);
  });
  expect(result.current.confirmedTokens.size).toBe(0);

  await waitFor(() => {
    expect(mockWriteSmartCart).toHaveBeenLastCalledWith("2026-08-10", {
      selectedUrlByIngredient: { rice: RICE_ALT.url },
      confirmedTokens: [],
    });
  });
});

test("prunes a stored selection and confirmation when the URL is no longer eligible", async () => {
  const staleUrl = "https://www.sayweee.com/product/discontinued-rice";
  mockReadSmartCart.mockResolvedValue({
    selectedUrlByIngredient: { rice: staleUrl },
    confirmedTokens: [cartConfirmationToken("rice", staleUrl), "malformed-token"],
  });

  const { result } = await renderHook(() => useCartAssistant("2026-08-10", [RICE]));

  await waitFor(() => {
    expect(result.current.selectedUrlByIngredient).toEqual({});
    expect(result.current.confirmedTokens.size).toBe(0);
  });
  expect(result.current.draft.selections[0]?.product.url).toBe(RICE_FIRST.url);
  await waitFor(() => {
    expect(mockWriteSmartCart).toHaveBeenLastCalledWith("2026-08-10", {
      selectedUrlByIngredient: {},
      confirmedTokens: [],
    });
  });
});

test("keeps live changes when a best-effort storage write fails", async () => {
  mockWriteSmartCart.mockRejectedValue(new Error("storage denied"));
  const { result } = await renderHook(() => useCartAssistant("2026-08-10", [RICE]));
  await waitFor(() => expect(mockReadSmartCart).toHaveBeenCalled());

  await act(() => {
    result.current.select("rice", RICE_ALT.url);
  });

  expect(result.current.draft.selections[0]?.product.url).toBe(RICE_ALT.url);
  await waitFor(() => expect(mockWriteSmartCart).toHaveBeenCalled());
  expect(result.current.draft.selections[0]?.product.url).toBe(RICE_ALT.url);
});

test("waits for eligibility and product hydration before pruning a still-valid stored choice", async () => {
  const token = cartConfirmationToken("rice", RICE_ALT.url);
  mockReadSmartCart.mockResolvedValue({
    selectedUrlByIngredient: { rice: RICE_ALT.url },
    confirmedTokens: [token],
  });
  const { result, rerender } = await renderHook(
    ({ ingredients }: { ingredients: MobileCartAssistantIngredient[] | null }) => (
      useCartAssistant("2026-08-10", ingredients)
    ),
    { initialProps: { ingredients: null as MobileCartAssistantIngredient[] | null } },
  );

  await waitFor(() => expect(result.current.selectedUrlByIngredient).toEqual({ rice: RICE_ALT.url }));
  expect(result.current.confirmedTokens).toEqual(new Set([token]));
  expect(mockWriteSmartCart).not.toHaveBeenCalled();

  await rerender({
    ingredients: [{ ...RICE, products: [], productsSettled: false, productsPending: true }],
  });
  expect(result.current.selectedUrlByIngredient).toEqual({ rice: RICE_ALT.url });
  expect(result.current.confirmedTokens).toEqual(new Set([token]));
  expect(mockWriteSmartCart).not.toHaveBeenCalled();

  await rerender({ ingredients: [RICE] });
  expect(result.current.draft.selections[0]?.product.url).toBe(RICE_ALT.url);
  expect(result.current.draft.selections[0]?.confirmed).toBe(true);
  expect(mockWriteSmartCart).not.toHaveBeenCalled();
});

test.each([
  ["settled empty", []],
  [
    "settled unsafe-only",
    [{ name: "Unsafe rice", price: "$1", image: "", url: "https://example.com/rice" }],
  ],
] as const)("prunes stored selection and confirmation for %s product results", async (_label, products) => {
  const token = cartConfirmationToken("rice", RICE_ALT.url);
  mockReadSmartCart.mockResolvedValue({
    selectedUrlByIngredient: { rice: RICE_ALT.url },
    confirmedTokens: [token],
  });
  const ingredient: MobileCartAssistantIngredient = {
    ...RICE,
    products: [...products],
    productsSettled: true,
  };

  const { result } = await renderHook(() => useCartAssistant("2026-08-10", [ingredient]));

  await waitFor(() => {
    expect(result.current.selectedUrlByIngredient).toEqual({});
    expect(result.current.confirmedTokens.size).toBe(0);
  });
  await waitFor(() => expect(mockWriteSmartCart).toHaveBeenLastCalledWith("2026-08-10", {
    selectedUrlByIngredient: {},
    confirmedTokens: [],
  }));
});

test("keeps a no-product pending ingredient out of unmatched until its lookup settles", async () => {
  const pendingRice: MobileCartAssistantIngredient = {
    ...RICE,
    products: [],
    productsSettled: false,
    productsPending: true,
  };
  const { result, rerender } = await renderHook(
    ({ ingredient }: { ingredient: MobileCartAssistantIngredient }) => (
      useCartAssistant("2026-08-10", [ingredient])
    ),
    { initialProps: { ingredient: pendingRice } },
  );

  expect(result.current.draft.selections).toEqual([]);
  expect(result.current.draft.unmatched).toEqual([]);
  expect(result.current.draft.pending).toEqual([{
    key: "rice",
    name: "Rice",
    suggestedPurchase: "1 bag",
  }]);
  expect(result.current.draft.summary.pendingCount).toBe(1);

  await rerender({
    ingredient: { ...pendingRice, productsSettled: true, productsPending: false },
  });

  expect(result.current.draft.pending).toEqual([]);
  expect(result.current.draft.summary.pendingCount).toBe(0);
  expect(result.current.draft.unmatched).toEqual([{
    key: "rice",
    name: "Rice",
    suggestedPurchase: "1 bag",
  }]);
});

test("keeps a pending ingredient with a still-safe product ready for review", async () => {
  const pendingWithProduct: MobileCartAssistantIngredient = {
    ...RICE,
    products: [RICE_FIRST],
    productsSettled: false,
    productsPending: true,
  };
  const { result } = await renderHook(() => (
    useCartAssistant("2026-08-10", [pendingWithProduct])
  ));

  expect(result.current.draft.pending).toEqual([]);
  expect(result.current.draft.unmatched).toEqual([]);
  expect(result.current.draft.selections[0]?.product).toEqual(RICE_FIRST);
  expect(result.current.draft.summary).toMatchObject({ readyCount: 1, pendingCount: 0 });
});

test("renders idle or expired unknown authority as unmatched while preserving stored progress", async () => {
  const token = cartConfirmationToken("rice", RICE_ALT.url);
  mockReadSmartCart.mockResolvedValue({
    selectedUrlByIngredient: { rice: RICE_ALT.url },
    confirmedTokens: [token],
  });
  const unknownRice: MobileCartAssistantIngredient = {
    ...RICE,
    products: [],
    productsSettled: false,
    productsPending: false,
  };

  const { result } = await renderHook(() => useCartAssistant("2026-08-10", [unknownRice]));

  await waitFor(() => expect(result.current.selectedUrlByIngredient).toEqual({ rice: RICE_ALT.url }));
  expect(result.current.confirmedTokens).toEqual(new Set([token]));
  expect(result.current.draft.pending).toEqual([]);
  expect(result.current.draft.unmatched).toEqual([{
    key: "rice",
    name: "Rice",
    suggestedPurchase: "1 bag",
  }]);
  expect(mockWriteSmartCart).not.toHaveBeenCalled();
});

test("revalidation prunes a formerly valid alternative and its confirmation", async () => {
  const token = cartConfirmationToken("rice", RICE_ALT.url);
  mockReadSmartCart.mockResolvedValue({
    selectedUrlByIngredient: { rice: RICE_ALT.url },
    confirmedTokens: [token],
  });
  const { result, rerender } = await renderHook(
    ({ ingredients }: { ingredients: MobileCartAssistantIngredient[] | null }) => (
      useCartAssistant("2026-08-10", ingredients)
    ),
    { initialProps: { ingredients: [RICE] as MobileCartAssistantIngredient[] | null } },
  );
  await waitFor(() => expect(result.current.draft.selections[0]?.confirmed).toBe(true));

  await rerender({
    ingredients: [{ ...RICE, products: [RICE_FIRST], productsSettled: true }],
  });

  await waitFor(() => {
    expect(result.current.selectedUrlByIngredient).toEqual({});
    expect(result.current.confirmedTokens.size).toBe(0);
  });
  expect(result.current.draft.selections[0]?.product.url).toBe(RICE_FIRST.url);
  expect(result.current.draft.selections[0]?.confirmed).toBe(false);
});

test("an authoritative remove and re-add retains the URL choice but not confirmation", async () => {
  const token = cartConfirmationToken("rice", RICE_ALT.url);
  mockReadSmartCart.mockResolvedValue({
    selectedUrlByIngredient: { rice: RICE_ALT.url },
    confirmedTokens: [token],
  });
  const { result, rerender } = await renderHook(
    ({ ingredients }: { ingredients: MobileCartAssistantIngredient[] | null }) => (
      useCartAssistant("2026-08-10", ingredients)
    ),
    { initialProps: { ingredients: [RICE] as MobileCartAssistantIngredient[] | null } },
  );
  await waitFor(() => expect(result.current.draft.selections[0]?.confirmed).toBe(true));

  await rerender({ ingredients: [] });
  await waitFor(() => {
    expect(result.current.selectedUrlByIngredient).toEqual({ rice: RICE_ALT.url });
    expect(result.current.confirmedTokens.size).toBe(0);
  });
  await waitFor(() => expect(mockWriteSmartCart).toHaveBeenLastCalledWith("2026-08-10", {
    selectedUrlByIngredient: { rice: RICE_ALT.url },
    confirmedTokens: [],
  }));

  await rerender({ ingredients: [RICE] });
  expect(result.current.draft.selections[0]?.product.url).toBe(RICE_ALT.url);
  expect(result.current.draft.selections[0]?.confirmed).toBe(false);
});

test("keeps default live state usable when reading and clearing storage fail", async () => {
  mockReadSmartCart.mockRejectedValue(new Error("read denied"));
  mockClearSmartCart.mockRejectedValue(new Error("clear denied"));
  const { result } = await renderHook(() => useCartAssistant("2026-08-10", [RICE]));

  await waitFor(() => expect(mockReadSmartCart).toHaveBeenCalledWith("2026-08-10"));
  expect(result.current.draft.selections[0]?.product.url).toBe(RICE_FIRST.url);
  await act(() => {
    result.current.select("rice", RICE_ALT.url);
  });
  expect(result.current.draft.selections[0]?.product.url).toBe(RICE_ALT.url);

  await act(() => {
    result.current.reset();
  });
  expect(result.current.draft.selections[0]?.product.url).toBe(RICE_FIRST.url);
  await waitFor(() => expect(mockClearSmartCart).toHaveBeenCalledWith("2026-08-10"));
});

test("ignores a stale week read and reset clears only the currently active week", async () => {
  const firstWeek = deferred<{
    selectedUrlByIngredient: Record<string, string>;
    confirmedTokens: string[];
  }>();
  mockReadSmartCart
    .mockReturnValueOnce(firstWeek.promise)
    .mockResolvedValueOnce({
      selectedUrlByIngredient: { rice: RICE_ALT.url },
      confirmedTokens: [],
    });

  const { result, rerender } = await renderHook(
    ({ weekStart }: { weekStart: string }) => useCartAssistant(weekStart, [RICE]),
    { initialProps: { weekStart: "2026-08-10" } },
  );

  await rerender({ weekStart: "2026-08-17" });
  await waitFor(() => expect(result.current.draft.selections[0]?.product.url).toBe(RICE_ALT.url));

  await act(async () => {
    firstWeek.resolve({
      selectedUrlByIngredient: { rice: RICE_FIRST.url },
      confirmedTokens: [cartConfirmationToken("rice", RICE_FIRST.url)],
    });
    await firstWeek.promise;
  });

  expect(result.current.draft.selections[0]?.product.url).toBe(RICE_ALT.url);
  expect(result.current.confirmedTokens.size).toBe(0);

  await act(() => {
    result.current.reset();
  });
  expect(result.current.selectedUrlByIngredient).toEqual({});
  expect(result.current.confirmedTokens.size).toBe(0);
  await waitFor(() => expect(mockClearSmartCart).toHaveBeenCalledWith("2026-08-17"));
  expect(mockClearSmartCart).not.toHaveBeenCalledWith("2026-08-10");
});

import { act, renderHook, waitFor } from "@testing-library/react-native";
import { useSmartShoppingList } from "./useSmartShoppingList";

const mockShoppingList = jest.fn();
const mockMealPlanList = jest.fn();
const mockRecipeList = jest.fn();
const mockRefine = jest.fn();
const mockReadSmartList = jest.fn();
const mockWriteSmartList = jest.fn().mockResolvedValue(undefined);
const mockClearSmartList = jest.fn().mockResolvedValue(undefined);
const mockClearSmartProducts = jest.fn().mockResolvedValue(undefined);

const mockApiClient = {
  shopping: {
    list: mockShoppingList,
    refine: mockRefine,
  },
  mealPlan: { list: mockMealPlanList },
  recipes: { get: async (id: string) => (await mockRecipeList()).find((r: {id: string}) => r.id === id) },
};

jest.mock("../../lib/api", () => ({ useApiClient: () => mockApiClient }));
jest.mock("../../lib/storage", () => ({
  json: { get: jest.fn().mockResolvedValue(null) },
  persistent: {},
}));
jest.mock("@react-navigation/native", () => ({ useFocusEffect: jest.fn() }));
jest.mock("./storage", () => ({
  readSmartList: (...args: unknown[]) => mockReadSmartList(...args),
  writeSmartList: (...args: unknown[]) => mockWriteSmartList(...args),
  clearSmartList: (...args: unknown[]) => mockClearSmartList(...args),
  clearSmartProducts: (...args: unknown[]) => mockClearSmartProducts(...args),
}));

const ITEMS = [{
  id: "item-1",
  name: "Rice",
  total_quantity: "1 bag",
  checked: false,
  earliest_date: "2026-08-10",
  latest_date: "2026-08-16",
}];
const REFINED = {
  remove: [],
  likely_pantry: [],
  purchase_items: [{ name: "Rice", suggested_purchase: "1 bag", category: "Pantry" }],
};
const SECOND_REFINED = {
  remove: [],
  likely_pantry: [],
  purchase_items: [{ name: "Beans", suggested_purchase: "2 cans", category: "Pantry" }],
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
  mockShoppingList.mockResolvedValue(ITEMS);
  mockMealPlanList.mockResolvedValue([]);
  mockRecipeList.mockResolvedValue([]);
  mockRefine.mockResolvedValue(REFINED);
  mockReadSmartList.mockResolvedValue(null);
  mockWriteSmartList.mockResolvedValue(undefined);
  mockClearSmartList.mockResolvedValue(undefined);
  mockClearSmartProducts.mockResolvedValue(undefined);
});

async function renderReady(weekStart = "2026-08-10") {
  const rendered = await renderHook(
    ({ week }: { week: string }) => useSmartShoppingList(week),
    { initialProps: { week: weekStart } },
  );
  await waitFor(() => expect(rendered.result.current.state.status).toBe("ready"));
  return rendered;
}

test("returns an explicit week-tagged success even when refinement resolves immediately", async () => {
  const { result } = await renderReady();
  let mutationResult: unknown;

  await act(async () => {
    mutationResult = await result.current.prepareSmartList();
  });

  expect(mutationResult).toEqual({ status: "succeeded", weekStart: "2026-08-10" });
  expect(result.current.state).toMatchObject({
    status: "ready",
    bounds: { start: "2026-08-10" },
    refining: false,
    refineError: null,
    data: { refinedData: REFINED },
  });
});

test("returns failed and preserves the previous refined data when refinement fails", async () => {
  mockReadSmartList.mockResolvedValue({
    data: SECOND_REFINED,
    hidden: new Set([0]),
    checked: new Set(),
    plannerFingerprint: "old",
  });
  mockRefine.mockRejectedValue(new Error("Refine failed"));
  const { result } = await renderReady();
  let mutationResult: unknown;

  await act(async () => {
    mutationResult = await result.current.prepareSmartList();
  });

  expect(mutationResult).toEqual({
    status: "failed",
    weekStart: "2026-08-10",
    error: "Refine failed",
  });
  expect(result.current.state).toMatchObject({
    status: "ready",
    refining: false,
    refineError: "Refine failed",
    data: { refinedData: SECOND_REFINED },
  });
});

test("starting a refinement does not race-persist the previous cached list", async () => {
  mockReadSmartList.mockResolvedValue({
    data: SECOND_REFINED,
    hidden: new Set([0]),
    checked: new Set(),
    plannerFingerprint: "old",
  });
  const pending = deferred<typeof REFINED>();
  mockRefine.mockReturnValue(pending.promise);
  const { result } = await renderReady();
  await waitFor(() => expect(mockWriteSmartList).toHaveBeenCalled());
  mockWriteSmartList.mockClear();
  let work!: ReturnType<typeof result.current.prepareSmartList>;

  await act(async () => {
    work = result.current.prepareSmartList();
    await Promise.resolve();
  });
  await waitFor(() => expect(mockRefine).toHaveBeenCalledTimes(1));

  expect(mockWriteSmartList).not.toHaveBeenCalled();
  await act(async () => {
    pending.resolve(REFINED);
    await pending.promise;
  });
  await expect(work).resolves.toEqual({ status: "succeeded", weekStart: "2026-08-10" });
  expect(mockWriteSmartList).toHaveBeenCalledWith(
    "2026-08-10",
    REFINED,
    expect.any(Set),
    expect.any(Set),
    expect.any(String),
  );
});

test("a week switch makes an in-flight refine stale and blocks its late dispatch and writes", async () => {
  const pending = deferred<typeof REFINED>();
  mockRefine.mockReturnValue(pending.promise);
  const { result, rerender } = await renderReady();
  let work!: ReturnType<typeof result.current.prepareSmartList>;

  await act(async () => {
    work = result.current.prepareSmartList();
    await Promise.resolve();
  });
  await waitFor(() => expect(mockRefine).toHaveBeenCalledTimes(1));
  await rerender({ week: "2026-08-17" });
  await waitFor(() => expect(result.current.state).toMatchObject({
    status: "ready",
    bounds: { start: "2026-08-17" },
  }));

  await act(async () => {
    pending.resolve(REFINED);
    await pending.promise;
  });

  await expect(work).resolves.toEqual({ status: "stale", weekStart: "2026-08-10" });
  expect(result.current.state).toMatchObject({
    status: "ready",
    bounds: { start: "2026-08-17" },
    data: { refinedData: null },
  });
  expect(mockWriteSmartList).not.toHaveBeenCalledWith(
    "2026-08-10",
    expect.anything(),
    expect.anything(),
    expect.anything(),
    expect.anything(),
  );
});

test("a week switch during back-to-original blocks its remaining clears and destination dispatch", async () => {
  mockReadSmartList.mockImplementation(async (week: string) => week === "2026-08-10" ? {
    data: REFINED,
    hidden: new Set(),
    checked: new Set(),
    plannerFingerprint: "old",
  } : {
    data: SECOND_REFINED,
    hidden: new Set(),
    checked: new Set(),
    plannerFingerprint: "new",
  });
  const pendingClear = deferred<void>();
  mockClearSmartList.mockReturnValueOnce(pendingClear.promise);
  const { result, rerender } = await renderReady();
  let work!: ReturnType<typeof result.current.backToOriginal>;

  await act(async () => {
    work = result.current.backToOriginal();
    await Promise.resolve();
  });
  expect(mockClearSmartList).toHaveBeenCalledWith("2026-08-10");
  await rerender({ week: "2026-08-17" });
  await waitFor(() => expect(result.current.state).toMatchObject({
    status: "ready",
    bounds: { start: "2026-08-17" },
    data: { refinedData: SECOND_REFINED },
  }));

  await act(async () => {
    pendingClear.resolve();
    await pendingClear.promise;
  });

  await expect(work).resolves.toEqual({ status: "stale", weekStart: "2026-08-10" });
  expect(mockClearSmartProducts).not.toHaveBeenCalledWith("2026-08-10");
  expect(result.current.state).toMatchObject({
    status: "ready",
    bounds: { start: "2026-08-17" },
    data: { refinedData: SECOND_REFINED },
  });
});

test("a newer overlapping prepare wins and the older completion is stale", async () => {
  const first = deferred<typeof REFINED>();
  mockRefine.mockReturnValueOnce(first.promise).mockResolvedValueOnce(SECOND_REFINED);
  const { result } = await renderReady();
  let firstWork!: ReturnType<typeof result.current.prepareSmartList>;
  let secondResult: unknown;

  await act(async () => {
    firstWork = result.current.prepareSmartList();
    await Promise.resolve();
  });
  await waitFor(() => expect(mockRefine).toHaveBeenCalledTimes(1));
  await act(async () => {
    secondResult = await result.current.prepareSmartList();
  });
  expect(secondResult).toEqual({ status: "succeeded", weekStart: "2026-08-10" });
  expect(result.current.state).toMatchObject({ data: { refinedData: SECOND_REFINED } });

  await act(async () => {
    first.resolve(REFINED);
    await first.promise;
  });
  await expect(firstWork).resolves.toEqual({ status: "stale", weekStart: "2026-08-10" });
  expect(result.current.state).toMatchObject({ data: { refinedData: SECOND_REFINED } });
});

test('recovers an unavailable preview after successful refinement and returns to current raw ingredients', async () => {
  mockMealPlanList.mockRejectedValueOnce(new Error('Preview offline'));
  const { result } = await renderReady();
  expect(result.current.state).toMatchObject({ data: { previewUnavailable: true } });
  const latestItems = [{ name: 'Milk', total_quantity: '2 cartons' }];
  mockShoppingList.mockResolvedValue(latestItems);
  await act(async () => { await result.current.prepareSmartList(); });
  expect(result.current.state).toMatchObject({ data: { previewUnavailable: false, items: latestItems } });
  await act(async () => { await result.current.backToOriginal(); });
  expect(result.current.state).toMatchObject({ data: { refinedData: null, items: latestItems } });
});

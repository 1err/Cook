import { act, renderHook, waitFor } from "@testing-library/react-native";
import { usePlannerWeek } from "./usePlannerWeek";

jest.mock("@react-native-async-storage/async-storage", () => require("@react-native-async-storage/async-storage/jest/async-storage-mock"));
jest.mock("../../lib/haptics", () => ({ haptics: { success: jest.fn(), error: jest.fn() } }));
const mockUpdate = jest.fn();
const mockApi = { mealPlan: { list: jest.fn(async () => []), updateDay: mockUpdate }, recipes: { list: jest.fn(async () => []) } };
jest.mock("../../lib/api", () => ({ useApiClient: () => mockApi }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

beforeEach(() => {
  mockUpdate.mockReset();
});

test("rapid same-day edits stay visible and save in order despite a delayed first response", async () => {
  const first = deferred<unknown>();
  mockUpdate.mockReturnValueOnce(first.promise).mockImplementation(async (date, slots) => ({ date, ...slots }));
  const { result } = await renderHook(() => usePlannerWeek("2026-09-14"));
  await waitFor(() => expect(result.current.state.status).toBe("ready"));
  let addBreakfast!: Promise<void>;
  let addDinner!: Promise<void>;
  await act(async () => {
    addBreakfast = result.current.addRecipeToSlot("2026-09-14", "breakfast", "eggs");
    addDinner = result.current.addRecipeToSlot("2026-09-14", "dinner", "noodles");
  });
  expect(mockUpdate).toHaveBeenCalledTimes(1);
  if (result.current.state.status !== "ready") throw new Error("Planner unavailable");
  expect(result.current.state.data.planByDate["2026-09-14"]).toMatchObject({ breakfast: ["eggs"], dinner: ["noodles"] });
  await act(async () => {
    first.resolve({ date: "2026-09-14", breakfast: ["eggs"], lunch: [], dinner: [] });
    await Promise.all([addBreakfast, addDinner]);
  });
  expect(mockUpdate).toHaveBeenLastCalledWith("2026-09-14", { breakfast: ["eggs"], lunch: [], dinner: ["noodles"] });
  expect(result.current.state.data.planByDate["2026-09-14"]).toMatchObject({ breakfast: ["eggs"], dinner: ["noodles"] });
});

test("a failed earlier edit does not roll back the next queued edit", async () => {
  const first = deferred<unknown>();
  mockUpdate.mockReturnValueOnce(first.promise).mockImplementation(async (date, slots) => ({ date, ...slots }));
  const { result } = await renderHook(() => usePlannerWeek("2026-09-14"));
  await waitFor(() => expect(result.current.state.status).toBe("ready"));
  let firstResult!: Promise<unknown>;
  let secondResult!: Promise<void>;
  await act(async () => {
    firstResult = result.current.addRecipeToSlot("2026-09-14", "dinner", "soup").catch((error) => error);
    secondResult = result.current.addRecipeToSlot("2026-09-14", "dinner", "rice");
  });
  await act(async () => {
    first.reject(new Error("Save failed"));
    await Promise.all([firstResult, secondResult]);
  });
  if (result.current.state.status !== "ready") throw new Error("Planner unavailable");
  expect(result.current.state.data.planByDate["2026-09-14"].dinner).toEqual(["rice"]);
  expect(mockUpdate).toHaveBeenLastCalledWith("2026-09-14", { breakfast: [], lunch: [], dinner: ["rice"] });
});

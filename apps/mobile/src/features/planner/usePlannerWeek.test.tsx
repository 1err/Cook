import { ApiError } from "@cooking/api-client";
import { act, renderHook, waitFor } from "@testing-library/react-native";
import { usePlannerWeek } from "./usePlannerWeek";

jest.mock("@react-native-async-storage/async-storage", () => require("@react-native-async-storage/async-storage/jest/async-storage-mock"));
jest.mock("../../lib/haptics", () => ({ haptics: { success: jest.fn(), error: jest.fn() } }));
const mockUpdate = jest.fn();
const mockApi = { mealPlan: { list: jest.fn(async () => []), updateDay: mockUpdate }, recipes: { get: jest.fn(async (id: string) => ({id, title:id, ingredients:[]})) } };
jest.mock("../../lib/api", () => ({ useApiClient: () => mockApi }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

beforeEach(() => {
  mockUpdate.mockReset();
  mockApi.mealPlan.list.mockImplementation(async () => []);
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
  expect(mockUpdate).toHaveBeenLastCalledWith("2026-09-14", { breakfast: ["eggs"], lunch: [], dinner: ["noodles"] }, 1);
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
  expect(mockUpdate).toHaveBeenLastCalledWith("2026-09-14", { breakfast: [], lunch: [], dinner: ["rice"] }, 0);
});

test('a cross-device conflict reloads the date, drops queued edits, and retries from its new revision', async () => {
  mockApi.mealPlan.list.mockImplementation(async () => [{date:'2026-09-14',breakfast:[],lunch:[],dinner:['remote'],revision:7}] as never);
  const conflict=deferred<unknown>();
  mockUpdate.mockReturnValueOnce(conflict.promise).mockImplementation(async (date,slots,revision) => ({date,...slots,revision:revision+1}));
  const {result}=await renderHook(()=>usePlannerWeek('2026-09-14'));
  await waitFor(()=>expect(result.current.state.status).toBe('ready'));
  let first!:Promise<unknown>,second!:Promise<unknown>;
  await act(async()=>{
    first=result.current.addRecipeToSlot('2026-09-14','dinner','mine').catch(e=>e);
    second=result.current.addRecipeToSlot('2026-09-14','dinner','later').catch(e=>e);
  });
  mockApi.mealPlan.list.mockImplementation(async () => [{date:'2026-09-14',breakfast:[],lunch:[],dinner:['remote','other-device'],revision:8}] as never);
  await act(async()=>{
    conflict.reject(new ApiError('Changed',409,'meal_plan_conflict'));
    await Promise.all([first,second]);
  });
  expect(mockUpdate).toHaveBeenCalledTimes(1);
  if(result.current.state.status!=='ready') throw new Error('not ready');
  expect(result.current.state.data.planByDate['2026-09-14'].dinner).toEqual(['remote','other-device']);
  await act(async()=>result.current.addRecipeToSlot('2026-09-14','dinner','retry'));
  expect(mockUpdate).toHaveBeenLastCalledWith('2026-09-14',{breakfast:[],lunch:[],dinner:['remote','other-device','retry']},8);
});

test('failed conflict reload blocks that date until refresh while other dates remain writable', async () => {
  mockUpdate.mockRejectedValueOnce(new ApiError('Changed', 409, 'meal_plan_conflict'))
    .mockImplementation(async (date, slots, revision) => ({ date, ...slots, revision: revision + 1 }));
  const { result } = await renderHook(() => usePlannerWeek('2026-09-14'));
  await waitFor(() => expect(result.current.state.status).toBe('ready'));
  mockApi.mealPlan.list.mockRejectedValueOnce(new Error('Offline') as never);
  let failure: unknown;
  await act(async () => { failure = await result.current.addRecipeToSlot('2026-09-14', 'dinner', 'mine').catch(error => error); });
  expect(failure).toMatchObject({ code: 'meal_plan_conflict_reload_failed' });
  await act(async () => { await expect(result.current.addRecipeToSlot('2026-09-14', 'dinner', 'blocked')).rejects.toMatchObject({ code: 'meal_plan_conflict_reload_failed' }); });
  expect(mockUpdate).toHaveBeenCalledTimes(1);
  await act(async () => { await result.current.addRecipeToSlot('2026-09-15', 'dinner', 'other-date'); });
  expect(mockUpdate).toHaveBeenCalledTimes(2);
  mockApi.mealPlan.list.mockImplementation(async () => [{date:'2026-09-14',breakfast:[],lunch:[],dinner:['remote'],revision:9}] as never);
  await act(async () => { await result.current.refresh(); });
  await act(async () => { await result.current.addRecipeToSlot('2026-09-14', 'dinner', 'retry'); });
  expect(mockUpdate).toHaveBeenLastCalledWith('2026-09-14', {breakfast:[], lunch:[], dinner:['remote','retry']}, 9);
});

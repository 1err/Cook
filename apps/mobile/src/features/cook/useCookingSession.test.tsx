import { act, renderHook, waitFor } from "@testing-library/react-native";
import type { CookingSession, CookingStep } from "@cooking/shared";
import { ApiError } from "@cooking/api-client";
import { useCookingSession } from "./useCookingSession";
import { readCookingStorage, writeCookingStorage } from "./storage";

jest.mock(
  "@react-native-async-storage/async-storage",
  () => require("@react-native-async-storage/async-storage/jest/async-storage-mock"),
);

const mockActive = jest.fn();
const mockAction = jest.fn();
const mockAddDishes = jest.fn();
const mockRemoveDish = jest.fn();
const mockFinish = jest.fn();
const mockDiscard = jest.fn();
const mockApiClient = {
  cooking: {
    active: mockActive,
    action: mockAction,
    addDishes: mockAddDishes,
    removeDish: mockRemoveDish,
    finish: mockFinish,
    discard: mockDiscard,
  },
};

jest.mock("../../lib/api", () => ({ useApiClient: () => mockApiClient }));
jest.mock("@react-navigation/native", () => ({
  useFocusEffect: (effect: () => void | (() => void)) => {
    const ReactModule = require("react") as typeof import("react");
    ReactModule.useEffect(effect, [effect]);
  },
}));

const readyStep: CookingStep = {
  id: "step-1",
  recipe_step_id: "recipe-step-1",
  position: 0,
  text: "Chop tofu",
  duration_seconds: 120,
  duration_source: "stated",
  attention_type: "hands_on",
  action_type: "chop",
  image_url: null,
  state: "ready",
  timer_started_at: null,
  timer_ends_at: null,
  paused_remaining_seconds: null,
  resolved_at: null,
  notification_owner_device_id: null,
  revision: 2,
  updated_at: "2026-08-27T11:00:00.000Z",
};
const session: CookingSession = {
  id: "session-1",
  version: 1,
  created_at: "2026-08-27T11:00:00.000Z",
  updated_at: "2026-08-27T11:00:00.000Z",
  dishes: [{
    id: "dish-1",
    recipe_id: "recipe-1",
    position: 0,
    title: "Mapo tofu",
    thumbnail_url: null,
    ingredients: [],
    equipment: [],
    tips: [],
    created_at: "2026-08-27T11:00:00.000Z",
    steps: [readyStep],
  }],
};

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date("2026-08-27T12:00:00.000Z"));
  jest.clearAllMocks();
  mockActive.mockResolvedValue(session);
});

afterEach(() => jest.useRealTimers());

test("loads on focus and polls while the Cook screen remains focused", async () => {
  const { unmount } = await renderHook(() => useCookingSession());
  await waitFor(() => expect(mockActive).toHaveBeenCalledTimes(1));

  await act(async () => {
    jest.advanceTimersByTime(5_000);
    await Promise.resolve();
  });
  expect(mockActive).toHaveBeenCalledTimes(2);

  await act(async () => unmount());
  jest.advanceTimersByTime(5_000);
  expect(mockActive).toHaveBeenCalledTimes(2);
});

test("optimistically applies a step action and accepts the canonical response", async () => {
  const canonical = {
    ...session,
    version: 2,
    dishes: [{ ...session.dishes[0], steps: [{ ...readyStep, state: "completed" as const, revision: 3 }] }],
  };
  mockAction.mockResolvedValue(canonical);
  const { result } = await renderHook(() => useCookingSession());
  await waitFor(() => expect(result.current.status).toBe("ready"));

  await act(async () => result.current.applyAction("dish-1", "step-1", "complete"));

  expect(mockAction).toHaveBeenCalledWith(
    "session-1",
    "step-1",
    expect.objectContaining({ action: "complete", expected_revision: 2 }),
  );
  expect(result.current.session).toEqual(canonical);
});

test("keeps a cached session readable when the initial refresh is offline", async () => {
  await writeCookingStorage("user-1", {
    version: 1,
    user_id: "user-1",
    session,
    queue: [],
    device_id: "device-a",
    preferences: { notifications: false, sound: true, vibration: true, keep_awake: true },
    updated_at: "2026-08-27T11:00:00.000Z",
  });
  mockActive.mockRejectedValueOnce(new TypeError("Network request failed")).mockResolvedValueOnce(session);

  const { result } = await renderHook(() => useCookingSession("user-1"));
  await waitFor(() => expect(result.current.notice).toBe("cook.offline.cached"));

  expect(result.current.session).toEqual(session);

  await act(async () => result.current.refresh());
  expect(result.current.notice).toBeNull();
});

test("supports structural session mutations and returns to setup after finish", async () => {
  mockAddDishes.mockResolvedValue({ ...session, version: 2 });
  mockRemoveDish.mockResolvedValue(session);
  mockFinish.mockResolvedValue({ ok: true });
  mockDiscard.mockResolvedValue({ ok: true });
  const { result } = await renderHook(() => useCookingSession());
  await waitFor(() => expect(result.current.status).toBe("ready"));

  await act(async () => result.current.addDishes(["recipe-2"]));
  expect(mockAddDishes).toHaveBeenCalledWith("session-1", ["recipe-2"]);
  await act(async () => result.current.removeDish("dish-1"));
  expect(mockRemoveDish).toHaveBeenCalledWith("session-1", "dish-1");
  await act(async () => result.current.finishSession());
  expect(result.current.session).toBeNull();
});

test("queues a step action offline and replays the same mutation later", async () => {
  mockAction.mockRejectedValueOnce(new TypeError("Network request failed"));
  const { result } = await renderHook(() => useCookingSession("user-1"));
  await waitFor(() => expect(result.current.status).toBe("ready"));

  await act(async () => result.current.applyAction("dish-1", "step-1", "complete"));
  expect(result.current.session?.dishes[0].steps[0].state).toBe("completed");
  expect(result.current.pendingCount).toBe(1);
  expect((await readCookingStorage("user-1"))?.queue).toHaveLength(1);

  mockAction.mockResolvedValue({
    ...session,
    dishes: [{ ...session.dishes[0], steps: [{ ...readyStep, state: "completed", revision: 3 }] }],
  });
  await act(async () => result.current.replayQueue());
  expect(result.current.pendingCount).toBe(0);
});

test("persists account-scoped cooking preferences", async () => {
  const { result } = await renderHook(() => useCookingSession("user-1"));
  await waitFor(() => expect(result.current.status).toBe("ready"));

  await act(async () => {
    result.current.updatePreferences({ notifications: true, keep_awake: false });
  });

  expect(result.current.preferences).toMatchObject({ notifications: true, keep_awake: false });
  await waitFor(async () => {
    expect((await readCookingStorage("user-1"))?.preferences).toMatchObject({ notifications: true, keep_awake: false });
  });
});

test("keeps a queued action when replay hits a retryable server failure", async () => {
  mockAction.mockRejectedValueOnce(new TypeError("Network request failed"));
  const { result } = await renderHook(() => useCookingSession("user-1"));
  await waitFor(() => expect(result.current.status).toBe("ready"));
  await act(async () => result.current.applyAction("dish-1", "step-1", "complete"));

  mockAction.mockRejectedValueOnce(new ApiError("Temporarily unavailable", 503));
  await act(async () => result.current.replayQueue());

  expect(result.current.pendingCount).toBe(1);
  expect((await readCookingStorage("user-1"))?.queue).toHaveLength(1);
});

import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import type { CookingSession, CookingStep } from "@cooking/shared";
import { useCookingSession } from "./useCookingSession";

const { mockAction, mockActive, mockAddDishes, mockDiscard, mockFinish, mockRemoveDish } = vi.hoisted(() => ({
  mockAction: vi.fn(),
  mockActive: vi.fn(),
  mockAddDishes: vi.fn(),
  mockDiscard: vi.fn(),
  mockFinish: vi.fn(),
  mockRemoveDish: vi.fn(),
}));

vi.mock("../lib/api", () => ({
  webApiClient: {
    cooking: {
      action: mockAction,
      active: mockActive,
      addDishes: mockAddDishes,
      discard: mockDiscard,
      finish: mockFinish,
      removeDish: mockRemoveDish,
    },
  },
}));

const readyStep: CookingStep = {
  id: "step-1",
  recipe_step_id: "recipe-step-1",
  position: 0,
  text: "Chop the tofu",
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
  dishes: [
    {
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
    },
  ],
};

beforeEach(() => {
  mockActive.mockReset();
  mockAction.mockReset();
  mockAddDishes.mockReset();
  mockDiscard.mockReset();
  mockFinish.mockReset();
  mockRemoveDish.mockReset();
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    clear: () => values.clear(),
    getItem: (key: string) => values.get(key) ?? null,
    removeItem: (key: string) => values.delete(key),
    setItem: (key: string, value: string) => values.set(key, value),
  });
});

test("loads the canonical active account session once on mount", async () => {
  mockActive.mockResolvedValue(session);

  const { result } = renderHook(() => useCookingSession());

  expect(result.current.status).toBe("loading");
  await waitFor(() => expect(result.current.status).toBe("ready"));
  expect(result.current.session).toEqual(session);
  expect(mockActive).toHaveBeenCalledTimes(1);
});

test("keeps a retryable load error and recovers through refresh", async () => {
  mockActive.mockRejectedValueOnce(new Error("Network unavailable")).mockResolvedValueOnce(null);

  const { result } = renderHook(() => useCookingSession());

  await waitFor(() => expect(result.current.status).toBe("error"));
  expect(result.current.error).toBe("Network unavailable");

  await act(async () => {
    await result.current.refresh();
  });

  expect(result.current.status).toBe("ready");
  expect(result.current.session).toBeNull();
});

test("accepts a newly created canonical session without another fetch", async () => {
  mockActive.mockResolvedValue(null);
  const { result } = renderHook(() => useCookingSession());
  await waitFor(() => expect(result.current.status).toBe("ready"));

  act(() => result.current.acceptSession(session));

  expect(result.current.session).toEqual(session);
  expect(mockActive).toHaveBeenCalledTimes(1);
});

test("posts the current revision and replaces optimistic state with the canonical response", async () => {
  const canonical: CookingSession = {
    ...session,
    version: 2,
    dishes: [{ ...session.dishes[0], steps: [{ ...readyStep, state: "completed", revision: 3 }] }],
  };
  mockActive.mockResolvedValue(session);
  mockAction.mockResolvedValue(canonical);
  const { result } = renderHook(() => useCookingSession());
  await waitFor(() => expect(result.current.status).toBe("ready"));

  await act(async () => {
    await result.current.applyAction("dish-1", "step-1", "complete");
  });

  expect(mockAction).toHaveBeenCalledWith(
    "session-1",
    "step-1",
    expect.objectContaining({ action: "complete", expected_revision: 2 }),
  );
  expect(result.current.session).toEqual(canonical);
});

test("restores the prior session and exposes a local action error when a mutation fails", async () => {
  mockActive.mockResolvedValue(session);
  mockAction.mockRejectedValue(new Error("Network unavailable"));
  const { result } = renderHook(() => useCookingSession());
  await waitFor(() => expect(result.current.status).toBe("ready"));

  await act(async () => {
    await result.current.applyAction("dish-1", "step-1", "complete");
  });

  expect(result.current.session).toEqual(session);
  expect(result.current.actionError).toBe("Network unavailable");
});

test("replaces the session after adding and removing dishes", async () => {
  const expanded = { ...session, version: 2 };
  mockActive.mockResolvedValue(session);
  mockAddDishes.mockResolvedValue(expanded);
  mockRemoveDish.mockResolvedValue(null);
  const { result } = renderHook(() => useCookingSession());
  await waitFor(() => expect(result.current.status).toBe("ready"));

  await act(async () => result.current.addDishes(["recipe-2"]));
  expect(mockAddDishes).toHaveBeenCalledWith("session-1", ["recipe-2"]);
  expect(result.current.session).toEqual(expanded);

  await act(async () => result.current.removeDish("dish-1"));
  expect(mockRemoveDish).toHaveBeenCalledWith("session-1", "dish-1");
  expect(result.current.session).toBeNull();
});

test("returns to setup after finishing or discarding the canonical session", async () => {
  mockActive.mockResolvedValue(session);
  mockFinish.mockResolvedValue({ ok: true });
  mockDiscard.mockResolvedValue({ ok: true });
  const { result } = renderHook(() => useCookingSession());
  await waitFor(() => expect(result.current.status).toBe("ready"));

  await act(async () => result.current.finishSession());
  expect(mockFinish).toHaveBeenCalledWith("session-1");
  expect(result.current.session).toBeNull();

  act(() => result.current.acceptSession(session));
  await act(async () => result.current.discardSession());
  expect(mockDiscard).toHaveBeenCalledWith("session-1");
  expect(result.current.session).toBeNull();
});

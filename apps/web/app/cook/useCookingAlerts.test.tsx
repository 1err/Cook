import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { CookingSession, CookingSessionPreferences } from "@cooking/shared";
import { useCookingAlerts } from "./useCookingAlerts";

const timerEndsAt = "2026-08-27T12:00:01.000Z";
const session: CookingSession = {
  id: "session-1",
  version: 1,
  created_at: "2026-08-27T12:00:00.000Z",
  updated_at: "2026-08-27T12:00:00.000Z",
  dishes: [{
    id: "dish-1",
    recipe_id: "recipe-1",
    position: 0,
    title: "Steamed rice",
    thumbnail_url: null,
    ingredients: [],
    equipment: [],
    tips: [],
    created_at: "2026-08-27T12:00:00.000Z",
    steps: [{
      id: "step-1",
      recipe_step_id: "recipe-step-1",
      position: 0,
      text: "Steam the rice",
      duration_seconds: 1,
      duration_source: "stated",
      attention_type: "passive",
      action_type: "simmer",
      image_url: null,
      state: "timer_running",
      timer_started_at: "2026-08-27T12:00:00.000Z",
      timer_ends_at: timerEndsAt,
      paused_remaining_seconds: null,
      resolved_at: null,
      notification_owner_device_id: "device-a",
      revision: 1,
      updated_at: "2026-08-27T12:00:00.000Z",
    }],
  }],
};
const copy = {
  unsupported: "Unsupported",
  permissionOff: "Permission off",
  timerTitle: "Timer needs attention",
  timerBody: (dish: string) => `${dish} is ready to check.`,
};
const preferences: CookingSessionPreferences = {
  notifications: false,
  sound: false,
  vibration: false,
  keep_awake: true,
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-08-27T12:00:00.000Z"));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

test("does not request notification permission until the user enables it", () => {
  const requestPermission = vi.fn();
  vi.stubGlobal("Notification", class {
    static permission = "default";
    static requestPermission = requestPermission;
  });

  renderHook(() => useCookingAlerts(session, "device-a", preferences, vi.fn(), copy));

  expect(requestPermission).not.toHaveBeenCalled();
});

test("plays owned browser-alive sound and vibration without requiring notifications", () => {
  const vibrate = vi.fn();
  Object.defineProperty(navigator, "vibrate", { configurable: true, value: vibrate });
  const start = vi.fn();
  const AudioContextMock = class {
    currentTime = 0;
    destination = {};
    createOscillator() {
      return { frequency: { value: 0 }, connect: vi.fn(), start, stop: vi.fn() };
    }
    createGain() {
      return {
        gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
        connect: vi.fn(),
      };
    }
    close = vi.fn().mockResolvedValue(undefined);
  };
  vi.stubGlobal("AudioContext", AudioContextMock);

  renderHook(() => useCookingAlerts(
    session,
    "device-a",
    { ...preferences, sound: true, vibration: true },
    vi.fn(),
    copy,
  ));
  act(() => vi.advanceTimersByTime(1_000));

  expect(start).toHaveBeenCalledTimes(1);
  expect(vibrate).toHaveBeenCalledWith([200, 100, 200]);
});

test("does not emit an alert for a timer owned by another device", () => {
  const vibrate = vi.fn();
  Object.defineProperty(navigator, "vibrate", { configurable: true, value: vibrate });
  renderHook(() => useCookingAlerts(
    session,
    "device-b",
    { ...preferences, vibration: true },
    vi.fn(),
    copy,
  ));
  act(() => vi.advanceTimersByTime(1_000));

  expect(vibrate).not.toHaveBeenCalled();
});

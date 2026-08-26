import * as Notifications from "expo-notifications";
import type { CookingSession, CookingStep } from "@cooking/shared";
import { cancelAllCookingNotifications, reconcileCookingNotifications, resetCookingNotificationState } from "./notifications";

jest.mock("expo-notifications", () => ({
  SchedulableTriggerInputTypes: { DATE: "date" },
  getAllScheduledNotificationsAsync: jest.fn(),
  scheduleNotificationAsync: jest.fn(),
  cancelScheduledNotificationAsync: jest.fn(),
}));

const step: CookingStep = {
  id: "step-1",
  recipe_step_id: "recipe-step-1",
  position: 0,
  text: "Rest the dough",
  duration_seconds: 600,
  duration_source: "stated",
  attention_type: "passive",
  action_type: "rest",
  image_url: null,
  state: "timer_running",
  timer_started_at: "2026-08-27T12:00:00.000Z",
  timer_ends_at: "2026-08-27T12:10:00.000Z",
  paused_remaining_seconds: null,
  resolved_at: null,
  notification_owner_device_id: "device-a",
  revision: 2,
  updated_at: "2026-08-27T12:00:00.000Z",
};
const session: CookingSession = {
  id: "session-1",
  version: 1,
  created_at: step.updated_at,
  updated_at: step.updated_at,
  dishes: [{
    id: "dish-1",
    recipe_id: "recipe-1",
    position: 0,
    title: "Bread",
    thumbnail_url: null,
    ingredients: [],
    equipment: [],
    tips: [],
    created_at: step.updated_at,
    steps: [step],
  }],
};
const preferences = { notifications: true, sound: true, vibration: true, keep_awake: true };

beforeEach(() => {
  jest.clearAllMocks();
  resetCookingNotificationState();
  jest.mocked(Notifications.scheduleNotificationAsync).mockResolvedValue("notification-1");
  jest.mocked(Notifications.getAllScheduledNotificationsAsync).mockResolvedValue([]);
});

test("schedules an absolute local alert only for an owned running timer", async () => {
  await reconcileCookingNotifications(session, "device-a", preferences, {
    title: "Timer needs attention",
    body: (dish) => `${dish} is ready to check.`,
  });
  expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledWith({
    identifier: expect.stringMatching(/^cooking:/),
    content: expect.objectContaining({
      title: "Timer needs attention",
      data: { cookingTimerKey: `step-1:${step.timer_ends_at}` },
    }),
    trigger: expect.objectContaining({ date: new Date(step.timer_ends_at!) }),
  });

  jest.clearAllMocks();
  resetCookingNotificationState();
  await reconcileCookingNotifications(session, "other-device", preferences, {
    title: "Timer needs attention",
    body: (dish) => `${dish} is ready to check.`,
  });
  expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
});

test("rehydrates the native schedule after an app restart without duplicating alerts", async () => {
  resetCookingNotificationState();
  jest.mocked(Notifications.getAllScheduledNotificationsAsync).mockResolvedValue([{
    identifier: "existing-notification",
    content: {
      title: null,
      subtitle: null,
      body: null,
      data: { cookingTimerKey: `step-1:${step.timer_ends_at}` },
      categoryIdentifier: null,
      sound: null,
    },
    trigger: null,
  }]);

  await reconcileCookingNotifications(session, "device-a", preferences, {
    title: "Timer needs attention",
    body: (dish) => `${dish} is ready to check.`,
  });

  expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
  expect(Notifications.cancelScheduledNotificationAsync).not.toHaveBeenCalled();
});

test("cancels a scheduled alert after pause, completion, or ownership change", async () => {
  const copy = { title: "Timer needs attention", body: (dish: string) => `${dish} is ready to check.` };
  await reconcileCookingNotifications(session, "device-a", preferences, copy);
  await reconcileCookingNotifications({ ...session, dishes: [] }, "device-a", preferences, copy);
  expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith("notification-1");
});

test("cancels only cooking-owned native alerts on logout", async () => {
  jest.mocked(Notifications.getAllScheduledNotificationsAsync).mockResolvedValue([
    {
      identifier: "cooking-alert",
      content: {
        title: null,
        subtitle: null,
        body: null,
        data: { cookingTimerKey: "step-1:end" },
        categoryIdentifier: null,
        sound: null,
      },
      trigger: null,
    },
    {
      identifier: "unrelated-alert",
      content: {
        title: null,
        subtitle: null,
        body: null,
        data: {},
        categoryIdentifier: null,
        sound: null,
      },
      trigger: null,
    },
  ]);

  await cancelAllCookingNotifications();

  expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledTimes(1);
  expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith("cooking-alert");
});

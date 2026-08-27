import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import type { CookingSession, CookingSessionPreferences } from "@cooking/shared";

const scheduled = new Map<string, string>();
const COOKING_CHANNEL_ID = "cooking-timers";
let channelReady: Promise<void> | null = null;

export function ensureCookingNotificationChannel(): Promise<void> {
  if (Platform.OS !== "android" || typeof Notifications.setNotificationChannelAsync !== "function") {
    return Promise.resolve();
  }
  if (!channelReady) {
    channelReady = Notifications.setNotificationChannelAsync(COOKING_CHANNEL_ID, {
      name: "Cooking timers",
      importance: Notifications.AndroidImportance.HIGH,
      sound: "default",
      vibrationPattern: [0, 250, 150, 250],
    }).then(() => undefined);
  }
  return channelReady;
}

if (typeof Notifications.setNotificationHandler === "function") {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldPlaySound: true,
      shouldSetBadge: false,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  });
}

export function resetCookingNotificationState(): void {
  scheduled.clear();
}

export async function cancelAllCookingNotifications(): Promise<void> {
  try {
    const installed = await Notifications.getAllScheduledNotificationsAsync();
    await Promise.all(installed
      .filter((request) => typeof request.content.data?.cookingTimerKey === "string")
      .map((request) => Notifications.cancelScheduledNotificationAsync(request.identifier)));
  } finally {
    scheduled.clear();
  }
}

export async function reconcileCookingNotifications(
  session: CookingSession | null,
  deviceId: string,
  preferences: CookingSessionPreferences,
  copy: { title: string; body: (dish: string) => string },
): Promise<void> {
  const desired = new Map<string, { dish: string; endsAt: string }>();
  if (preferences.notifications && session) {
    for (const dish of session.dishes) {
      for (const step of dish.steps) {
        if (
          step.state === "timer_running" &&
          step.timer_ends_at &&
          step.notification_owner_device_id === deviceId
        ) {
          desired.set(`${step.id}:${step.timer_ends_at}`, { dish: dish.title, endsAt: step.timer_ends_at });
        }
      }
    }
  }

  try {
    const installed = await Notifications.getAllScheduledNotificationsAsync();
    for (const request of installed) {
      const key = request.content.data?.cookingTimerKey;
      if (typeof key === "string") scheduled.set(key, request.identifier);
    }
  } catch {
    // The in-memory registry still prevents duplicates during this app run.
  }

  for (const [key, notificationId] of [...scheduled]) {
    if (!desired.has(key)) {
      await Notifications.cancelScheduledNotificationAsync(notificationId);
      scheduled.delete(key);
    }
  }

  for (const [key, timer] of desired) {
    if (scheduled.has(key)) continue;
    await ensureCookingNotificationChannel();
    const notificationId = await Notifications.scheduleNotificationAsync({
      identifier: `cooking:${key}`,
      content: {
        title: copy.title,
        body: copy.body(timer.dish),
        data: { cookingTimerKey: key },
        sound: preferences.sound,
        ...(preferences.vibration ? { vibrate: [0, 250, 150, 250] } : {}),
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: new Date(timer.endsAt),
        ...(Platform.OS === "android" ? { channelId: COOKING_CHANNEL_ID } : {}),
      },
    });
    scheduled.set(key, notificationId);
  }
}

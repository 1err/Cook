import { act, renderHook, waitFor } from "@testing-library/react-native";
import * as Notifications from "expo-notifications";
import type { CookingSessionPreferences } from "@cooking/shared";
import { useCookingAlerts } from "./useCookingAlerts";
import { reconcileCookingNotifications } from "./notifications";

jest.mock("expo-notifications", () => ({
  getPermissionsAsync: jest.fn(),
  requestPermissionsAsync: jest.fn(),
}));
jest.mock("./useCookingSession", () => ({ getCookingDeviceId: jest.fn().mockResolvedValue("device-a") }));
jest.mock("./notifications", () => ({
  ensureCookingNotificationChannel: jest.fn().mockResolvedValue(undefined),
  reconcileCookingNotifications: jest.fn().mockResolvedValue(undefined),
}));

const preferences: CookingSessionPreferences = {
  notifications: false,
  sound: true,
  vibration: true,
  keep_awake: true,
};
const copy = {
  permissionOff: "Timers still work, but alerts are off.",
  title: "Timer needs attention",
  body: (dish: string) => `${dish} is ready to check.`,
};

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(Notifications.getPermissionsAsync).mockResolvedValue({ granted: false } as never);
  jest.mocked(Notifications.requestPermissionsAsync).mockResolvedValue({ granted: false } as never);
});

test("waits for an explicit toggle and keeps timers usable when permission is denied", async () => {
  const onPreferenceChange = jest.fn();
  const { result } = await renderHook(() => useCookingAlerts(null, preferences, onPreferenceChange, copy));
  await waitFor(() => expect(reconcileCookingNotifications).toHaveBeenCalled());
  expect(Notifications.requestPermissionsAsync).not.toHaveBeenCalled();

  await act(async () => result.current.setAlertsEnabled(true));

  expect(Notifications.requestPermissionsAsync).toHaveBeenCalledTimes(1);
  expect(onPreferenceChange).toHaveBeenCalledWith({ notifications: false });
  expect(result.current.limitation).toBe("Timers still work, but alerts are off.");
});

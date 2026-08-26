import { useCallback, useEffect, useState } from "react";
import * as Notifications from "expo-notifications";
import type { CookingSession, CookingSessionPreferences } from "@cooking/shared";
import { getCookingDeviceId } from "./useCookingSession";
import { ensureCookingNotificationChannel, reconcileCookingNotifications } from "./notifications";

export function useCookingAlerts(
  session: CookingSession | null,
  preferences: CookingSessionPreferences,
  onPreferenceChange: (patch: Partial<CookingSessionPreferences>) => void,
  copy: { permissionOff: string; title: string; body: (dish: string) => string },
) {
  const [enabled, setEnabled] = useState(false);
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [limitation, setLimitation] = useState<string | null>(null);

  useEffect(() => {
    void getCookingDeviceId().then(setDeviceId);
  }, []);

  useEffect(() => {
    if (!preferences.notifications) {
      setEnabled(false);
      return;
    }
    void Notifications.getPermissionsAsync().then((permission) => {
      if (permission.granted) setEnabled(true);
    });
  }, [preferences.notifications]);

  useEffect(() => {
    if (!deviceId) return;
    void reconcileCookingNotifications(session, deviceId, { ...preferences, notifications: enabled }, copy);
  }, [copy, deviceId, enabled, preferences, session]);

  const setAlertsEnabled = useCallback(async (next: boolean) => {
    if (!next) {
      setEnabled(false);
      setLimitation(null);
      onPreferenceChange({ notifications: false });
      return;
    }
    await ensureCookingNotificationChannel();
    const current = await Notifications.getPermissionsAsync();
    const permission = current.granted ? current : await Notifications.requestPermissionsAsync();
    if (!permission.granted) {
      setEnabled(false);
      setLimitation(copy.permissionOff);
      onPreferenceChange({ notifications: false });
      return;
    }
    setEnabled(true);
    setLimitation(null);
    onPreferenceChange({ notifications: true });
  }, [copy.permissionOff, onPreferenceChange]);

  return { enabled, deviceId, limitation, setAlertsEnabled };
}

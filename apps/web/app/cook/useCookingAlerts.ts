import { useCallback, useEffect, useRef, useState } from "react";
import type { CookingSession, CookingSessionPreferences } from "@cooking/shared";

type CookingAlertCopy = {
  unsupported: string;
  permissionOff: string;
  timerTitle: string;
  timerBody: (dish: string) => string;
};

type AudioWindow = Window & {
  webkitAudioContext?: typeof AudioContext;
};

async function playTimerTone(): Promise<void> {
  const AudioContextClass = window.AudioContext ?? (window as AudioWindow).webkitAudioContext;
  if (!AudioContextClass) return;
  try {
    const context = new AudioContextClass();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.frequency.value = 740;
    gain.gain.setValueAtTime(0.0001, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.18, context.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.45);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.46);
    window.setTimeout(() => void context.close(), 550);
  } catch {
    // Browser autoplay policies may reject sound; visual timer state remains authoritative.
  }
}

export function useCookingAlerts(
  session: CookingSession | null,
  deviceId: string,
  preferences: CookingSessionPreferences,
  onPreferenceChange: (patch: Partial<CookingSessionPreferences>) => void,
  copy: CookingAlertCopy,
) {
  const [enabled, setEnabled] = useState(false);
  const [limitation, setLimitation] = useState<string | null>(null);
  const notified = useRef(new Set<string>());

  useEffect(() => {
    if (!preferences.notifications) {
      setEnabled(false);
      return;
    }
    if ("Notification" in window && Notification.permission === "granted") setEnabled(true);
  }, [preferences.notifications]);

  const setAlertsEnabled = useCallback(async (next: boolean) => {
    if (!next) {
      setEnabled(false);
      setLimitation(null);
      onPreferenceChange({ notifications: false });
      return;
    }
    if (!("Notification" in window)) {
      setLimitation(copy.unsupported);
      onPreferenceChange({ notifications: false });
      return;
    }
    const permission = Notification.permission === "granted"
      ? "granted"
      : await Notification.requestPermission();
    if (permission !== "granted") {
      setLimitation(copy.permissionOff);
      onPreferenceChange({ notifications: false });
      return;
    }
    setEnabled(true);
    setLimitation(null);
    onPreferenceChange({ notifications: true });
  }, [copy.permissionOff, copy.unsupported, onPreferenceChange]);

  useEffect(() => {
    if (!session || (!enabled && !preferences.sound && !preferences.vibration)) return;
    const owned = session.dishes.flatMap((dish) => dish.steps
      .filter((step) => step.state === "timer_running" && step.timer_ends_at && step.notification_owner_device_id === deviceId)
      .map((step) => ({ dish: dish.title, step })))
      .sort((left, right) => Date.parse(left.step.timer_ends_at!) - Date.parse(right.step.timer_ends_at!));
    const nearest = owned[0];
    if (!nearest) return;
    const key = `${nearest.step.id}:${nearest.step.timer_ends_at}`;
    const delay = Math.max(0, Date.parse(nearest.step.timer_ends_at!) - Date.now());
    const timeout = window.setTimeout(() => {
      if (notified.current.has(key)) return;
      notified.current.add(key);
      if (enabled) new Notification(copy.timerTitle, { body: copy.timerBody(nearest.dish) });
      if (preferences.sound) void playTimerTone();
      if (preferences.vibration && typeof navigator.vibrate === "function") navigator.vibrate([200, 100, 200]);
    }, delay);
    return () => window.clearTimeout(timeout);
  }, [copy, deviceId, enabled, preferences.sound, preferences.vibration, session]);

  return { enabled, limitation, setAlertsEnabled };
}

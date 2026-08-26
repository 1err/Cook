import { useEffect } from "react";
import { AppState } from "react-native";
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";

const WAKE_TAG = "cooking-session";

export function useScreenWake(enabled: boolean, visible: boolean): void {
  useEffect(() => {
    const update = (appState = AppState.currentState) => {
      if (enabled && visible && appState !== "background" && appState !== "inactive") {
        void activateKeepAwakeAsync(WAKE_TAG);
      } else {
        deactivateKeepAwake(WAKE_TAG);
      }
    };
    update();
    const subscription = AppState.addEventListener("change", update);
    return () => {
      subscription.remove();
      deactivateKeepAwake(WAKE_TAG);
    };
  }, [enabled, visible]);
}

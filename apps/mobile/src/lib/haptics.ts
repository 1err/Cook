import * as Haptics from "expo-haptics";

export const haptics = {
  selection: () => {
    void Haptics.selectionAsync();
  },
  success: () => {
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  },
  warning: () => {
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
  },
  error: () => {
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
  },
  light: () => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  },
  medium: () => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  },
};

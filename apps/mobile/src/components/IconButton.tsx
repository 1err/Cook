import React from "react";
import { Pressable, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "../theme";

type IoniconName = React.ComponentProps<typeof Ionicons>["name"];

type IconButtonProps = {
  icon: IoniconName;
  onPress: () => void;
  accessibilityLabel: string;
  tint?: string;
  size?: number;
  disabled?: boolean;
};

export function IconButton({
  icon,
  onPress,
  accessibilityLabel,
  tint = colors.terracotta,
  size = 24,
  disabled = false,
}: IconButtonProps) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      hitSlop={12}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled }}
      style={({ pressed }) => [styles.button, pressed && !disabled && styles.pressed, disabled && styles.disabled]}
    >
      <Ionicons name={icon} size={size} color={tint} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    minWidth: 44,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  pressed: { opacity: 0.6 },
  disabled: { opacity: 0.4 },
});

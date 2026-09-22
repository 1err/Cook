import React, { type ReactNode } from "react";
import { Pressable, StyleSheet, View, type ViewStyle } from "react-native";
import { colors, radii, spacing } from "../theme";

type CardProps = {
  children: ReactNode;
  onPress?: () => void;
  onLongPress?: () => void;
  style?: ViewStyle;
  elevated?: boolean;
};

export function Card({ children, onPress, onLongPress, style, elevated = true }: CardProps) {
  if (onPress || onLongPress) {
    return (
      <Pressable
        onPress={onPress}
        onLongPress={onLongPress}
        style={({ pressed }) => [
          styles.card,
          elevated && styles.elevated,
          pressed && styles.pressed,
          style,
        ]}
      >
        {children}
      </Pressable>
    );
  }
  return <View style={[styles.card, elevated && styles.elevated, style]}>{children}</View>;
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.white,
    borderRadius: radii.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.divider,
  },
  elevated: {},
  pressed: {
    opacity: 0.94,
  },
});

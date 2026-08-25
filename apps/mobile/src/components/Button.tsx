import React, { type ReactNode } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
  type ViewStyle,
} from "react-native";
import { colors, radii, spacing, typography } from "../theme";
import { haptics } from "../lib/haptics";

type Variant = "primary" | "secondary" | "ghost" | "destructive";
type Size = "md" | "lg";

type ButtonProps = {
  title: string;
  onPress: () => void;
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  disabled?: boolean;
  fullWidth?: boolean;
  leadingIcon?: ReactNode;
  style?: ViewStyle;
};

export function Button({
  title,
  onPress,
  variant = "primary",
  size = "md",
  loading = false,
  disabled = false,
  fullWidth = false,
  leadingIcon,
  style,
}: ButtonProps) {
  const containerStyle = [
    styles.base,
    sizeStyles[size],
    variantStyles[variant].container,
    fullWidth && styles.fullWidth,
    (disabled || loading) && styles.disabled,
    style,
  ];

  const handlePressIn = () => {
    if (disabled || loading) return;
    if (variant === "primary" || variant === "destructive") {
      haptics.selection();
    }
  };

  return (
    <Pressable
      onPress={onPress}
      onPressIn={handlePressIn}
      disabled={disabled || loading}
      unstable_pressDelay={0}
      style={({ pressed }) => [containerStyle, pressed && !disabled && !loading && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled: disabled || loading, busy: loading }}
    >
      <View style={styles.row}>
        {loading ? (
          <ActivityIndicator style={styles.leading} color={variantStyles[variant].label.color} />
        ) : leadingIcon ? (
          <View style={styles.leading}>{leadingIcon}</View>
        ) : null}
        <Text style={[styles.label, variantStyles[variant].label]}>{title}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: 44,
    borderRadius: radii.md,
    alignItems: "center",
    justifyContent: "center",
  },
  row: { flexDirection: "row", alignItems: "center" },
  leading: { marginRight: spacing.sm },
  label: { ...typography.headline },
  fullWidth: { alignSelf: "stretch" },
  disabled: { opacity: 0.5 },
  pressed: { opacity: 0.85 },
});

const sizeStyles: Record<Size, ViewStyle> = {
  md: { paddingVertical: spacing.md, paddingHorizontal: spacing.xl },
  lg: { paddingVertical: spacing.lg, paddingHorizontal: spacing["2xl"] },
};

type VariantStyle = { container: ViewStyle; label: { color: string } };
const variantStyles: Record<Variant, VariantStyle> = {
  primary: {
    container: { backgroundColor: colors.terracotta },
    label: { color: colors.onAction },
  },
  secondary: {
    container: {
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.divider,
    },
    label: { color: colors.ink },
  },
  ghost: {
    container: { backgroundColor: "transparent", paddingHorizontal: spacing.md },
    label: { color: colors.terracotta },
  },
  destructive: {
    container: { backgroundColor: colors.error },
    label: { color: colors.onAction },
  },
};

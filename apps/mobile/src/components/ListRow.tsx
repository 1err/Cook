import React, { type ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors, spacing, typography } from "../theme";

type ListRowProps = {
  title: string;
  subtitle?: string;
  leading?: ReactNode;
  trailing?: ReactNode;
  onPress?: () => void;
  onLongPress?: () => void;
  showChevron?: boolean;
  destructive?: boolean;
};

export function ListRow({
  title,
  subtitle,
  leading,
  trailing,
  onPress,
  onLongPress,
  showChevron = true,
  destructive = false,
}: ListRowProps) {
  const inner = (
    <View style={styles.row}>
      {leading ? <View style={styles.leading}>{leading}</View> : null}
      <View style={styles.body}>
        <Text style={[styles.title, destructive && styles.destructive]} numberOfLines={2}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={styles.subtitle} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {trailing ? (
        <View style={styles.trailing}>{trailing}</View>
      ) : showChevron && onPress ? (
        <Ionicons name="chevron-forward" size={18} color={colors.onSurfaceVariant} />
      ) : null}
    </View>
  );

  if (onPress || onLongPress) {
    return (
      <Pressable
        onPress={onPress}
        onLongPress={onLongPress}
        style={({ pressed }) => [styles.pressable, pressed && styles.pressed]}
      >
        {inner}
      </Pressable>
    );
  }
  return <View style={styles.pressable}>{inner}</View>;
}

const styles = StyleSheet.create({
  pressable: {
    backgroundColor: colors.white,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  pressed: { backgroundColor: colors.surfaceContainerLow },
  row: { flexDirection: "row", alignItems: "center" },
  leading: { marginRight: spacing.md },
  body: { flex: 1 },
  trailing: { marginLeft: spacing.md },
  title: { ...typography.body, color: colors.onSurface },
  destructive: { color: colors.error },
  subtitle: { ...typography.subhead, color: colors.onSurfaceVariant, marginTop: 2 },
});

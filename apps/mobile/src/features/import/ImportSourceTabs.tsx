import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { colors, spacing, typography } from "../../theme";

export type ImportMode = "link" | "transcript";

type ImportSourceTabsProps = {
  value: ImportMode;
  onChange: (next: ImportMode) => void;
  disabled?: boolean;
};

export function ImportSourceTabs({ value, onChange, disabled = false }: ImportSourceTabsProps) {
  return (
    <View style={styles.wrap}>
      {(["link", "transcript"] as ImportMode[]).map((mode) => {
        const active = value === mode;
        return (
          <Pressable
            key={mode}
            onPress={() => onChange(mode)}
            disabled={disabled}
            style={({ pressed }) => [
              styles.tab,
              active && styles.tabActive,
              pressed && styles.pressed,
            ]}
            accessibilityRole="tab"
            accessibilityState={{ selected: active, disabled }}
          >
            <Text style={[styles.label, active && styles.labelActive]}>
              {mode === "link" ? "Video link" : "Transcript"}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
    marginBottom: spacing.xl,
    gap: spacing.md,
  },
  tab: {
    flex: 1,
    minHeight: 44,
    paddingVertical: spacing.sm,
    alignItems: "center",
    justifyContent: "center",
    borderBottomWidth: 2,
    borderBottomColor: "transparent",
  },
  tabActive: { borderBottomColor: colors.terracotta },
  label: { ...typography.subhead, color: colors.onSurfaceVariant, fontWeight: "600" },
  labelActive: { color: colors.terracotta },
  pressed: { opacity: 0.8 },
});

import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { colors, radii, spacing, typography } from "../../theme";

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
    backgroundColor: colors.surfaceContainerLow,
    borderRadius: radii.md,
    padding: 4,
    marginBottom: spacing.lg,
    borderWidth: 1,
    borderColor: colors.divider,
  },
  tab: {
    flex: 1,
    paddingVertical: spacing.sm,
    borderRadius: radii.sm,
    alignItems: "center",
  },
  tabActive: {
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.divider,
  },
  label: { ...typography.subhead, color: colors.onSurfaceVariant, fontWeight: "600" },
  labelActive: { color: colors.onSurface },
  pressed: { opacity: 0.8 },
});

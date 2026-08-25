import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { colors, radii, spacing, typography } from "../theme";

export type SegmentedOption<T extends string> = {
  value: T;
  label: string;
};

export type SegmentedControlProps<T extends string> = {
  label: string;
  value: T;
  options: readonly SegmentedOption<T>[];
  onChange: (value: T) => void;
  disabled?: boolean;
};

export function SegmentedControl<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled = false,
}: SegmentedControlProps<T>) {
  return (
    <View>
      <Text style={styles.groupLabel}>{label}</Text>
      <View accessibilityRole="radiogroup" accessibilityLabel={label} style={styles.group}>
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <Pressable
              key={option.value}
              accessibilityRole="button"
              accessibilityLabel={option.label}
              accessibilityState={{ disabled, selected }}
              disabled={disabled}
              onPress={() => onChange(option.value)}
              style={({ pressed }) => [
                styles.option,
                selected ? styles.selectedOption : styles.unselectedOption,
                pressed && styles.pressedOption,
                disabled && styles.disabled,
              ]}
            >
              <Text style={[styles.optionLabel, selected ? styles.selectedLabel : styles.unselectedLabel]}>
                {option.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  groupLabel: {
    ...typography.subhead,
    color: colors.mutedInk,
    marginBottom: spacing.sm,
  },
  group: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  option: {
    minWidth: 44,
    minHeight: 44,
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.md,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
  },
  selectedOption: {
    backgroundColor: colors.subtleSurface,
    borderColor: colors.terracotta,
  },
  unselectedOption: {
    backgroundColor: colors.surface,
    borderColor: "transparent",
  },
  pressedOption: {
    opacity: 0.8,
  },
  disabled: { opacity: 0.5 },
  optionLabel: typography.subhead,
  selectedLabel: {
    color: colors.ink,
  },
  unselectedLabel: {
    color: colors.mutedInk,
  },
});

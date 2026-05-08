import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { RECIPE_TAG_GROUPS, type RecipeTagSlug, TAG_LABELS } from "@cooking/shared";
import { colors, radii, spacing, typography } from "../../theme";

type TagPickerProps = {
  value: RecipeTagSlug[];
  onChange: (next: RecipeTagSlug[]) => void;
};

export function TagPicker({ value, onChange }: TagPickerProps) {
  const selected = new Set(value);
  const toggle = (tag: RecipeTagSlug) => {
    const next = new Set(selected);
    if (next.has(tag)) next.delete(tag);
    else next.add(tag);
    onChange(Array.from(next));
  };
  return (
    <View style={styles.wrap}>
      {RECIPE_TAG_GROUPS.map((group) => (
        <View key={group.id} style={styles.group}>
          <Text style={styles.groupLabel}>{group.label}</Text>
          <View style={styles.chipsRow}>
            {group.tags.map((tag) => {
              const active = selected.has(tag.id);
              return (
                <Pressable
                  key={tag.id}
                  onPress={() => toggle(tag.id)}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: active }}
                  style={({ pressed }) => [
                    styles.chip,
                    active && styles.chipActive,
                    pressed && styles.pressed,
                  ]}
                >
                  <Text style={[styles.chipLabel, active && styles.chipLabelActive]}>
                    {TAG_LABELS[tag.id]}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.lg, marginBottom: spacing.lg },
  group: { gap: spacing.sm },
  groupLabel: {
    ...typography.footnote,
    color: colors.onSurfaceVariant,
    fontWeight: "700",
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },
  chipsRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  chip: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    borderRadius: radii.full,
    borderWidth: 1,
    borderColor: "transparent",
    backgroundColor: colors.surfaceContainer,
  },
  chipActive: {
    backgroundColor: colors.primaryFixed,
    borderColor: colors.primary,
  },
  chipLabel: { ...typography.subhead, color: colors.onSurfaceVariant },
  chipLabelActive: { color: colors.onPrimaryFixed, fontWeight: "600" },
  pressed: { opacity: 0.85 },
});

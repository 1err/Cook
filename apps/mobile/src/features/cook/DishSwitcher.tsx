import React from "react";
import { Pressable, ScrollView, StyleSheet, Text } from "react-native";
import { getCurrentCookingStep, getDishProgress, getEffectiveStepState, type CookingDish } from "@cooking/shared";
import { useT } from "../../lib/i18n";
import { colors, radii, spacing, typography } from "../../theme";

export function DishSwitcher({
  dishes,
  selectedDishId,
  onSelect,
}: {
  dishes: CookingDish[];
  selectedDishId: string | null;
  onSelect: (dishId: string) => void;
}) {
  const t = useT();
  return (
    <ScrollView
      accessibilityLabel={t("cook.dishes.title")}
      contentContainerStyle={styles.content}
      horizontal
      showsHorizontalScrollIndicator={false}
    >
      {dishes.map((dish) => {
        const current = getCurrentCookingStep(dish);
        const needsAttention = current && getEffectiveStepState(current) === "needs_attention";
        return (
          <Pressable
            accessibilityLabel={t("cook.dish.focus", { dish: dish.title })}
            accessibilityRole="button"
            accessibilityState={{ selected: selectedDishId === dish.id }}
            key={dish.id}
            onPress={() => onSelect(dish.id)}
            style={[styles.item, selectedDishId === dish.id && styles.selected]}
          >
            <Text numberOfLines={1} style={styles.title}>{dish.title}</Text>
            <Text style={[styles.meta, needsAttention && styles.attention]}>
              {needsAttention ? t("cook.attention.needsAttention") : t("cook.progress", { progress: getDishProgress(dish) })}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { gap: spacing.sm, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  item: { minWidth: 150, minHeight: 64, justifyContent: "center", padding: spacing.md, borderRadius: radii.lg, borderWidth: 1, borderColor: colors.divider, backgroundColor: colors.surface },
  selected: { borderColor: colors.terracotta, backgroundColor: colors.subtleSurface },
  title: { ...typography.headline, color: colors.ink },
  meta: { ...typography.caption, color: colors.mutedInk, marginTop: spacing.xs },
  attention: { color: colors.error, fontWeight: "700" },
});

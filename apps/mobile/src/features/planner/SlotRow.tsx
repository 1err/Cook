import React from "react";
import {
  ActionSheetIOS,
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import type { MealType, Recipe } from "@cooking/shared";
import { colors, radii, spacing, typography } from "../../theme";

const SLOT_LABELS: Record<MealType, string> = {
  breakfast: "Breakfast",
  lunch: "Lunch",
  dinner: "Dinner",
};

type SlotRowProps = {
  slot: MealType;
  recipeIds: string[];
  recipeById: Record<string, Recipe>;
  onAddPress: () => void;
  onOpenRecipe: (recipeId: string) => void;
  onRemoveRecipe: (recipeId: string) => void;
};

function showChipMenu(slotLabel: string, onOpen: () => void, onRemove: () => void) {
  if (Platform.OS === "ios") {
    ActionSheetIOS.showActionSheetWithOptions(
      {
        options: ["Cancel", "Open recipe", `Remove from ${slotLabel}`],
        cancelButtonIndex: 0,
        destructiveButtonIndex: 2,
      },
      (i) => {
        if (i === 1) onOpen();
        if (i === 2) onRemove();
      },
    );
    return;
  }
  Alert.alert(slotLabel, undefined, [
    { text: "Cancel", style: "cancel" },
    { text: "Open recipe", onPress: onOpen },
    { text: "Remove", style: "destructive", onPress: onRemove },
  ]);
}

export function SlotRow({
  slot,
  recipeIds,
  recipeById,
  onAddPress,
  onOpenRecipe,
  onRemoveRecipe,
}: SlotRowProps) {
  const slotLabel = SLOT_LABELS[slot];
  return (
    <View style={styles.wrap}>
      <Text style={styles.slotLabel}>{slotLabel}</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chipScroller}
      >
        {recipeIds.length === 0 ? (
          <Pressable
            onPress={onAddPress}
            accessibilityRole="button"
            accessibilityLabel={`Add ${slotLabel}`}
            style={({ pressed }) => [styles.emptyAdd, pressed && styles.pressed]}
          >
            <Ionicons name="add" size={16} color={colors.onSurfaceVariant} />
            <Text style={styles.emptyAddLabel}>Add</Text>
          </Pressable>
        ) : (
          <>
            {recipeIds.map((id) => {
              const recipe = recipeById[id];
              return (
                <Pressable
                  key={id}
                  onPress={() => onOpenRecipe(id)}
                  onLongPress={() =>
                    showChipMenu(
                      slotLabel,
                      () => onOpenRecipe(id),
                      () => onRemoveRecipe(id),
                    )
                  }
                  accessibilityRole="button"
                  accessibilityLabel={recipe ? `Open ${recipe.title}` : "Recipe"}
                  style={({ pressed }) => [styles.chip, pressed && styles.pressed]}
                >
                  {recipe?.thumbnail_url ? (
                    <Image source={{ uri: recipe.thumbnail_url }} style={styles.chipThumb} contentFit="cover" />
                  ) : (
                    <View style={[styles.chipThumb, styles.chipThumbPlaceholder]}>
                      <Ionicons name="restaurant" size={14} color={colors.onPrimaryFixed} />
                    </View>
                  )}
                  <Text style={styles.chipLabel} numberOfLines={1}>
                    {recipe?.title ?? "Recipe"}
                  </Text>
                </Pressable>
              );
            })}
            <Pressable
              onPress={onAddPress}
              accessibilityRole="button"
              accessibilityLabel={`Add another ${slotLabel}`}
              style={({ pressed }) => [styles.addMore, pressed && styles.pressed]}
            >
              <Ionicons name="add" size={16} color={colors.primary} />
            </Pressable>
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: spacing.xs,
  },
  slotLabel: {
    ...typography.caption,
    color: colors.onSurfaceVariant,
    fontWeight: "700",
    letterSpacing: 0.4,
    textTransform: "uppercase",
    width: 78,
  },
  chipScroller: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingRight: spacing.lg,
  },
  emptyAdd: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radii.full,
    borderWidth: 1,
    borderColor: colors.border,
    borderStyle: "dashed",
    backgroundColor: colors.surfaceContainerLow,
    gap: spacing.xs,
  },
  emptyAddLabel: {
    ...typography.subhead,
    color: colors.onSurfaceVariant,
  },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 4,
    paddingHorizontal: 8,
    paddingRight: spacing.md,
    borderRadius: radii.full,
    backgroundColor: colors.surfaceContainerHigh,
    maxWidth: 220,
  },
  chipThumb: {
    width: 28,
    height: 28,
    borderRadius: 14,
    marginRight: spacing.sm,
    backgroundColor: colors.primaryFixed,
  },
  chipThumbPlaceholder: { alignItems: "center", justifyContent: "center" },
  chipLabel: {
    ...typography.subhead,
    color: colors.onSurface,
    flexShrink: 1,
  },
  addMore: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.primaryFixed,
  },
  pressed: { opacity: 0.85 },
});

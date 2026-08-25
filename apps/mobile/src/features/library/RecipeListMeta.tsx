import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { TAG_LABELS, getRecipeTags, type Recipe } from "@cooking/shared";
import { colors, radii, spacing, typography } from "../../theme";

type RecipeListMetaProps = {
  recipe: Pick<Recipe, "total_time_minutes" | "library_tags" | "library_category">;
};

export function RecipeListMeta({ recipe }: RecipeListMetaProps) {
  const tags = getRecipeTags(recipe).slice(0, 2);
  if (typeof recipe.total_time_minutes !== "number" && tags.length === 0) return null;

  return (
    <View style={styles.wrap}>
      {typeof recipe.total_time_minutes === "number" ? (
        <Text style={styles.time}>{recipe.total_time_minutes} min</Text>
      ) : null}
      {tags.map((tag) => (
        <View key={tag} style={styles.tag}>
          <Text style={styles.tagText} numberOfLines={1}>{TAG_LABELS[tag]}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: spacing.xs,
    marginTop: spacing.xs,
  },
  time: { ...typography.footnote, color: colors.mutedInk, marginRight: spacing.xs },
  tag: {
    maxWidth: 112,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radii.sm,
    backgroundColor: colors.subtleSurface,
  },
  tagText: { ...typography.caption, color: colors.ink },
});

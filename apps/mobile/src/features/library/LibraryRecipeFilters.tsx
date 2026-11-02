import React from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { RECIPE_TAG_GROUPS, type RecipeAuthor, type RecipeTagSlug } from "@cooking/shared";
import { useT } from "../../lib/i18n";
import { colors, radii, spacing, typography } from "../../theme";
import { AuthorFilter } from "../authors/AuthorFilter";

export function LibraryRecipeFilters({ author, onAuthorChange, tag, onTagChange }: {
  author: RecipeAuthor | null;
  onAuthorChange: (author: RecipeAuthor | null) => void;
  tag: RecipeTagSlug | null;
  onTagChange: (tag: RecipeTagSlug | null) => void;
}) {
  const t = useT();
  return <View>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tags}>
      <Pressable accessibilityRole="button" accessibilityState={{ selected: !tag }}
        onPress={() => onTagChange(null)} style={[styles.chip, !tag && styles.active]}>
        <Text style={styles.label}>{t("recipe.filters.all")}</Text>
      </Pressable>
      {RECIPE_TAG_GROUPS.flatMap(group => group.tags).map(item => <Pressable key={item.id}
        accessibilityRole="checkbox" accessibilityLabel={t(`recipe.tag.${item.id}`)} accessibilityState={{ checked: tag === item.id }}
        onPress={() => onTagChange(tag === item.id ? null : item.id)} style={[styles.chip, tag === item.id && styles.active]}>
        <Text style={styles.label}>{t(`recipe.tag.${item.id}`)}</Text>
      </Pressable>)}
    </ScrollView>
    <AuthorFilter value={author} onChange={onAuthorChange} />
  </View>;
}

const styles = StyleSheet.create({
  tags: { gap: spacing.sm, paddingBottom: spacing.sm },
  chip: { minHeight: 44, justifyContent: "center", paddingHorizontal: spacing.md, borderRadius: radii.full, backgroundColor: colors.surfaceContainer, borderWidth: 1, borderColor: colors.divider },
  active: { backgroundColor: colors.primaryFixed, borderColor: colors.primary },
  label: { ...typography.footnote, color: colors.ink },
});

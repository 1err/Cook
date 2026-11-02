import React from "react";
import { Pressable, StyleSheet, Text } from "react-native";
import type { RecipeAuthor } from "@cooking/shared";
import { useT } from "../../lib/i18n";
import { colors, spacing, typography } from "../../theme";

export function RecipeAuthorCredit({ author, onPress }: {
  author?: RecipeAuthor | null;
  onPress?: (author: RecipeAuthor) => void;
}) {
  const t = useT();
  if (!author) return null;
  const label = t("recipe.author.credit", { name: author.name });
  const credit = <Text style={styles.credit} numberOfLines={2}>{label}</Text>;
  return onPress ? (
    <Pressable accessibilityRole="button" accessibilityLabel={label} hitSlop={6}
      onPress={event => { event.stopPropagation(); onPress(author); }}>
      {credit}
    </Pressable>
  ) : credit;
}

const styles = StyleSheet.create({
  credit: { ...typography.footnote, color: colors.mutedInk, marginTop: spacing.xs },
});

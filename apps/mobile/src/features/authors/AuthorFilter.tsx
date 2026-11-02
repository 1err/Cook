import React, { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { RecipeAuthor } from "@cooking/shared";
import { useT } from "../../lib/i18n";
import { colors, radii, spacing, typography } from "../../theme";
import { AuthorPicker } from "./AuthorPicker";

export function AuthorFilter({ value, onChange }: {
  value: RecipeAuthor | null;
  onChange: (author: RecipeAuthor | null) => void;
}) {
  const t = useT();
  const [expanded, setExpanded] = useState(false);
  return <View style={styles.wrap}>
    <View style={styles.chips}>
      <Pressable accessibilityRole="button" accessibilityState={{ selected: !value }}
        style={[styles.chip, !value && styles.active]} onPress={() => { onChange(null); setExpanded(false); }}>
        <Text style={styles.label}>{t("recipe.author.filterAll")}</Text>
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityState={{ selected: Boolean(value), expanded }}
        accessibilityLabel={t("recipe.author.search")} style={[styles.chip, value && styles.active]}
        onPress={() => setExpanded(current => !current)}>
        <Text style={styles.label}>{value?.name ?? t("recipe.author.search")}</Text>
      </Pressable>
    </View>
    {expanded ? <AuthorPicker value={value} allowCreate={false} initialExpanded onDismiss={() => setExpanded(false)}
      onChange={author => { onChange(author); setExpanded(false); }} /> : null}
  </View>;
}

const styles = StyleSheet.create({
  wrap: { marginBottom: spacing.md },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  chip: { minHeight: 44, justifyContent: "center", paddingHorizontal: spacing.md, borderRadius: radii.full, backgroundColor: colors.surfaceContainer, borderWidth: 1, borderColor: colors.divider },
  active: { backgroundColor: colors.primaryFixed, borderColor: colors.primary },
  label: { ...typography.footnote, color: colors.ink },
});

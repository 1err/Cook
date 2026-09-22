import React, { useState } from "react";
import { Pressable, Share, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { ShoppingListItem } from "@cooking/shared";
import { Button, Card } from "../../components";
import { useT } from "../../lib/i18n";
import { colors, spacing, typography } from "../../theme";

export function basicShoppingItemKey(item: ShoppingListItem): string {
  return JSON.stringify([item.name, item.total_quantity]);
}

export function BasicShoppingList({ items, checked, onToggle }: {
  items: ShoppingListItem[];
  checked: ReadonlySet<string>;
  onToggle: (key: string) => void;
}) {
  const t = useT();
  const [error, setError] = useState(false);
  const text = items.filter(item => !checked.has(basicShoppingItemKey(item)))
    .map(item => [item.name, item.total_quantity].filter(Boolean).join(" — ")).join("\n");
  if (!items.length) return null;
  return <Card style={styles.card}>
    <Text style={styles.title}>{t("shopping.basicList")}</Text>
    <Text style={styles.description}>{t("shopping.basicDescription")}</Text>
    {items.map(item => {
      const key = basicShoppingItemKey(item);
      const selected = checked.has(key);
      return <View key={key} style={styles.row}>
        <Pressable accessibilityRole="checkbox" accessibilityLabel={item.name} accessibilityState={{ checked: selected }} onPress={() => onToggle(key)} style={styles.checkbox}>
          <Ionicons name={selected ? "checkbox" : "square-outline"} size={24} color={colors.primary} />
        </Pressable>
        <Text selectable style={[styles.item, selected && styles.checked]}>{[item.name, item.total_quantity].filter(Boolean).join(" — ")}</Text>
      </View>;
    })}
    <Button title={t("shopping.shareList")} variant="secondary" disabled={!text} onPress={async () => {
      setError(false);
      try { await Share.share({ message: text }); } catch { setError(true); }
    }} />
    {error ? <Text accessibilityRole="alert">{t("shopping.shareFailed")}</Text> : null}
  </Card>;
}

const styles = StyleSheet.create({
  card: { marginHorizontal: spacing.lg, marginBottom: spacing.md },
  title: { ...typography.title3, color: colors.onSurface, marginBottom: spacing.xs },
  description: { ...typography.subhead, color: colors.onSurfaceVariant, marginBottom: spacing.sm },
  row: { flexDirection: "row", alignItems: "center", marginBottom: spacing.sm },
  checkbox: { padding: spacing.sm },
  item: { ...typography.body, color: colors.onSurface, flex: 1 },
  checked: { textDecorationLine: "line-through", color: colors.onSurfaceVariant },
});

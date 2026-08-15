import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { MaterialIcons } from "@expo/vector-icons";
import type { StoreProduct } from "@cooking/api-client";
import {
  CATEGORY_MATERIAL_ICONS,
  getDisplayCategory,
  type GroceryCategory,
} from "@cooking/shared";
import { Card } from "../../components";
import { colors, spacing, typography } from "../../theme";
import type { PurchaseItem } from "./storage";
import { SmartListItem } from "./SmartListItem";

type Row = { item: PurchaseItem; origIndex: number };

type SmartListCardProps = {
  category: GroceryCategory;
  rows: Row[];
  checked: Set<number>;
  productsOpenByName: Record<string, boolean>;
  productsByName: Record<string, StoreProduct[]>;
  productsLoadingByName: Record<string, boolean>;
  productsErrorByName: Record<string, string | null>;
  onToggleChecked: (origIndex: number) => void;
  onHide: (origIndex: number) => void;
  onTogglePanel: (name: string) => void;
  onRetryProducts: (name: string) => void;
};

const ICON_SAFE_FALLBACK = "shopping-cart";

function iconNameFor(category: GroceryCategory): keyof typeof MaterialIcons.glyphMap {
  const mapped = CATEGORY_MATERIAL_ICONS[category];
  if (mapped && mapped in MaterialIcons.glyphMap) {
    return mapped as keyof typeof MaterialIcons.glyphMap;
  }
  return ICON_SAFE_FALLBACK as keyof typeof MaterialIcons.glyphMap;
}

export function SmartListCard({
  category,
  rows,
  checked,
  productsOpenByName,
  productsByName,
  productsLoadingByName,
  productsErrorByName,
  onToggleChecked,
  onHide,
  onTogglePanel,
  onRetryProducts,
}: SmartListCardProps) {
  if (rows.length === 0) return null;
  const uncheckedRows = rows.filter((r) => !checked.has(r.origIndex));
  const checkedRows = rows.filter((r) => checked.has(r.origIndex));
  const remaining = uncheckedRows.length;
  const got = checkedRows.length;

  const renderRow = ({ item, origIndex }: Row) => {
    const key = item.name.trim();
    return (
      <SmartListItem
        key={origIndex}
        item={item}
        origIndex={origIndex}
        checked={checked.has(origIndex)}
        onToggleChecked={() => onToggleChecked(origIndex)}
        onHide={() => onHide(origIndex)}
        productsOpen={!!productsOpenByName[key]}
        productsLoading={!!productsLoadingByName[key]}
        productsError={productsErrorByName[key] ?? null}
        products={productsByName[key]}
        onTogglePanel={() => onTogglePanel(key)}
        onRetryProducts={() => onRetryProducts(key)}
      />
    );
  };

  return (
    <Card style={styles.card}>
      <View style={styles.header}>
        <View style={styles.iconWrap}>
          <MaterialIcons name={iconNameFor(category)} size={18} color={colors.primary} />
        </View>
        <Text style={styles.title}>{getDisplayCategory(category, category, "en")}</Text>
        <Text style={styles.count}>
          {remaining} to buy{got > 0 ? ` · ${got} have` : ""}
        </Text>
      </View>
      <View style={styles.body}>
        {uncheckedRows.map(renderRow)}
        {checkedRows.length > 0 ? (
          <View style={styles.alreadyHaveSection}>
            <Text style={styles.alreadyHaveLabel}>Already have</Text>
            {checkedRows.map(renderRow)}
          </View>
        ) : null}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: spacing.lg,
    marginBottom: spacing.md,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingBottom: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.divider,
    marginBottom: spacing.xs,
  },
  iconWrap: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.primaryFixed,
  },
  title: { ...typography.headline, color: colors.onSurface, flex: 1 },
  count: { ...typography.caption, color: colors.onSurfaceVariant, fontWeight: "600" },
  body: {},
  alreadyHaveSection: {
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.divider,
  },
  alreadyHaveLabel: {
    ...typography.caption,
    color: colors.onSurfaceVariant,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginBottom: spacing.xs,
  },
});

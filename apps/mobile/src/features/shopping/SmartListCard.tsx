import React from "react";
import { StyleSheet, Text, View } from "react-native";
import type { StoreProduct } from "@cooking/api-client";
import { getDisplayCategory, type GroceryCategory } from "@cooking/shared";
import { Card } from "../../components";
import { colors, spacing, typography } from "../../theme";
import type { PurchaseItem } from "./storage";
import { SmartListItem } from "./SmartListItem";
import { canonicalStoreProductKey } from "./storeProductIdentity";

type Row = { item: PurchaseItem; origIndex: number };

type SmartListCardProps = {
  category: GroceryCategory;
  rows: Row[];
  checked: Set<number>;
  productsOpenByName: Record<string, boolean>;
  productsByName: Record<string, StoreProduct[]>;
  productsLoadingByName: Record<string, boolean>;
  productsErrorByName: Record<string, string | null>;
  selectedUrlByIngredient?: Record<string, string>;
  onToggleChecked: (origIndex: number) => void;
  onHide: (origIndex: number) => void;
  onTogglePanel: (name: string) => void;
  onRetryProducts: (name: string) => void;
  onSelectProduct?: (ingredientKey: string, productUrl: string) => void;
};

export function SmartListCard({
  category,
  rows,
  checked,
  productsOpenByName,
  productsByName,
  productsLoadingByName,
  productsErrorByName,
  selectedUrlByIngredient = {},
  onToggleChecked,
  onHide,
  onTogglePanel,
  onRetryProducts,
  onSelectProduct = () => {},
}: SmartListCardProps) {
  if (rows.length === 0) return null;
  const uncheckedRows = rows.filter((r) => !checked.has(r.origIndex));
  const checkedRows = rows.filter((r) => checked.has(r.origIndex));
  const remaining = uncheckedRows.length;
  const got = checkedRows.length;

  const renderRow = ({ item, origIndex }: Row) => {
    const key = canonicalStoreProductKey(item.name);
    return (
      <SmartListItem
        key={origIndex}
        item={item}
        ingredientKey={key}
        origIndex={origIndex}
        checked={checked.has(origIndex)}
        onToggleChecked={() => onToggleChecked(origIndex)}
        onHide={() => onHide(origIndex)}
        productsOpen={!!productsOpenByName[key]}
        productsLoading={!!productsLoadingByName[key]}
        productsError={productsErrorByName[key] ?? null}
        products={productsByName[key]}
        selectedProductUrl={selectedUrlByIngredient[key]}
        onTogglePanel={() => onTogglePanel(item.name)}
        onRetryProducts={() => onRetryProducts(item.name)}
        onSelectProduct={onSelectProduct}
      />
    );
  };

  return (
    <Card style={styles.card}>
      <View style={styles.header}>
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
    marginBottom: spacing.lg,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingBottom: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.divider,
    marginBottom: spacing.xs,
  },
  title: { ...typography.title3, color: colors.onSurface, flex: 1 },
  count: { ...typography.footnote, color: colors.onSurfaceVariant, fontFamily: "Inter_600SemiBold" },
  body: {},
  alreadyHaveSection: {
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.divider,
  },
  alreadyHaveLabel: {
    ...typography.footnote,
    color: colors.onSurfaceVariant,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginBottom: spacing.xs,
  },
});

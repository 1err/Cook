import React from "react";
import {
  ActionSheetIOS,
  Alert,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { StoreProduct } from "@cooking/api-client";
import { colors, radii, spacing, typography } from "../../theme";
import type { PurchaseItem } from "./storage";
import { StoreProductPicks } from "./StoreProductPicks";

type SmartListItemProps = {
  item: PurchaseItem;
  origIndex: number;
  checked: boolean;
  onToggleChecked: () => void;
  onHide: () => void;
  productsOpen: boolean;
  productsLoading: boolean;
  productsError: string | null;
  products: StoreProduct[] | undefined;
  onTogglePanel: () => void;
  onRetryProducts: () => void;
};

function showItemMenu(name: string, onHide: () => void) {
  if (Platform.OS === "ios") {
    ActionSheetIOS.showActionSheetWithOptions(
      {
        options: ["Cancel", "Remove from list"],
        cancelButtonIndex: 0,
        destructiveButtonIndex: 1,
        title: name,
      },
      (i) => {
        if (i === 1) onHide();
      },
    );
    return;
  }
  Alert.alert(name, undefined, [
    { text: "Cancel", style: "cancel" },
    { text: "Remove from list", style: "destructive", onPress: onHide },
  ]);
}

export function SmartListItem({
  item,
  checked,
  onToggleChecked,
  onHide,
  productsOpen,
  productsLoading,
  productsError,
  products,
  onTogglePanel,
  onRetryProducts,
}: SmartListItemProps) {
  return (
    <View style={styles.wrap}>
      <View style={styles.row}>
        <Pressable
          onPress={onToggleChecked}
          accessibilityRole="checkbox"
          accessibilityState={{ checked }}
          style={({ pressed }) => [styles.checkbox, checked && styles.checkboxChecked, pressed && styles.pressed]}
        >
          {checked ? <Ionicons name="checkmark" size={16} color={colors.onPrimary} /> : null}
        </Pressable>
        <View style={styles.body}>
          <Text style={[styles.name, checked && styles.nameChecked]} numberOfLines={2}>
            {item.name}
          </Text>
          {item.suggested_purchase ? (
            <Text style={styles.sub} numberOfLines={1}>
              {item.suggested_purchase}
            </Text>
          ) : null}
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Item options"
          onPress={() => showItemMenu(item.name, onHide)}
          hitSlop={8}
          style={({ pressed }) => [styles.menuBtn, pressed && styles.pressed]}
        >
          <Ionicons name="ellipsis-horizontal" size={18} color={colors.onSurfaceVariant} />
        </Pressable>
      </View>
      <Pressable
        onPress={onTogglePanel}
        accessibilityRole="button"
        style={({ pressed }) => [styles.toggle, pressed && styles.pressed]}
      >
        <Ionicons
          name={productsOpen ? "chevron-up" : "chevron-down"}
          size={14}
          color={colors.primary}
        />
        <Text style={styles.toggleLabel}>{productsOpen ? "Hide products" : "View products"}</Text>
      </Pressable>
      {productsOpen ? (
        <StoreProductPicks
          loading={productsLoading}
          error={productsError}
          products={products}
          onRetry={onRetryProducts}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.divider,
  },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.white,
  },
  checkboxChecked: { backgroundColor: colors.primary, borderColor: colors.primary },
  body: { flex: 1 },
  name: { ...typography.body, color: colors.onSurface },
  nameChecked: { textDecorationLine: "line-through", color: colors.onSurfaceVariant },
  sub: { ...typography.footnote, color: colors.onSurfaceVariant, marginTop: 2 },
  menuBtn: { padding: 4, borderRadius: radii.sm },
  toggle: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    paddingVertical: spacing.xs,
    paddingLeft: 32,
  },
  toggleLabel: { ...typography.footnote, color: colors.primary, fontWeight: "600" },
  pressed: { opacity: 0.85 },
});

import React from "react";
import { ActivityIndicator, Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import type { StoreProduct } from "@cooking/api-client";
import { PRODUCT_STORE_LABELS, type ProductStore } from "@cooking/shared";
import { Button } from "../../components";
import { colors, radii, spacing, typography } from "../../theme";

type StoreProductPicksProps = {
  store: ProductStore;
  loading: boolean;
  error: string | null;
  products: StoreProduct[] | undefined;
  onRetry: () => void;
};

export function StoreProductPicks({
  store,
  loading,
  error,
  products,
  onRetry,
}: StoreProductPicksProps) {
  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }
  if (error) {
    return (
      <View style={styles.errorWrap}>
        <Text style={styles.errorText}>{error}</Text>
        <Button title="Retry" onPress={onRetry} variant="ghost" />
      </View>
    );
  }
  if (!products || products.length === 0) {
    return (
      <View style={styles.errorWrap}>
        <Text style={styles.muted}>No products found.</Text>
        <Button title="Retry" onPress={onRetry} variant="ghost" />
      </View>
    );
  }
  return (
    <View style={styles.list}>
      {products.map((product) => (
        <View key={`${product.url}-${product.name}`} style={styles.row}>
          {product.image ? (
            <Image source={{ uri: product.image }} style={styles.image} contentFit="cover" />
          ) : (
            <View style={[styles.image, styles.imagePlaceholder]}>
              <Ionicons name="cube-outline" size={20} color={colors.onSurfaceVariant} />
            </View>
          )}
          <View style={styles.body}>
            <Text style={styles.name} numberOfLines={2}>
              {product.name}
            </Text>
            <Text style={styles.price}>{product.price}</Text>
            <Pressable
              onPress={() => {
                void Linking.openURL(product.url);
              }}
              style={({ pressed }) => [styles.linkBtn, pressed && styles.pressed]}
            >
              <Text style={styles.linkBtnText}>View on {PRODUCT_STORE_LABELS[store]}</Text>
              <Ionicons name="open-outline" size={14} color={colors.primary} />
            </Pressable>
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  center: { paddingVertical: spacing.lg, alignItems: "center" },
  errorWrap: { paddingVertical: spacing.md, alignItems: "flex-start", gap: spacing.xs },
  errorText: { ...typography.subhead, color: colors.error },
  muted: { ...typography.subhead, color: colors.onSurfaceVariant },
  list: { gap: spacing.md, paddingTop: spacing.sm },
  row: {
    flexDirection: "row",
    backgroundColor: colors.surfaceContainerLow,
    borderRadius: radii.md,
    padding: spacing.sm,
    gap: spacing.md,
  },
  image: {
    width: 60,
    height: 60,
    borderRadius: radii.sm,
    backgroundColor: colors.surfaceContainerHigh,
  },
  imagePlaceholder: { alignItems: "center", justifyContent: "center" },
  body: { flex: 1, gap: 2 },
  name: { ...typography.subhead, color: colors.onSurface },
  price: { ...typography.subhead, color: colors.primary, fontWeight: "600" },
  linkBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    marginTop: spacing.xs,
  },
  linkBtnText: { ...typography.footnote, color: colors.primary, fontWeight: "600" },
  pressed: { opacity: 0.85 },
});

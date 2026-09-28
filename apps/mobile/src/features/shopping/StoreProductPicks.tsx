import React, { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import type { StoreProduct } from "@cooking/api-client";
import { WEEE_STORE_LABEL, getWeeeProductDisplayName, isSafeWeeeProductUrl } from "@cooking/shared";
import { Button } from "../../components";
import { colors, radii, spacing, typography } from "../../theme";

export type StoreProductPicksProps = {
  loading: boolean;
  error: string | null;
  products: StoreProduct[] | undefined;
  selectedUrl?: string;
  selectionEnabled?: boolean;
  onSelect?: (productUrl: string) => void;
  onRetry: () => void;
};

export function StoreProductPicks({
  loading,
  error,
  products,
  selectedUrl,
  selectionEnabled = true,
  onSelect = () => {},
  onRetry,
}: StoreProductPicksProps) {
  const [failedLinkUrl, setFailedLinkUrl] = useState<string | null>(null);
  const linkAttemptRef = useRef(0);

  useEffect(() => () => {
    linkAttemptRef.current += 1;
  }, []);

  const openProduct = (productUrl: string) => {
    const attempt = linkAttemptRef.current + 1;
    linkAttemptRef.current = attempt;
    setFailedLinkUrl(null);
    void Linking.openURL(productUrl).then(
      () => {
        if (linkAttemptRef.current === attempt) setFailedLinkUrl(null);
      },
      () => {
        if (linkAttemptRef.current === attempt) setFailedLinkUrl(productUrl);
      },
    );
  };

  const matchingState = (
    <View style={styles.center}>
      <ActivityIndicator color={colors.primary} />
      <Text style={styles.muted}>Finding matches on {WEEE_STORE_LABEL}…</Text>
    </View>
  );

  if (loading) return matchingState;
  if (error) {
    return (
      <View style={styles.errorWrap}>
        <Text style={styles.errorText}>{error}</Text>
        <Button title="Retry" onPress={onRetry} variant="ghost" />
      </View>
    );
  }
  if (products === undefined) return matchingState;
  if (products.length === 0) {
    return (
      <View style={styles.errorWrap}>
        <Text style={styles.muted}>No products found.</Text>
        <Button title="Retry" onPress={onRetry} variant="ghost" />
      </View>
    );
  }
  const safeProducts = products
    .filter((product) => isSafeWeeeProductUrl(product.url))
    .slice(0, 3);
  if (safeProducts.length === 0) {
    return (
      <View style={styles.errorWrap}>
        <Text style={styles.errorText}>We couldn't verify these Weee links.</Text>
        <Button title="Retry" onPress={onRetry} variant="ghost" />
      </View>
    );
  }
  const effectiveSelectedUrl = safeProducts.some((product) => product.url === selectedUrl)
    ? selectedUrl
    : safeProducts[0].url;
  return (
    <View style={styles.list}>
      {safeProducts.map((product, index) => {
        const displayName = getWeeeProductDisplayName(product.name);
        const selected = selectionEnabled && product.url === effectiveSelectedUrl;
        return (
          <View
            key={`${product.url}-${product.name}`}
            style={[styles.row, selected && styles.rowSelected]}
          >
            {product.image ? (
              <Image source={{ uri: product.image }} style={styles.image} contentFit="cover" />
            ) : (
              <View style={[styles.image, styles.imagePlaceholder]}>
                <Ionicons name="cube-outline" size={20} color={colors.onSurfaceVariant} />
              </View>
            )}
            <View style={styles.body}>
              <View style={styles.nameLine}>
                <Text style={styles.name} numberOfLines={2}>
                  {displayName}
                </Text>
                {selectionEnabled && index === 0 ? <Text style={styles.topPick}>Top pick</Text> : null}
              </View>
              <Text style={styles.price}>{product.price}</Text>
              {selectionEnabled ? (
                <Pressable
                  onPress={() => {
                    onSelect(product.url);
                  }}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  accessibilityLabel={selected
                    ? `${displayName}: Selected for cart`
                    : `Choose ${displayName} for cart`}
                  style={({ pressed }) => [
                    styles.selectBtn,
                    pressed && styles.pressed,
                  ]}
                >
                  <Ionicons
                    name={selected ? "radio-button-on" : "radio-button-off"}
                    size={17}
                    color={selected ? colors.primary : colors.onSurfaceVariant}
                  />
                  <Text style={[styles.selectBtnText, selected && styles.selectBtnTextSelected]}>
                    {selected ? "Selected for cart" : "Choose for cart"}
                  </Text>
                </Pressable>
              ) : null}
              <Pressable
                onPress={() => {
                  openProduct(product.url);
                }}
                accessibilityRole="link"
                accessibilityLabel={`View ${displayName} on ${WEEE_STORE_LABEL}`}
                style={({ pressed }) => [styles.linkBtn, pressed && styles.pressed]}
              >
                <Text style={styles.linkBtnText}>View on {WEEE_STORE_LABEL}</Text>
                <Ionicons name="open-outline" size={14} color={colors.primary} />
              </Pressable>
              {failedLinkUrl === product.url ? (
                <Text accessibilityRole="alert" style={styles.linkError}>
                  Couldn't open Weee. Tap the product link to try again.
                </Text>
              ) : null}
            </View>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  center: { paddingVertical: spacing.lg, alignItems: "center", gap: spacing.sm },
  errorWrap: { paddingVertical: spacing.md, alignItems: "flex-start", gap: spacing.xs },
  errorText: { ...typography.subhead, color: colors.error },
  muted: { ...typography.subhead, color: colors.onSurfaceVariant },
  list: { gap: spacing.sm, paddingTop: spacing.sm },
  row: {
    flexDirection: "row",
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    padding: spacing.md,
    gap: spacing.md,
    borderWidth: 1,
    borderColor: colors.divider,
  },
  rowSelected: {
    borderColor: colors.terracotta,
    backgroundColor: colors.subtleSurface,
  },
  image: {
    width: 68,
    height: 68,
    borderRadius: radii.md,
    backgroundColor: colors.surfaceContainerHigh,
  },
  imagePlaceholder: { alignItems: "center", justifyContent: "center" },
  body: { flex: 1, gap: spacing.xs },
  nameLine: { flexDirection: "column", alignItems: "flex-start", gap: spacing.xs },
  name: { ...typography.callout, color: colors.onSurface, maxWidth: "100%" },
  topPick: {
    ...typography.caption,
    color: colors.primary,
    fontWeight: "700",
  },
  price: { ...typography.subhead, color: colors.ink, fontFamily: "Inter_600SemiBold" },
  selectBtn: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    marginTop: spacing.xs,
  },
  selectBtnText: { ...typography.subhead, color: colors.onSurfaceVariant, fontFamily: "Inter_600SemiBold" },
  selectBtnTextSelected: { color: colors.primary },
  linkBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    minHeight: 44,
  },
  linkBtnText: { ...typography.subhead, color: colors.primary, fontFamily: "Inter_600SemiBold" },
  linkError: { ...typography.footnote, color: colors.error },
  pressed: { opacity: 0.85 },
});

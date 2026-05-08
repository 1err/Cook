import React, { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import type { CompositeScreenProps } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { BottomTabScreenProps } from "@react-navigation/bottom-tabs";
import {
  GROCERY_CATEGORY_ORDER,
  type GroceryCategory,
  getPrevNextWeek,
  getWeekBounds,
  normalizeGroceryCategory,
  PRODUCT_STORES,
  PRODUCT_STORE_LABELS,
  type ProductStore,
} from "@cooking/shared";
import { Button, Card, EmptyState } from "../../components";
import { colors, spacing, typography } from "../../theme";
import type {
  MainTabsParamList,
  RootStackParamList,
  ShoppingStackParamList,
} from "../../navigation/types";
import { WeekHeader } from "../_shared/WeekHeader";
import { useSmartShoppingList } from "./useSmartShoppingList";
import { useStoreProductsCache } from "./useStoreProductsCache";
import { PlannedMealsPreview } from "./PlannedMealsPreview";
import { PrepareListCta } from "./PrepareListCta";
import { SmartListCard } from "./SmartListCard";
import type { PurchaseItem } from "./storage";

type Props = CompositeScreenProps<
  NativeStackScreenProps<ShoppingStackParamList, "ShoppingList">,
  CompositeScreenProps<
    BottomTabScreenProps<MainTabsParamList, "Shopping">,
    NativeStackScreenProps<RootStackParamList>
  >
>;

export function ShoppingListScreen({ navigation, route }: Props) {
  const weekStart = route.params?.weekStart;
  const { state, refresh, prepareSmartList, backToOriginal, toggleChecked, hideItem } =
    useSmartShoppingList(weekStart);
  const ready = state.status === "ready";
  const activeWeekStart = ready ? state.bounds.start : null;
  const refinedActive = ready && state.data.refinedData != null;
  const productsCache = useStoreProductsCache(refinedActive ? activeWeekStart : null);
  const [refreshing, setRefreshing] = useState(false);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      refresh();
      // Wait briefly so the spinner shows; the underlying load is fired by the reducer.
      await new Promise((resolve) => setTimeout(resolve, 300));
    } finally {
      setRefreshing(false);
    }
  }, [refresh]);

  const setWeek = useCallback(
    (target: string) => navigation.setParams({ weekStart: target }),
    [navigation],
  );

  const handleOpenRecipe = useCallback(
    (recipeId: string) => {
      navigation.navigate("Library", { screen: "RecipeDetail", params: { recipeId } });
    },
    [navigation],
  );

  const today = useMemo(() => getWeekBounds(undefined).weekParam, []);

  if (state.status === "loading") {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  if (state.status === "error") {
    return (
      <View style={styles.center}>
        <EmptyState
          icon="alert-circle-outline"
          title="Couldn't load shopping list"
          description={state.error}
          actionLabel="Try again"
          onAction={refresh}
        />
      </View>
    );
  }

  const { bounds, data, refining, refineError } = state;
  const { prev, next } = getPrevNextWeek(bounds.start);
  const visibleRows = data.refinedData
    ? data.refinedData.purchase_items
        .map((item, origIndex) => ({ item, origIndex }))
        .filter(({ origIndex }) => !data.hidden.has(origIndex))
    : [];

  const purchaseByCategory = new Map<GroceryCategory, { item: PurchaseItem; origIndex: number }[]>();
  for (const row of visibleRows) {
    const cat = normalizeGroceryCategory(row.item.category, row.item.name);
    if (!purchaseByCategory.has(cat)) purchaseByCategory.set(cat, []);
    purchaseByCategory.get(cat)!.push(row);
  }

  const bulkLoadableNames = visibleRows
    .filter(({ origIndex }) => !data.checked.has(origIndex))
    .map(({ item }) => item.name)
    .filter((name) => name && name.trim().length > 0);
  const bulk = productsCache.bulkLoading;
  const storeLabel = PRODUCT_STORE_LABELS[productsCache.store];
  const bulkLabel = bulk.active
    ? `Loading store matches… ${bulk.done} of ${bulk.total}`
    : `Load top picks from ${storeLabel}`;

  return (
    <ScrollView
      style={styles.flex}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={colors.primary} />
      }
    >
      <WeekHeader
        start={bounds.start}
        end={bounds.end}
        isCurrentWeek={bounds.weekParam === today}
        onPrev={() => setWeek(prev)}
        onNext={() => setWeek(next)}
        onToday={() => setWeek(today)}
        kicker="Shopping for"
      />

      {!data.refinedData ? (
        <>
          <PlannedMealsPreview
            weekStart={bounds.start}
            mealPlans={data.mealPlans}
            recipeById={data.recipeById}
            onOpenRecipe={handleOpenRecipe}
          />
          <PrepareListCta
            itemCount={data.items.length}
            refining={refining}
            error={refineError}
            onPrepare={() => void prepareSmartList()}
          />
        </>
      ) : (
        <View>
          <View style={styles.smartHeader}>
            <Text style={styles.smartHeaderTitle}>Smart mode</Text>
            <Button
              title="Back to original"
              variant="ghost"
              onPress={() => void backToOriginal()}
            />
          </View>

          <View style={styles.storeToggleRow}>
            {PRODUCT_STORES.map((s: ProductStore) => {
              const active = s === productsCache.store;
              return (
                <Pressable
                  key={s}
                  onPress={() => productsCache.setStore(s)}
                  style={({ pressed }) => [
                    styles.storeChip,
                    active && styles.storeChipActive,
                    pressed && styles.pressed,
                  ]}
                >
                  <Text style={[styles.storeChipLabel, active && styles.storeChipLabelActive]}>
                    {PRODUCT_STORE_LABELS[s]}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {bulkLoadableNames.length > 0 ? (
            <View style={styles.bulkLoadRow}>
              <Button
                title={bulkLabel}
                onPress={() => {
                  productsCache.openMany(bulkLoadableNames);
                  void productsCache.loadAll(bulkLoadableNames);
                }}
                loading={bulk.active}
                disabled={bulk.active}
                fullWidth
              />
            </View>
          ) : null}

          {data.smartListStale ? (
            <Card style={styles.staleBanner}>
              <Text style={styles.staleTitle}>Planner changed</Text>
              <Text style={styles.staleBody}>
                You've updated your meals since this list was prepared. Refresh to get the latest
                groceries.
              </Text>
              {/* Refresh resets _ui.{hidden,checked} per web behavior — old check marks are cleared. */}
              <View style={styles.staleAction}>
                <Button
                  title={refining ? "Refreshing…" : "Refresh smart list"}
                  onPress={() => void prepareSmartList()}
                  loading={refining}
                  fullWidth
                />
                {refineError ? <Text style={styles.errorText}>{refineError}</Text> : null}
              </View>
            </Card>
          ) : null}

          {GROCERY_CATEGORY_ORDER.map((cat) => {
            const rows = purchaseByCategory.get(cat) ?? [];
            if (rows.length === 0) return null;
            return (
              <SmartListCard
                key={cat}
                category={cat}
                rows={rows}
                checked={data.checked}
                store={productsCache.store}
                productsOpenByName={productsCache.open}
                productsByName={productsCache.products}
                productsLoadingByName={productsCache.loading}
                productsErrorByName={productsCache.errors}
                onToggleChecked={(origIndex) => toggleChecked(origIndex)}
                onHide={(origIndex) => hideItem(origIndex)}
                onTogglePanel={(name) => void productsCache.togglePanel(name)}
                onRetryProducts={(name) => void productsCache.retry(name)}
              />
            );
          })}

          {visibleRows.length === 0 ? (
            <View style={styles.emptyAfter}>
              <EmptyState
                icon="checkmark-circle-outline"
                title="Nothing left"
                description="All items hidden. Refresh or go back to the original list."
                actionLabel="Back to original"
                onAction={() => void backToOriginal()}
              />
            </View>
          ) : null}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
  content: { paddingBottom: spacing["2xl"] },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.background,
  },
  smartHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.sm,
  },
  smartHeaderTitle: { ...typography.title3, color: colors.onSurface },
  storeToggleRow: {
    flexDirection: "row",
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.md,
  },
  storeChip: {
    flex: 1,
    paddingVertical: spacing.sm,
    borderRadius: 999,
    backgroundColor: colors.surfaceContainer,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "transparent",
  },
  storeChipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  storeChipLabel: { ...typography.subhead, color: colors.onSurfaceVariant, fontWeight: "600" },
  storeChipLabelActive: { color: colors.onPrimary },
  bulkLoadRow: {
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.md,
  },
  staleBanner: {
    marginHorizontal: spacing.lg,
    marginBottom: spacing.md,
    backgroundColor: colors.errorContainer,
  },
  staleTitle: { ...typography.headline, color: colors.error, marginBottom: spacing.xs },
  staleBody: { ...typography.subhead, color: colors.onSurface, marginBottom: spacing.md },
  staleAction: { gap: spacing.xs },
  errorText: { ...typography.caption, color: colors.error },
  emptyAfter: { paddingHorizontal: spacing.lg, paddingTop: spacing.lg },
  pressed: { opacity: 0.85 },
});

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Linking,
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
  buildInstacartItems,
  GROCERY_CATEGORY_ORDER,
  isSafeWeeeProductUrl,
  type GroceryCategory,
  type CartAssistantDraft,
  getPrevNextWeek,
  getWeekBounds,
  normalizeGroceryCategory,
  WEEE_STORE_LABEL,
} from "@cooking/shared";
import type { StoreProduct } from "@cooking/api-client";
import { Button, Card, EmptyState } from "../../components";
import { colors, spacing, typography } from "../../theme";
import type {
  MainTabsParamList,
  RootStackParamList,
  ShoppingStackParamList,
} from "../../navigation/types";
import { WeekHeader } from "../_shared/WeekHeader";
import {
  useSmartShoppingList,
  type SmartListMutationResult,
} from "./useSmartShoppingList";
import { useStoreProductsCache } from "./useStoreProductsCache";
import { PlannedMealsPreview } from "./PlannedMealsPreview";
import { PrepareListCta } from "./PrepareListCta";
import { SmartListCard } from "./SmartListCard";
import type { PurchaseItem, RefineResponse } from "./storage";
import {
  CartAssistantModal,
  getCurrentCartAssistantSelection,
} from "./CartAssistantModal";
import {
  useCartAssistant,
  type MobileCartAssistantIngredient,
} from "./useCartAssistant";
import { canonicalStoreProductKey } from "./storeProductIdentity";
import { useT } from "../../lib/i18n";
import { BasicShoppingList, basicShoppingItemKey } from "./BasicShoppingList";
import { InstacartShoppingPanel } from "./InstacartShoppingPanel";

type Props = CompositeScreenProps<
  NativeStackScreenProps<ShoppingStackParamList, "ShoppingList">,
  CompositeScreenProps<
    BottomTabScreenProps<MainTabsParamList, "Shopping">,
    NativeStackScreenProps<RootStackParamList>
  >
>;

type ProductAuthority = {
  hydrated: boolean;
  products: Record<string, StoreProduct[]>;
  loading: Record<string, boolean>;
  errors: Record<string, string | null>;
};

const WEEE_HOME_URL = "https://www.sayweee.com/";
const hasOwn = (record: object, key: string) => Object.prototype.hasOwnProperty.call(record, key);

export function buildMobileCartIngredients(
  refinedData: RefineResponse | null,
  hidden: ReadonlySet<number>,
  checked: ReadonlySet<number>,
  productAuthority: ProductAuthority,
): MobileCartAssistantIngredient[] | null {
  if (!refinedData || !productAuthority.hydrated) return null;

  const seen = new Set<string>();
  const ingredients: MobileCartAssistantIngredient[] = [];
  refinedData.purchase_items.forEach((item, index) => {
    if (hidden.has(index) || checked.has(index)) return;
    const key = canonicalStoreProductKey(item.name);
    if (!key || seen.has(key)) return;
    seen.add(key);
    const hasProductError = typeof productAuthority.errors[key] === "string";
    const products = hasProductError ? [] : productAuthority.products[key] ?? [];
    const productsPending = productAuthority.loading[key] === true;
    const productsSettled = !productAuthority.loading[key] && (
      hasOwn(productAuthority.products, key) || hasProductError
    );
    ingredients.push({
      key,
      name: item.name,
      suggestedPurchase: item.suggested_purchase,
      products,
      productsSettled,
      productsPending,
    });
  });
  return ingredients;
}

export async function openCurrentCartProduct({
  draft,
  skippedTokens,
  confirmationToken,
  productUrl,
  openUrl,
}: {
  draft: CartAssistantDraft;
  skippedTokens: ReadonlySet<string>;
  confirmationToken: string;
  productUrl: string;
  openUrl: (url: string) => Promise<unknown>;
}): Promise<boolean> {
  const current = getCurrentCartAssistantSelection(draft, skippedTokens);
  if (
    !current
    || current.confirmationToken !== confirmationToken
    || current.product.url !== productUrl
    || !isSafeWeeeProductUrl(productUrl)
  ) {
    return false;
  }

  try {
    await openUrl(productUrl);
    return true;
  } catch {
    return false;
  }
}

export function ShoppingListScreen({ navigation, route }: Props) {
  const t = useT();
  const weekStart = route.params?.weekStart;
  const { state, refresh, prepareSmartList, backToOriginal, toggleChecked, hideItem } =
    useSmartShoppingList(weekStart);
  const ready = state.status === "ready";
  const activeWeekStart = ready ? state.bounds.start : null;
  const refinedActive = ready && state.data.refinedData != null;
  const productsCache = useStoreProductsCache(refinedActive ? activeWeekStart : null);
  const cartIngredients = useMemo(() => {
    if (state.status !== "ready") return null;
    return buildMobileCartIngredients(
      state.data.refinedData,
      state.data.hidden,
      state.data.checked,
      productsCache,
    );
  }, [
    productsCache.errors,
    productsCache.hydrated,
    productsCache.loading,
    productsCache.products,
    state,
  ]);
  const cartAssistant = useCartAssistant(state.bounds.start, cartIngredients);
  const [refreshing, setRefreshing] = useState(false);
  const [cartReviewOpen, setCartReviewOpen] = useState(false);
  const [skippedTokens, setSkippedTokens] = useState<Set<string>>(new Set());
  const requestedWeekStart = useMemo(() => getWeekBounds(weekStart).start, [weekStart]);
  const [basicChecks, setBasicChecks] = useState<{ week: string; keys: Set<string> }>({ week: requestedWeekStart, keys: new Set() });
  const basicChecked = basicChecks.week === requestedWeekStart ? basicChecks.keys : new Set<string>();
  const activeRouteWeekRef = useRef(requestedWeekStart);
  activeRouteWeekRef.current = requestedWeekStart;
  const previousWeekRef = useRef(requestedWeekStart);

  const closeCartReview = useCallback(() => {
    setCartReviewOpen(false);
    setSkippedTokens(new Set());
  }, []);

  useEffect(() => {
    if (previousWeekRef.current !== requestedWeekStart) closeCartReview();
    previousWeekRef.current = requestedWeekStart;
  }, [closeCartReview, requestedWeekStart]);

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

  const resetAfterSuccessfulMutation = useCallback((result: SmartListMutationResult) => {
    if (
      result.status !== "succeeded"
      || activeRouteWeekRef.current !== result.weekStart
    ) {
      return;
    }
    productsCache.resetLive();
    cartAssistant.reset();
    closeCartReview();
  }, [cartAssistant.reset, closeCartReview, productsCache.resetLive]);

  const handlePrepareSmartList = useCallback(async () => {
    try {
      resetAfterSuccessfulMutation(await prepareSmartList());
    } catch {
      // Hook mutations return failures, but an unexpected rejection still preserves live state.
    }
  }, [prepareSmartList, resetAfterSuccessfulMutation]);

  const handleBackToOriginal = useCallback(async () => {
    try {
      resetAfterSuccessfulMutation(await backToOriginal());
    } catch {
      // Preserve product/cart state when the original-list transition did not complete.
    }
  }, [backToOriginal, resetAfterSuccessfulMutation]);

  const handleOpenCartProduct = useCallback(
    (confirmationToken: string, productUrl: string) => openCurrentCartProduct({
      draft: cartAssistant.draft,
      skippedTokens,
      confirmationToken,
      productUrl,
      openUrl: (url) => Linking.openURL(url),
    }),
    [cartAssistant.draft, skippedTokens],
  );

  const handleConfirm = useCallback((confirmationToken: string) => {
    const current = getCurrentCartAssistantSelection(cartAssistant.draft, skippedTokens);
    if (current?.confirmationToken !== confirmationToken) return;
    cartAssistant.confirm(confirmationToken);
  }, [cartAssistant, skippedTokens]);

  const handleUndoConfirm = useCallback((confirmationToken: string) => {
    setSkippedTokens((tokens) => {
      if (!tokens.has(confirmationToken)) return tokens;
      const next = new Set(tokens);
      next.delete(confirmationToken);
      return next;
    });
    cartAssistant.undoConfirm(confirmationToken);
  }, [cartAssistant]);

  const handleSkip = useCallback((confirmationToken: string) => {
    const current = getCurrentCartAssistantSelection(cartAssistant.draft, skippedTokens);
    if (current?.confirmationToken !== confirmationToken) return;
    setSkippedTokens((tokens) => new Set(tokens).add(confirmationToken));
  }, [cartAssistant.draft, skippedTokens]);

  const handleOpenFinalReview = useCallback(async () => {
    try {
      await Linking.openURL(WEEE_HOME_URL);
      return true;
    } catch {
      return false;
    }
  }, []);

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
  const bulkLabel = bulk.active
    ? `Loading store matches… ${bulk.done} of ${bulk.total}`
    : `Load top picks from ${WEEE_STORE_LABEL}`;

  return (
    <>
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

      <InstacartShoppingPanel
        items={buildInstacartItems({
          originalItems: data.items.filter(item => !basicChecked.has(basicShoppingItemKey(item))),
          purchaseItems: data.refinedData?.purchase_items,
          hidden: data.hidden,
          checked: data.checked,
        })}
        listKey={JSON.stringify([
          requestedWeekStart,
          bounds.start,
          data.refinedData ? "smart" : "original",
          data.savedFingerprint,
        ])}
        disabled={refining || (data.refinedData != null && data.smartListStale)
          || requestedWeekStart !== bounds.start}
      />

      {!data.refinedData ? (
        <>
          <BasicShoppingList key={bounds.start} items={data.items} checked={basicChecked} onToggle={key => {
            setBasicChecks(current => {
              const keys = new Set(current.week === requestedWeekStart ? current.keys : []);
              if (keys.has(key)) keys.delete(key); else keys.add(key);
              return { week: requestedWeekStart, keys };
            });
          }} />
          {data.previewUnavailable ? <Text accessibilityRole="alert">{t("shopping.previewUnavailable")}</Text> : null}
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
            onPrepare={() => void handlePrepareSmartList()}
          />
        </>
      ) : (
        <View>
          <View style={styles.smartHeader}>
            <Text style={styles.smartHeaderTitle}>Smart mode</Text>
            <Button
              title="Back to original"
              variant="ghost"
              onPress={() => void handleBackToOriginal()}
            />
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

          {cartAssistant.draft.summary.readyCount > 0 ? (
            <View style={styles.cartReviewRow}>
              <Button
                title={`Review Weee cart · ${cartAssistant.draft.summary.readyCount}`}
                onPress={() => {
                  setSkippedTokens(new Set());
                  setCartReviewOpen(true);
                }}
                variant="secondary"
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
                  onPress={() => void handlePrepareSmartList()}
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
                productsOpenByName={productsCache.open}
                productsByName={productsCache.products}
                productsLoadingByName={productsCache.loading}
                productsErrorByName={productsCache.errors}
                selectedUrlByIngredient={cartAssistant.selectedUrlByIngredient}
                onToggleChecked={(origIndex) => toggleChecked(origIndex)}
                onHide={(origIndex) => hideItem(origIndex)}
                onTogglePanel={(name) => void productsCache.togglePanel(name)}
                onRetryProducts={(name) => void productsCache.retry(name)}
                onSelectProduct={cartAssistant.select}
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
                onAction={() => void handleBackToOriginal()}
              />
            </View>
          ) : null}
        </View>
      )}
      </ScrollView>
      <CartAssistantModal
        visible={cartReviewOpen}
        draft={cartAssistant.draft}
        skippedTokens={skippedTokens}
        onClose={closeCartReview}
        onOpenProduct={handleOpenCartProduct}
        onConfirm={handleConfirm}
        onUndoConfirm={handleUndoConfirm}
        onSkip={handleSkip}
        onFindMatch={(ingredientKey) => {
          const row = state.status === "ready"
            ? state.data.refinedData?.purchase_items.find(
                (item) => canonicalStoreProductKey(item.name) === ingredientKey,
              )
            : undefined;
          if (row) {
            productsCache.openMany([row.name]);
            void productsCache.retry(row.name);
          }
          closeCartReview();
        }}
        onOpenFinalReview={handleOpenFinalReview}
      />
    </>
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
  bulkLoadRow: {
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.md,
  },
  cartReviewRow: {
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

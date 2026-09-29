"use client";

import { trackEvent } from "../lib/analytics";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import type { StoreProductsBatchResponse, StoreProductsResponse } from "@cooking/api-client";
import { ApiError, normalizeStoreProductResponse, resolveRecipeDetails } from "@cooking/api-client";
import { apiFetch } from "../lib/api";
import { getAuthGeneration, userLocalStorage, userSessionStorage } from "../lib/userStorage";
import { RequireAuth } from "../components/RequireAuth";
import { PageHeader, PageShell } from "../components/PageShell";
import { useI18n, useT } from "../lib/i18n";
import { useEditorialCopy } from "../lib/editorialCopy";
import type { Recipe } from "../types";
import {
  GROCERY_CATEGORY_ORDER,
  SHOPPING_QUANTITY_VERSION,
  shoppingRefineInputs,
  buildCartAssistantDraft,
  buildWeekMealPlanFingerprint,
  normalizeMealPlanSlots,
  formatWeekRangeDisplay,
  getDisplayCategory,
  getPrevNextWeek,
  getWeekBounds,
  normalizeGroceryCategory,
  plannerFingerprintStorageKey,
  isSafeWeeeProductUrl,
  type CartAssistantIngredient,
  type GroceryCategory,
  type MealPlanDay,
  type ShoppingListItem,
} from "@cooking/shared";
import { ShoppingCategorySection } from "./ShoppingCategorySection";
import { ShoppingSmartBar } from "./ShoppingSmartBar";
import { CartAssistantDialog } from "./CartAssistantDialog";
import { MuseShoppingDialog } from "./MuseShoppingDialog";
import styles from "./ShoppingList.module.css";
import {
  buildVisualProductQueue,
  type ProductLookupState,
} from "./productLoading";
import {
  buildProductLookupStorage,
  canonicalIngredientKey,
  cleanIngredientQuery,
  createProductLookupCoordinator,
  parseStoreProductsResponse,
  parseProductLookupStorage,
} from "./productLookupCoordinator";
import {
  cartAssistantStorageKey,
  parseCartAssistantStored,
} from "./cartAssistantStorage";
import {
  buildPlannedMealRows,
  formatMealOccurrence,
  formatPlannedMealSchedule,
} from "./plannedMeals";

const SMART_SHOPPING_LIST_PREFIX = "smartShoppingList";
const SMART_SHOPPING_PRODUCTS_PREFIX = "smartShoppingProducts";
const MAX_SAFE_TIMER_DELAY_MS = 2_147_483_647;

function smartListStorageKey(weekStart: string) {
  return `${SMART_SHOPPING_LIST_PREFIX}:${weekStart}`;
}

function smartProductsStorageKey(weekStart: string) {
  return `${SMART_SHOPPING_PRODUCTS_PREFIX}:${weekStart}:weee`;
}

function writeSessionStorage(key: string, value: string) {
  try {
    userSessionStorage.setItem(key, value);
    return true;
  } catch {
    // Ephemeral cache writes are best effort; quota/privacy failures must not break shopping.
    return false;
  }
}

function removeSessionStorage(key: string) {
  try {
    userSessionStorage.removeItem(key);
    return true;
  } catch {
    // Keep React state usable when privacy settings deny ephemeral storage access.
    return false;
  }
}

const suppressedCartHydrationKeys = new Set<string>();

const PREVIEW_MEAL_ROWS = 4;

interface PurchaseItem {
  name: string;
  suggested_purchase: string;
  category?: string;
}

interface RefineResponse {
  remove: string[];
  likely_pantry: { name: string; reason: string }[];
  purchase_items: PurchaseItem[];
  // Client cache marker: old lists remain usable, but need fresh backend totals.
  _quantityVersion?: number;
  refinement_status?: "refined" | "fallback";
}

interface SmartStored extends RefineResponse {
  _ui?: { hidden: number[]; checked: number[] };
  _plannerFingerprint?: string;
}

async function loadProduct(
  key: string,
  signal?: AbortSignal,
): Promise<StoreProductsResponse> {
  const requestStartedAtMs = Date.now();
  const res = await apiFetch(`/store-products?query=${encodeURIComponent(key)}`, {
    signal,
  });
  if (!res.ok) throw new Error("Failed to load products");
  const data = (await res.json()) as StoreProductsResponse;
  return parseStoreProductsResponse(normalizeStoreProductResponse(data, requestStartedAtMs));
}

async function loadProductBatch(
  queries: string[],
  signal?: AbortSignal,
): Promise<StoreProductsBatchResponse> {
  const requestStartedAtMs = Date.now();
  const res = await apiFetch("/store-products/batch", {
    method: "POST",
    body: JSON.stringify({ queries }),
    signal,
  });
  if (!res.ok) throw new Error("Failed to load cached products");
  return normalizeStoreProductResponse(
    (await res.json()) as StoreProductsBatchResponse,
    requestStartedAtMs,
  );
}

function isRefineResponse(data: RefineResponse | null): data is RefineResponse {
  return !!data && Array.isArray(data.purchase_items)
    && data.purchase_items.every(item => item && typeof item.name === "string"
      && !!item.name.trim() && typeof item.suggested_purchase === "string"
      && (item.category == null || typeof item.category === "string"))
    && Array.isArray(data.remove) && data.remove.every(name => typeof name === "string")
    && Array.isArray(data.likely_pantry);
}

function parseSmartStored(
  raw: string
): { data: RefineResponse; hidden: Set<number>; checked: Set<number>; plannerFingerprint: string | null } | null {
  try {
    const parsed = JSON.parse(raw) as SmartStored;
    if (!isRefineResponse(parsed)) return null;
    const { _ui, _plannerFingerprint, ...data } = parsed;
    if (!Array.isArray(data.likely_pantry) || !Array.isArray(data.remove)) return null;
    return {
      data: data as RefineResponse,
      hidden: new Set(_ui?.hidden ?? []),
      checked: new Set(_ui?.checked ?? []),
      plannerFingerprint: typeof _plannerFingerprint === "string" ? _plannerFingerprint : null,
    };
  } catch {
    return null;
  }
}

function confirmationIngredientKey(token: string): string | null {
  try {
    const parsed: unknown = JSON.parse(token);
    if (
      Array.isArray(parsed)
      && parsed.length === 2
      && typeof parsed[0] === "string"
      && typeof parsed[1] === "string"
    ) {
      return parsed[0];
    }
  } catch {
    // Ignore malformed progress tokens from ephemeral storage.
  }
  return null;
}

function ShoppingListPageContent() {
  const router = useRouter();
  const { language } = useI18n();
  const editorialCopy = useEditorialCopy();
  const t = useT();
  const searchParams = useSearchParams();
  const weekParam = searchParams.get("week");
  const weekBounds = useMemo(() => getWeekBounds(weekParam), [weekParam]);
  const { start, end, dates: weekDates, weekParam: currentWeek } = weekBounds;
  const { prev, next } = getPrevNextWeek(currentWeek);

  const [items, setItems] = useState<ShoppingListItem[]>([]);
  const [mealPlans, setMealPlans] = useState<MealPlanDay[]>([]);
  const [recipeById, setRecipeById] = useState<Record<string, Recipe>>({});
  const [planMealsExpanded, setPlanMealsExpanded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);
  const [previewUnavailable, setPreviewUnavailable] = useState(false);
  const [loadVersion, setLoadVersion] = useState(0);
  const [bulkLoadingProducts, setBulkLoadingProducts] = useState(false);
  const [bulkLoadProgress, setBulkLoadProgress] = useState<{ current: number; total: number } | null>(null);
  const [refinedData, setRefinedData] = useState<RefineResponse | null>(null);
  const [smartWeekStart, setSmartWeekStart] = useState<string | null>(null);
  const [savedPlannerFingerprint, setSavedPlannerFingerprint] = useState<string | null>(null);
  const [smartListStale, setSmartListStale] = useState(false);
  const [refining, setRefining] = useState(false);
  const [refineError, setRefineError] = useState<string | null>(null);
  const [smartRemovedCollapsed, setSmartRemovedCollapsed] = useState(true);
  const [smartHidden, setSmartHidden] = useState<Set<number>>(new Set());
  const [smartChecked, setSmartChecked] = useState<Set<number>>(new Set());
  const [menuOpenFor, setMenuOpenFor] = useState<number | null>(null);
  const [openProductsByIngredient, setOpenProductsByIngredient] = useState<Record<string, boolean>>({});
  const [lookupByIngredient, setLookupByIngredient] = useState<Record<string, ProductLookupState>>({});
  const [productQueryByKey, setProductQueryByKey] = useState<Record<string, string>>({});
  const [selectedUrlByIngredient, setSelectedUrlByIngredient] = useState<Record<string, string>>({});
  const [confirmedCartTokens, setConfirmedCartTokens] = useState<Set<string>>(new Set());
  const [skippedCartTokens, setSkippedCartTokens] = useState<Set<string>>(new Set());
  const [cartDialogOpen, setCartDialogOpen] = useState(false);
  const [museDialogOpen, setMuseDialogOpen] = useState(false);
  const [cartHydratedWeek, setCartHydratedWeek] = useState<string | null>(null);
  const [cartProductsHydratedWeek, setCartProductsHydratedWeek] = useState<string | null>(null);
  const cartLoadProductsRef = useRef<HTMLButtonElement>(null);
  const cartReviewTriggerRef = useRef<HTMLButtonElement>(null);
  const cartWasOpenRef = useRef(false);
  const activeWeekStartRef = useRef(start);
  activeWeekStartRef.current = start;
  const refineGenerationRef = useRef(0);
  const productLoadGenerationRef = useRef(0);
  const lookupByIngredientRef = useRef(lookupByIngredient);
  lookupByIngredientRef.current = lookupByIngredient;
  const productQueryByKeyRef = useRef(productQueryByKey);
  productQueryByKeyRef.current = productQueryByKey;
  const productExpiryTimersRef = useRef(
    new Map<
      string,
      {
        expiresAt: string;
        generation: number;
        timer: ReturnType<typeof setTimeout>;
      }
    >(),
  );
  const productLookupCoordinatorRef = useRef<ReturnType<
    typeof createProductLookupCoordinator
  > | null>(null);

  if (!productLookupCoordinatorRef.current) {
    productLookupCoordinatorRef.current = createProductLookupCoordinator({
      load: loadProduct,
      loadBatch: loadProductBatch,
      shouldPublish: (generation) => productLoadGenerationRef.current === generation,
      onState: (key, state) => {
        setLookupByIngredient((current) => ({ ...current, [key]: state }));
      },
    });
  }
  const productLookupCoordinator = productLookupCoordinatorRef.current;

  useEffect(() => {
    setCartDialogOpen(false);
    setMuseDialogOpen(false);
    setSkippedCartTokens(new Set());
    setSelectedUrlByIngredient({});
    setConfirmedCartTokens(new Set());
    setCartHydratedWeek(null);
    try {
      const key = cartAssistantStorageKey(start);
      const raw = suppressedCartHydrationKeys.has(key) ? null : userSessionStorage.getItem(key);
      if (raw) {
        const parsed = parseCartAssistantStored(JSON.parse(raw));
        setSelectedUrlByIngredient(parsed.selectedUrlByIngredient);
        setConfirmedCartTokens(new Set(parsed.confirmedTokens));
      }
    } catch {
      // Malformed or denied ephemeral storage must not block the live cart review.
    } finally {
      setCartHydratedWeek(start);
    }
  }, [start]);

  useEffect(() => {
    if (cartDialogOpen) {
      cartWasOpenRef.current = true;
      return;
    }
    if (!cartWasOpenRef.current) return;
    cartWasOpenRef.current = false;
    (cartReviewTriggerRef.current ?? cartLoadProductsRef.current)?.focus();
  }, [cartDialogOpen]);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (menuOpenFor === null) return;
      const target = e.target instanceof Element ? e.target : null;
      if (!target?.closest("[data-shopping-item-menu]")) setMenuOpenFor(null);
    }
    document.addEventListener("click", onDocClick);
    return () => document.removeEventListener("click", onDocClick);
  }, [menuOpenFor]);

  function clearProductResults() {
    const previousGeneration = productLoadGenerationRef.current;
    productLoadGenerationRef.current = previousGeneration + 1;
    productLookupCoordinator.cancelGeneration(previousGeneration);
    for (const entry of productExpiryTimersRef.current.values()) {
      clearTimeout(entry.timer);
    }
    productExpiryTimersRef.current.clear();
    setOpenProductsByIngredient({});
    setLookupByIngredient({});
    productQueryByKeyRef.current = {};
    setProductQueryByKey({});
    setBulkLoadingProducts(false);
    setBulkLoadProgress(null);
    setCartProductsHydratedWeek(null);
  }

  useEffect(() => {
    return () => {
      refineGenerationRef.current += 1;
      const previousGeneration = productLoadGenerationRef.current;
      productLoadGenerationRef.current = previousGeneration + 1;
      productLookupCoordinator.cancelGeneration(previousGeneration);
      for (const entry of productExpiryTimersRef.current.values()) {
        clearTimeout(entry.timer);
      }
      productExpiryTimersRef.current.clear();
    };
  }, [productLookupCoordinator]);

  useEffect(() => {
    const timers = productExpiryTimersRef.current;
    const activeSuccessKeys = new Set<string>();

    for (const [key, state] of Object.entries(lookupByIngredient)) {
      if (state.status !== "success" || !state.expiresAt) continue;
      activeSuccessKeys.add(key);
      const generation = productLoadGenerationRef.current;
      const existing = timers.get(key);
      if (
        existing?.expiresAt === state.expiresAt &&
        existing.generation === generation
      ) {
        continue;
      }
      if (existing) clearTimeout(existing.timer);

      const expiresAtMs = Date.parse(state.expiresAt);
      const fireAtExpiry = () => {
        const remaining = expiresAtMs - Date.now();
        if (remaining > 0) {
          const current = timers.get(key);
          if (!current || current.expiresAt !== state.expiresAt) return;
          current.timer = setTimeout(
            fireAtExpiry,
            Math.min(remaining, MAX_SAFE_TIMER_DELAY_MS),
          );
          return;
        }
        timers.delete(key);
        const current = lookupByIngredientRef.current[key];
        if (
          productLoadGenerationRef.current !== generation ||
          current?.status !== "success" ||
          current.expiresAt !== state.expiresAt
        ) {
          return;
        }
        void productLookupCoordinator.request(
          productQueryByKeyRef.current[key] ?? key,
          generation,
        );
      };
      const timer = setTimeout(
        fireAtExpiry,
        Math.min(Math.max(0, expiresAtMs - Date.now()), MAX_SAFE_TIMER_DELAY_MS),
      );
      timers.set(key, { expiresAt: state.expiresAt, generation, timer });
    }

    for (const [key, entry] of timers) {
      if (activeSuccessKeys.has(key)) continue;
      clearTimeout(entry.timer);
      timers.delete(key);
    }
  }, [lookupByIngredient, productLookupCoordinator]);

  const persistSmart = useCallback(
    (data: RefineResponse, hidden: Set<number>, checked: Set<number>, plannerFingerprint: string) => {
      const payload: SmartStored = {
        ...data,
        _ui: { hidden: [...hidden], checked: [...checked] },
        _plannerFingerprint: plannerFingerprint,
      };
      writeSessionStorage(smartListStorageKey(start), JSON.stringify(payload));
    },
    [start]
  );

  const clearStoredProductResults = useCallback(() => {
    removeSessionStorage(smartProductsStorageKey(start));
  }, [start]);

  const currentPlannerFingerprint = useMemo(
    () => buildWeekMealPlanFingerprint(weekDates, mealPlans),
    [weekDates, mealPlans]
  );
  const activeRefinedData = smartWeekStart === start ? refinedData : null;
  const activeSavedPlannerFingerprint = smartWeekStart === start ? savedPlannerFingerprint : null;
  const smartProgressRef = useRef({ data: activeRefinedData, hidden: smartHidden, checked: smartChecked });
  smartProgressRef.current = { data: activeRefinedData, hidden: smartHidden, checked: smartChecked };

  useEffect(() => { setCopied(false); setCopyError(null); }, [items, smartChecked, activeRefinedData]);

  useEffect(() => {
    let cancelled = false;
    refineGenerationRef.current += 1;
    setRefining(false);
    setRefineError(null);
    async function load() {
      setLoading(true);
      setItems([]);
      setPreviewUnavailable(false);
      setCopyError(null);
      setCopied(false);
      setMealPlans([]);
      setRecipeById({});
      setRefinedData(null);
      setSmartWeekStart(null);
      setSavedPlannerFingerprint(null);
      setSmartListStale(false);
      setSmartHidden(new Set());
      setSmartChecked(new Set());
      setMenuOpenFor(null);
      clearProductResults();
      setPlanMealsExpanded(false);
      setError(null);
      try {
        const [listRes, planRes] = await Promise.all([
          apiFetch(`/shopping-list?start=${start}&end=${end}`),
          apiFetch(`/meal-plan?start=${start}&end=${end}`).catch(() => null),
        ]);
        if (!listRes.ok) throw new Error("Failed to load");
        const data: ShoppingListItem[] = await listRes.json();
        if (cancelled) return;
        setItems(data);
        let plansPayload: MealPlanDay[] = [];
        let previewFailed = !planRes?.ok;
        if (planRes?.ok) {
          try {
            const pj = await planRes.json();
            if (Array.isArray(pj)) plansPayload = pj;
            else previewFailed = true;
          } catch { previewFailed = true; }
        }
        if (cancelled) return;
        setMealPlans(plansPayload);
        const latestFingerprint = buildWeekMealPlanFingerprint(weekDates, plansPayload);
        const recs = await resolveRecipeDetails(async id => {
          const response = await apiFetch(`/recipes/${encodeURIComponent(id)}`);
          if (!response.ok) throw new ApiError("Failed to load planned recipe", response.status);
          return response.json();
        }, plansPayload.flatMap(plan => Object.values(normalizeMealPlanSlots(plan)).flat())).catch(() => {
          previewFailed = true;
          return [];
        });
        if (cancelled) return;
        setPreviewUnavailable(previewFailed);
        const rmap = Object.fromEntries(recs.map(recipe => [recipe.id, recipe]));
        setRecipeById(rmap);
        try {
          const raw = userSessionStorage.getItem(smartListStorageKey(start));
          if (raw) {
            const parsed = parseSmartStored(raw);
            if (parsed) {
              setRefinedData(parsed.data);
              setSmartWeekStart(start);
              setSmartHidden(parsed.hidden);
              setSmartChecked(parsed.checked);
              setSavedPlannerFingerprint(parsed.plannerFingerprint);
              setSmartListStale(
                previewFailed || Boolean(parsed.plannerFingerprint && parsed.plannerFingerprint !== latestFingerprint)
              );
            }
          }
        } catch {
          // ignore bad session data
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [start, end, weekDates, loadVersion]);

  useEffect(() => {
    if (!activeRefinedData) return;
    persistSmart(
      activeRefinedData,
      smartHidden,
      smartChecked,
      activeSavedPlannerFingerprint ?? currentPlannerFingerprint
    );
  }, [activeRefinedData, activeSavedPlannerFingerprint, currentPlannerFingerprint, persistSmart, smartChecked, smartHidden]);

  useEffect(() => {
    if (!activeRefinedData) {
      clearProductResults();
      return;
    }
    try {
      const raw = userSessionStorage.getItem(smartProductsStorageKey(start));
      if (!raw) {
        clearProductResults();
        setCartProductsHydratedWeek(start);
        return;
      }
      const seedQueries: Record<string, string> = {};
      for (const { name } of activeRefinedData.purchase_items) {
        const query = cleanIngredientQuery(name);
        const key = canonicalIngredientKey(query);
        if (key && !seedQueries[key]) seedQueries[key] = query;
      }
      const parsed = parseProductLookupStorage(raw, Date.now(), seedQueries);
      if (!parsed) {
        clearProductResults();
        setCartProductsHydratedWeek(start);
        return;
      }
      productQueryByKeyRef.current = parsed.queries;
      setProductQueryByKey(parsed.queries);
      const generation = productLoadGenerationRef.current;
      productLookupCoordinator.seedQueries(parsed.queries, generation);
      setOpenProductsByIngredient(parsed.open);
      setLookupByIngredient(parsed.lookup);
      setBulkLoadingProducts(false);
      setBulkLoadProgress(null);
      for (const query of parsed.revalidate) {
        void productLookupCoordinator.request(query, generation);
      }
      setCartProductsHydratedWeek(start);
    } catch {
      clearProductResults();
      setCartProductsHydratedWeek(start);
    }
  }, [activeRefinedData, productLookupCoordinator, start]);

  useEffect(() => {
    if (!activeRefinedData) return;
    const payload = buildProductLookupStorage(
      openProductsByIngredient,
      lookupByIngredient,
      productQueryByKey,
    );
    writeSessionStorage(smartProductsStorageKey(start), JSON.stringify(payload));
  }, [activeRefinedData, lookupByIngredient, openProductsByIngredient, productQueryByKey, start]);

  useEffect(() => {
    if (!activeRefinedData || !activeSavedPlannerFingerprint) return;
    function syncSmartStaleState() {
      try {
        const latest = userLocalStorage.getItem(plannerFingerprintStorageKey(start)) ?? currentPlannerFingerprint;
        setSmartListStale(previewUnavailable || latest !== activeSavedPlannerFingerprint);
      } catch {
        setSmartListStale(previewUnavailable || currentPlannerFingerprint !== activeSavedPlannerFingerprint);
      }
    }
    function handleVisibilityChange() {
      if (document.visibilityState === "visible") syncSmartStaleState();
    }
    syncSmartStaleState();
    window.addEventListener("focus", syncSmartStaleState);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.removeEventListener("focus", syncSmartStaleState);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [activeRefinedData, activeSavedPlannerFingerprint, currentPlannerFingerprint, previewUnavailable, start]);

  function setWeek(week: string) {
    router.push(`/shopping-list?week=${week}`);
  }

  function clearConfirmationForIngredient(ingredientKey: string) {
    setConfirmedCartTokens((current) => {
      const next = new Set(
        [...current].filter((token) => confirmationIngredientKey(token) !== ingredientKey),
      );
      return next.size === current.size ? current : next;
    });
  }

  function closeCartDialog() {
    setCartDialogOpen(false);
    setSkippedCartTokens(new Set());
  }

  function clearCartAssistantState(removeStored: boolean) {
    closeCartDialog();
    setMuseDialogOpen(false);
    setSelectedUrlByIngredient({});
    setConfirmedCartTokens(new Set());
    if (removeStored) {
      const key = cartAssistantStorageKey(start);
      suppressedCartHydrationKeys.add(key);
      const tombstoned = writeSessionStorage(key, JSON.stringify({
        selectedUrlByIngredient: {},
        confirmedTokens: [],
      }));
      const removed = removeSessionStorage(key);
      if (tombstoned || removed) suppressedCartHydrationKeys.delete(key);
    }
  }

  function toggleSmartChecked(origIndex: number) {
    setSmartChecked((prev) => {
      const n = new Set(prev);
      if (n.has(origIndex)) n.delete(origIndex);
      else n.add(origIndex);
      return n;
    });
  }

  function hideSmartItem(origIndex: number) {
    setSmartHidden((prev) => new Set(prev).add(origIndex));
    setMenuOpenFor(null);
  }

  function handleSelectProduct(ingredientKey: string, productUrl: string) {
    if (!isSafeWeeeProductUrl(productUrl)) return;
    const ingredient = allCartIngredients.find((candidate) => candidate.key === ingredientKey);
    const safeProducts = ingredient?.products
      .filter((product) => isSafeWeeeProductUrl(product.url))
      .slice(0, 3) ?? [];
    if (!safeProducts.some((product) => product.url === productUrl)) return;
    const explicitUrl = selectedUrlByIngredient[ingredientKey];
    const effectiveUrl = safeProducts.some((product) => product.url === explicitUrl)
      ? explicitUrl
      : safeProducts[0]?.url;
    if (effectiveUrl === productUrl) return;
    clearConfirmationForIngredient(ingredientKey);
    setSelectedUrlByIngredient((current) => ({
      ...current,
      [ingredientKey]: productUrl,
    }));
  }

  const visiblePurchaseItems = useMemo(() => {
    if (!activeRefinedData) return [];
    return activeRefinedData.purchase_items
      .map((p, origIndex) => ({ ...p, origIndex }))
      .filter(({ origIndex }) => !smartHidden.has(origIndex))
      .sort((a, b) => (
        GROCERY_CATEGORY_ORDER.indexOf(normalizeGroceryCategory(a.category, a.name))
        - GROCERY_CATEGORY_ORDER.indexOf(normalizeGroceryCategory(b.category, b.name))
      ));
  }, [activeRefinedData, smartHidden]);

  const allCartIngredients = useMemo<CartAssistantIngredient[]>(() => {
    if (!activeRefinedData) return [];
    const seen = new Set<string>();
    const ingredients: CartAssistantIngredient[] = [];
    for (const item of activeRefinedData.purchase_items) {
      const key = canonicalIngredientKey(item.name);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      const state = lookupByIngredient[key];
      ingredients.push({
        key,
        name: item.name,
        suggestedPurchase: item.suggested_purchase,
        products: state?.status === "success" ? state.products ?? [] : [],
      });
    }
    return ingredients;
  }, [activeRefinedData, lookupByIngredient]);

  const activeCartIngredients = useMemo<CartAssistantIngredient[]>(() => {
    const seen = new Set<string>();
    const ingredients: CartAssistantIngredient[] = [];
    for (const item of visiblePurchaseItems) {
      if (smartChecked.has(item.origIndex)) continue;
      const key = canonicalIngredientKey(item.name);
      if (!key || seen.has(key)) continue;
      const state = lookupByIngredient[key];
      if (state?.status === "queued" || state?.status === "loading") continue;
      seen.add(key);
      ingredients.push({
        key,
        name: item.name,
        suggestedPurchase: item.suggested_purchase,
        products: state?.status === "success" ? state.products ?? [] : [],
      });
    }
    return ingredients;
  }, [lookupByIngredient, smartChecked, visiblePurchaseItems]);

  const pendingCartIngredients = useMemo(() => {
    const seen = new Set<string>();
    const ingredients: Array<Pick<CartAssistantIngredient, "key" | "name" | "suggestedPurchase">> = [];
    for (const item of visiblePurchaseItems) {
      if (smartChecked.has(item.origIndex)) continue;
      const key = canonicalIngredientKey(item.name);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      const state = lookupByIngredient[key];
      if (state?.status !== "queued" && state?.status !== "loading") continue;
      ingredients.push({
        key,
        name: item.name,
        suggestedPurchase: item.suggested_purchase,
      });
    }
    return ingredients;
  }, [lookupByIngredient, smartChecked, visiblePurchaseItems]);

  const cartDraft = useMemo(
    () => buildCartAssistantDraft({
      ingredients: activeCartIngredients,
      selectedUrlByIngredient,
      confirmedTokens: confirmedCartTokens,
    }),
    [activeCartIngredients, confirmedCartTokens, selectedUrlByIngredient],
  );

  useEffect(() => {
    if (
      !activeRefinedData
      || cartHydratedWeek !== start
      || cartProductsHydratedWeek !== start
    ) {
      return;
    }

    const allKeys = new Set(allCartIngredients.map((ingredient) => ingredient.key));
    setSelectedUrlByIngredient((current) => {
      const next: Record<string, string> = {};
      for (const [key, url] of Object.entries(current)) {
        if (!allKeys.has(key)) continue;
        const state = lookupByIngredient[key];
        if (!state || state.status === "idle" || state.status === "queued" || state.status === "loading") {
          next[key] = url;
          continue;
        }
        if (
          state.status === "success"
          && (state.products ?? [])
            .filter((product) => isSafeWeeeProductUrl(product.url))
            .slice(0, 3)
            .some((product) => product.url === url)
        ) {
          next[key] = url;
        }
      }
      const unchanged = Object.keys(current).length === Object.keys(next).length
        && Object.entries(next).every(([key, url]) => current[key] === url);
      return unchanged ? current : next;
    });

    const activeKeys = new Set([
      ...activeCartIngredients.map((ingredient) => ingredient.key),
      ...pendingCartIngredients.map((ingredient) => ingredient.key),
    ]);
    const selectedTokenByKey = new Map(
      cartDraft.selections.map((selection) => [selection.ingredientKey, selection.confirmationToken]),
    );
    setConfirmedCartTokens((current) => {
      const next = new Set<string>();
      for (const token of current) {
        const key = confirmationIngredientKey(token);
        if (!key || !activeKeys.has(key)) continue;
        const state = lookupByIngredient[key];
        if (!state || state.status === "idle" || state.status === "queued" || state.status === "loading") {
          next.add(token);
        } else if (selectedTokenByKey.get(key) === token) {
          next.add(token);
        }
      }
      if (next.size === current.size && [...next].every((token) => current.has(token))) return current;
      return next;
    });
  }, [
    activeCartIngredients,
    activeRefinedData,
    allCartIngredients,
    cartDraft.selections,
    cartHydratedWeek,
    cartProductsHydratedWeek,
    lookupByIngredient,
    pendingCartIngredients,
    start,
  ]);

  useEffect(() => {
    if (
      !activeRefinedData
      || cartHydratedWeek !== start
      || cartProductsHydratedWeek !== start
    ) {
      return;
    }
    const key = cartAssistantStorageKey(start);
    if (writeSessionStorage(
      key,
      JSON.stringify({
        selectedUrlByIngredient,
        confirmedTokens: [...confirmedCartTokens],
      }),
    )) {
      suppressedCartHydrationKeys.delete(key);
    }
  }, [
    activeRefinedData,
    cartHydratedWeek,
    cartProductsHydratedWeek,
    confirmedCartTokens,
    selectedUrlByIngredient,
    start,
  ]);

  const purchaseByCategory = useMemo(() => {
    const map = new Map<GroceryCategory, { item: PurchaseItem; origIndex: number }[]>();
    for (const row of visiblePurchaseItems) {
      const cat = normalizeGroceryCategory(row.category, row.name);
      if (!map.has(cat)) map.set(cat, []);
      map.get(cat)!.push({ item: row, origIndex: row.origIndex });
    }
    return map;
  }, [visiblePurchaseItems]);

  const productQueueGroups = useMemo(
    () =>
      GROCERY_CATEGORY_ORDER.map((category) => ({
        category,
        rows: (purchaseByCategory.get(category) ?? []).map(({ item, origIndex }) => ({
          name: item.name,
          checked: smartChecked.has(origIndex),
        })),
      })),
    [purchaseByCategory, smartChecked],
  );

  const planRows = useMemo(
    () => buildPlannedMealRows(mealPlans, recipeById, start),
    [mealPlans, recipeById, start],
  );

  async function handleCopyList() {
    if (!activeRefinedData) return;
    const week = start;
    const lines = visiblePurchaseItems.filter(row => !smartChecked.has(row.origIndex))
      .map(row => [row.name, row.suggested_purchase].filter(Boolean).join(" — "));
    setCopyError(null);
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      if (activeWeekStartRef.current === week) setCopied(true);
    } catch {
      if (activeWeekStartRef.current === week) setCopyError(t("shopping.copyFailed"));
    }
  }

  async function handlePrepareSmartList() {
    const originWeekStart = start;
    const originAuthGeneration = getAuthGeneration();
    const refineGeneration = refineGenerationRef.current + 1;
    refineGenerationRef.current = refineGeneration;
    const isCurrentRefine = () => (
      activeWeekStartRef.current === originWeekStart
      && getAuthGeneration() === originAuthGeneration
      && refineGenerationRef.current === refineGeneration
    );
    setRefineError(null);
    setRefining(true);
    try {
      const [latestListRes, latestPlanRes] = await Promise.all([
        apiFetch(`/shopping-list?start=${start}&end=${end}`),
        apiFetch(`/meal-plan?start=${start}&end=${end}`).catch(() => null),
      ]);
      if (!latestListRes.ok) throw new Error(t("shopping.refineFailed"));
      const latestItems: ShoppingListItem[] = await latestListRes.json();
      if (!Array.isArray(latestItems) || latestItems.some(item => !item
        || typeof item.name !== "string" || !item.name.trim()
        || typeof item.total_quantity !== "string")) throw new Error(t("shopping.refineFailed"));
      let latestPlans: MealPlanDay[] = [];
      let previewFailed = !latestPlanRes?.ok;
      if (latestPlanRes?.ok) {
        try {
          const payload = await latestPlanRes.json();
          if (Array.isArray(payload)) latestPlans = payload;
          else previewFailed = true;
        } catch { previewFailed = true; }
      }
      if (!isCurrentRefine()) return;
      setItems(latestItems);
      setMealPlans(latestPlans);
      setPreviewUnavailable(previewFailed);
      const latestPlannerFingerprint = buildWeekMealPlanFingerprint(weekDates, latestPlans);
      let data: RefineResponse;
      // A freshly fetched, server-aggregated list remains usable when AI is busy.
      // Authentication/validation failures must still surface as errors.
      let fallbackAllowed = true;
      const controller = new AbortController();
      const deadline = setTimeout(() => controller.abort(), 45_000);
      try {
        const res = await apiFetch("/shopping-list/refine", {
          method: "POST",
          signal: controller.signal,
          body: JSON.stringify({
            items: shoppingRefineInputs(latestItems),
          }),
        });
        fallbackAllowed = res.ok || res.status === 429 || res.status >= 500;
        if (!res.ok) throw new Error(t("shopping.refineFailed"));
        const payload: RefineResponse = await res.json();
        if (!isRefineResponse(payload) || (latestItems.length > 0 && payload.purchase_items.length === 0)) {
          throw new Error(t("shopping.refineFailed"));
        }
        data = { ...payload, _quantityVersion: SHOPPING_QUANTITY_VERSION };
      } catch (error) {
        if (!fallbackAllowed) throw error;
        data = {
          remove: [], likely_pantry: [],
          purchase_items: latestItems.map(item => ({
            name: item.name, suggested_purchase: item.total_quantity,
          })),
          _quantityVersion: SHOPPING_QUANTITY_VERSION,
          refinement_status: "fallback",
        };
      } finally {
        clearTimeout(deadline);
      }
      if (!isCurrentRefine()) return;
      // Follow ingredient identity, not row position, when refinement reorders rows.
      // Changed quantities must be checked again; clicks during the request count.
      const previous = smartProgressRef.current;
      const itemKey = (item: PurchaseItem) => JSON.stringify([item.name.trim(), item.suggested_purchase.trim()]);
      const preserveProgress = (selected: Set<number>) => {
        const keys = new Set(previous.data?.purchase_items
          .filter((_, index) => selected.has(index)).map(itemKey));
        return new Set(data.purchase_items.flatMap((item, index) => keys.has(itemKey(item)) ? [index] : []));
      };
      const sameIngredients = previous.data
        && JSON.stringify(previous.data.purchase_items.map(itemKey).sort())
          === JSON.stringify(data.purchase_items.map(itemKey).sort());
      const hidden = preserveProgress(previous.hidden);
      const checked = preserveProgress(previous.checked);
      setRefinedData(data);
      setSmartWeekStart(start);
      setSavedPlannerFingerprint(latestPlannerFingerprint);
      setSmartListStale(previewFailed);
      setSmartHidden(hidden);
      setSmartChecked(checked);
      if (!sameIngredients) {
        clearCartAssistantState(true);
        clearStoredProductResults();
        clearProductResults();
      }
      persistSmart(data, hidden, checked, latestPlannerFingerprint);
    } catch {
      if (isCurrentRefine()) setRefineError(t("shopping.refineFailed"));
    } finally {
      if (isCurrentRefine()) setRefining(false);
    }
  }

  function handleBackToOriginalList() {
    refineGenerationRef.current += 1;
    setRefining(false);
    removeSessionStorage(smartListStorageKey(start));
    clearStoredProductResults();
    clearCartAssistantState(true);
    setRefinedData(null);
    setSmartWeekStart(null);
    setSavedPlannerFingerprint(null);
    setSmartListStale(false);
    setRefineError(null);
    setSmartHidden(new Set());
    setSmartChecked(new Set());
    clearProductResults();
  }

  async function ensureProductsLoaded(
    ingredientName: string,
    openPanel = true,
    forceRetry = false
  ) {
    const cleanedQuery = cleanIngredientQuery(ingredientName);
    const key = canonicalIngredientKey(cleanedQuery);
    if (!key) return;
    const rememberedQuery = productQueryByKeyRef.current[key] ?? cleanedQuery;
    if (!productQueryByKeyRef.current[key]) {
      const nextQueries = {
        ...productQueryByKeyRef.current,
        [key]: rememberedQuery,
      };
      productQueryByKeyRef.current = nextQueries;
      setProductQueryByKey(nextQueries);
    }

    if (openPanel) {
      setOpenProductsByIngredient((prev) => ({ ...prev, [key]: true }));
    }
    const currentState = lookupByIngredient[key];
    if (!forceRetry && currentState && currentState.status !== "idle") {
      return;
    }

    const generation = productLoadGenerationRef.current;
    productLookupCoordinator.seedQueries({ [key]: rememberedQuery }, generation);
    await productLookupCoordinator.request(rememberedQuery, generation);
  }

  async function handleToggleProducts(ingredientName: string) {
    const key = canonicalIngredientKey(ingredientName);
    if (!key) return;

    const isOpen = !!openProductsByIngredient[key];
    if (isOpen) {
      setOpenProductsByIngredient((prev) => ({ ...prev, [key]: false }));
      return;
    }

    await ensureProductsLoaded(ingredientName);
  }

  async function handleRetryProducts(ingredientName: string) {
    await ensureProductsLoaded(ingredientName, true, true);
  }

  async function handleLoadAllProducts() {
    const seen = new Set<string>();
    const keys = buildVisualProductQueue(productQueueGroups).filter((query) => {
      const canonicalKey = canonicalIngredientKey(query);
      if (!canonicalKey || seen.has(canonicalKey)) return false;
      seen.add(canonicalKey);
      return true;
    });
    if (!keys.length) return;
    const generation = productLoadGenerationRef.current;
    const rememberedQueries = { ...productQueryByKeyRef.current };
    const preparedKeys = keys.map((query) => {
      const canonicalKey = canonicalIngredientKey(query);
      const remembered = rememberedQueries[canonicalKey] ?? cleanIngredientQuery(query);
      rememberedQueries[canonicalKey] = remembered;
      return remembered;
    });
    productQueryByKeyRef.current = rememberedQueries;
    setProductQueryByKey(rememberedQueries);
    productLookupCoordinator.seedQueries(rememberedQueries, generation);
    setOpenProductsByIngredient((current) => ({
      ...current,
      ...Object.fromEntries(preparedKeys.map((query) => [canonicalIngredientKey(query), true])),
    }));
    const unresolvedKeys = preparedKeys.filter((query) => {
      const state = lookupByIngredient[canonicalIngredientKey(query)];
      return !(
        state?.status === "success" &&
        typeof state.expiresAt === "string" &&
        Date.parse(state.expiresAt) > Date.now()
      );
    });
    let completed = preparedKeys.length - unresolvedKeys.length;
    if (!unresolvedKeys.length) return;
    setBulkLoadingProducts(true);
    setBulkLoadProgress({ current: completed, total: preparedKeys.length });
    try {
      await Promise.all(
        productLookupCoordinator.requestBulk(unresolvedKeys, generation).map(async (request) => {
          await request;
          if (productLoadGenerationRef.current !== generation) return;
          completed += 1;
          setBulkLoadProgress({ current: completed, total: preparedKeys.length });
        }),
      );
    } finally {
      if (productLoadGenerationRef.current === generation) {
        setBulkLoadingProducts(false);
        setBulkLoadProgress(null);
      }
    }
  }

  function handleOpenCartProduct(productUrl: string) {
    if (!isSafeWeeeProductUrl(productUrl)) return;
    const currentSelection = cartDraft.selections.find(
      (selection) => !selection.confirmed && !skippedCartTokens.has(selection.confirmationToken),
    );
    if (currentSelection?.product.url !== productUrl) return;
    window.open(productUrl, "_blank", "noopener,noreferrer");
    trackEvent("retailer_handoff", "/shopping-list", "weee");
  }

  function handleConfirmCartItem(confirmationToken: string) {
    const currentSelection = cartDraft.selections.find(
      (selection) => !selection.confirmed && !skippedCartTokens.has(selection.confirmationToken),
    );
    if (currentSelection?.confirmationToken !== confirmationToken) return;
    setConfirmedCartTokens((current) => new Set(current).add(confirmationToken));
    setSkippedCartTokens((current) => {
      if (!current.has(confirmationToken)) return current;
      const next = new Set(current);
      next.delete(confirmationToken);
      return next;
    });
  }

  function handleUndoCartItem(confirmationToken: string) {
    setConfirmedCartTokens((current) => {
      if (!current.has(confirmationToken)) return current;
      const next = new Set(current);
      next.delete(confirmationToken);
      return next;
    });
  }

  function handleSkipCartItem(confirmationToken: string) {
    const currentSelection = cartDraft.selections.find(
      (selection) => !selection.confirmed && !skippedCartTokens.has(selection.confirmationToken),
    );
    if (currentSelection?.confirmationToken !== confirmationToken) return;
    setSkippedCartTokens((current) => new Set(current).add(confirmationToken));
  }

  function handleFindCartMatch(ingredientKey: string) {
    const ingredient = activeCartIngredients.find((candidate) => candidate.key === ingredientKey);
    closeCartDialog();
    if (ingredient) void ensureProductsLoaded(ingredient.name, true, true);
  }

  if (loading) return <p className="shop-muted shop-page--wide">{t("common.loading")}</p>;
  if (error) return <div className="shop-error shop-page--wide"><p role="alert">{error}</p><button type="button" onClick={() => setLoadVersion(value => value + 1)}>{t("shopping.retry")}</button></div>;

  const smartItemCount = visiblePurchaseItems.filter((r) => !smartChecked.has(r.origIndex)).length;
  const mealRowsVisible = planMealsExpanded ? planRows : planRows.slice(0, PREVIEW_MEAL_ROWS);
  const moreMealsCount = Math.max(0, planRows.length - PREVIEW_MEAL_ROWS);
  const plannedMealCount = planRows.reduce((count, row) => count + row.occurrences.length, 0);
  const weekRangeLabel = formatWeekRangeDisplay(start, end);
  const hasPlannedMeals = planRows.length > 0;
  const canPrepareSmart = items.length > 0 && !refining;

  const orderedCategories = GROCERY_CATEGORY_ORDER;

  const plannedMealsPanel = (
    <section className={styles.plannedMeals} aria-labelledby="shopping-planned-meals-title">
      <header>
        <div>
          <span className={styles.contextLabel}>{editorialCopy["shopping.thisWeek"]}</span>
          <h2 className="cw-display" id="shopping-planned-meals-title">Planned meals</h2>
        </div>
        <span>
          {planRows.length} {planRows.length === 1 ? "recipe" : "recipes"}
          {plannedMealCount !== planRows.length ? ` · ${plannedMealCount} meals` : ""}
        </span>
      </header>
      {hasPlannedMeals ? (
        <div className={styles.mealList}>
          {mealRowsVisible.map((row) => (
            <Link key={row.recipeId} href={`/recipe/${row.recipeId}`}>
              {row.thumbnailUrl ? (
                <span className={styles.mealThumbnail} aria-hidden>
                  <img src={row.thumbnailUrl} alt="" loading="lazy" />
                </span>
              ) : null}
              <span className={styles.mealCopy}>
                <strong>{row.title}</strong>
                <span aria-label={row.occurrences.map(formatMealOccurrence).join(", ")}>
                  {formatPlannedMealSchedule(row)}
                </span>
              </span>
            </Link>
          ))}
          {moreMealsCount > 0 ? (
            <button type="button" onClick={() => setPlanMealsExpanded((expanded) => !expanded)}>
              {planMealsExpanded ? "Show less" : `+ ${moreMealsCount} more`}
            </button>
          ) : null}
        </div>
      ) : <p>No recipe slots filled for this range yet.</p>}
    </section>
  );

  return (
    <PageShell className={styles.page}>
      <PageHeader title={t("shopping.title")} description={editorialCopy["shopping.tagline"]} />

      <section className={styles.weekBar} aria-label="Week range">
        <div>
          <span>{t("shopping.currentRange")}</span>
          <strong>{weekRangeLabel}</strong>
        </div>
        <div>
          <button type="button" onClick={() => setWeek(prev)} aria-label={t("common.previous")}>←</button>
          <button type="button" onClick={() => setWeek(next)} aria-label={t("common.next")}>→</button>
          <Link href={`/planner?week=${currentWeek}`}>{t("shopping.changeWeek")}</Link>
        </div>
      </section>

      {activeRefinedData ? (
        <ShoppingSmartBar
          itemCount={smartItemCount}
          totalCount={visiblePurchaseItems.length}
          stale={smartListStale || activeRefinedData._quantityVersion !== SHOPPING_QUANTITY_VERSION}
          fallback={activeRefinedData.refinement_status === "fallback"}
          refining={refining}
          copied={copied}
          bulkLoading={bulkLoadingProducts}
          bulkProgress={bulkLoadProgress}
          cartReadyCount={cartDraft.summary.readyCount}
          loadButtonRef={cartLoadProductsRef}
          reviewButtonRef={cartReviewTriggerRef}
          onBack={handleBackToOriginalList}
          onRefresh={() => void handlePrepareSmartList()}
          onCopy={handleCopyList}
          onLoadProducts={() => void handleLoadAllProducts()}
          onReviewCart={() => setCartDialogOpen(true)}
          onPrepareMuse={() => setMuseDialogOpen(true)}
        />
      ) : null}

      <section
        className={`${styles.workspace}${activeRefinedData ? ` ${styles.smartWorkspace}` : ""}`}
        aria-label={activeRefinedData ? undefined : "Prepare smart shopping list"}
      >
        {!activeRefinedData ? (
          <aside className={styles.retailerColumn}>
            {plannedMealsPanel}
          </aside>
        ) : null}
        <div className={styles.listColumn}>
      {activeRefinedData && refineError ? <p className={styles.error} role="alert">{refineError}</p> : null}
      {activeRefinedData?.refinement_status === "fallback" ? <p role="status">{t("shopping.refineFallback")}</p> : null}
      {copyError ? <p className={styles.error} role="alert">{copyError}</p> : null}
      {previewUnavailable ? <p role="status">{t("shopping.previewUnavailable")}</p> : null}
      {!hasPlannedMeals && items.length === 0 ? (
        <div className={styles.empty}>
          <strong>{t("shopping.noMealsPlanned")}</strong>
          <Link href={`/planner?week=${currentWeek}`}>{t("nav.planner")} →</Link>
        </div>
      ) : activeRefinedData ? (
        <>
          <div className={styles.categoryGrid}>
            {orderedCategories.map((category) => {
              const rows = purchaseByCategory.get(category);
              if (!rows?.length) return null;
              return (
                <ShoppingCategorySection
                  key={category}
                  title={getDisplayCategory(category, category, language)}
                  rows={rows}
                  checked={smartChecked}
                  openProducts={openProductsByIngredient}
                  lookup={lookupByIngredient}
                  selectedUrlByIngredient={selectedUrlByIngredient}
                  menuOpenFor={menuOpenFor}
                  onToggleChecked={toggleSmartChecked}
                  onHide={hideSmartItem}
                  onToggleMenu={(index) => setMenuOpenFor((current) => current === index ? null : index)}
                  onToggleProducts={(name) => void handleToggleProducts(name)}
                  onRetryProducts={(name) => void handleRetryProducts(name)}
                  onSelectProduct={handleSelectProduct}
                />
              );
            })}
          </div>

          <CartAssistantDialog
            open={cartDialogOpen}
            draft={cartDraft}
            pendingIngredients={pendingCartIngredients}
            skippedTokens={skippedCartTokens}
            onClose={closeCartDialog}
            onOpenProduct={handleOpenCartProduct}
            onConfirm={handleConfirmCartItem}
            onUndoConfirm={handleUndoCartItem}
            onSkip={handleSkipCartItem}
            onFindMatch={handleFindCartMatch}
          />

          <MuseShoppingDialog
            open={museDialogOpen}
            draft={cartDraft}
            pendingIngredients={pendingCartIngredients}
            scopeKey={`${start}:${getAuthGeneration()}`}
            stale={smartListStale || activeRefinedData._quantityVersion !== SHOPPING_QUANTITY_VERSION}
            refreshing={refining}
            refreshError={refineError}
            refinementFallback={activeRefinedData.refinement_status === "fallback"}
            onRefresh={() => void handlePrepareSmartList()}
            onClose={() => setMuseDialogOpen(false)}
          />

          {activeRefinedData.remove.length ? (
            <details className={styles.removed} open={!smartRemovedCollapsed}>
              <summary onClick={(event) => {
                event.preventDefault();
                setSmartRemovedCollapsed((collapsed) => !collapsed);
              }}>
                Removed items ({activeRefinedData.remove.length})
              </summary>
              <ul>{activeRefinedData.remove.map((name, index) => <li key={`${name}-${index}`}>{name}</li>)}</ul>
            </details>
          ) : null}
        </>
      ) : (
          <section className={styles.prepareAction}>
            <span className={styles.contextLabel}>{editorialCopy["shopping.originalList"]}</span>
            <h2 className="cw-display">Prepare smart list</h2>
            <dl>
              <div><dt>Recipes</dt><dd>{planRows.length}</dd></div>
              <div><dt>Ingredients</dt><dd>{items.length}</dd></div>
            </dl>
            {refineError ? <p className={styles.error} role="alert">{refineError}</p> : null}
            <button type="button" onClick={() => void handlePrepareSmartList()} disabled={!canPrepareSmart}>
              {refining ? "Preparing…" : "Prepare smart shopping list"}
            </button>
          </section>
      )}
        </div>
      </section>
    </PageShell>
  );
}

export default function ShoppingListPage() {
  return (
    <RequireAuth>
      <Suspense fallback={<p className="shop-muted app-container">Loading...</p>}>
        <ShoppingListPageContent />
      </Suspense>
    </RequireAuth>
  );
}

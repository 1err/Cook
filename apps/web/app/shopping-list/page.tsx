"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import type { StoreProductsResponse } from "@cooking/api-client";
import { apiFetch } from "../lib/api";
import { RequireAuth } from "../components/RequireAuth";
import { PageHeader, PageShell } from "../components/PageShell";
import { useI18n, useT } from "../lib/i18n";
import type { Recipe } from "../types";
import {
  GROCERY_CATEGORY_ORDER,
  buildWeekMealPlanFingerprint,
  formatWeekRangeDisplay,
  getDisplayCategory,
  getPrevNextWeek,
  getWeekBounds,
  normalizeGroceryCategory,
  plannerFingerprintStorageKey,
  type GroceryCategory,
  type MealPlanDay,
} from "@cooking/shared";
import { ShoppingCategorySection } from "./ShoppingCategorySection";
import { ShoppingSmartBar } from "./ShoppingSmartBar";
import styles from "./ShoppingList.module.css";
import {
  buildVisualProductQueue,
  type ProductLookupState,
} from "./productLoading";
import {
  buildProductLookupStorage,
  canonicalIngredientKey,
  createProductLookupCoordinator,
  parseStoreProductsResponse,
  parseProductLookupStorage,
} from "./productLookupCoordinator";

const SMART_SHOPPING_LIST_PREFIX = "smartShoppingList";
const SMART_SHOPPING_PRODUCTS_PREFIX = "smartShoppingProducts";

function smartListStorageKey(weekStart: string) {
  return `${SMART_SHOPPING_LIST_PREFIX}:${weekStart}`;
}

function smartProductsStorageKey(weekStart: string) {
  return `${SMART_SHOPPING_PRODUCTS_PREFIX}:${weekStart}:weee`;
}

function writeSessionStorage(key: string, value: string) {
  try {
    sessionStorage.setItem(key, value);
  } catch {
    // Ephemeral cache writes are best effort; quota/privacy failures must not break shopping.
  }
}

function removeSessionStorage(key: string) {
  try {
    sessionStorage.removeItem(key);
  } catch {
    // Keep React state usable when privacy settings deny ephemeral storage access.
  }
}

const SLOT_ORDER = ["breakfast", "lunch", "dinner"] as const;
type PlanSlot = (typeof SLOT_ORDER)[number];
const DOW_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const PREVIEW_MEAL_ROWS = 4;

const SHOPPING_PRIMARY_CATEGORIES: GroceryCategory[] = ["Pantry & Dry Goods"];
const SHOPPING_SECONDARY_CATEGORIES = GROCERY_CATEGORY_ORDER.filter(
  (cat) => !SHOPPING_PRIMARY_CATEGORIES.includes(cat)
) as GroceryCategory[];

function buildPlannedMealRows(
  plans: MealPlanDay[],
  recipes: Record<string, Recipe | undefined>,
  weekMondayYmd: string,
): { recipeId: string; title: string; slot: PlanSlot; dayShort: string; date: string }[] {
  const { dates: weekDates } = getWeekBounds(weekMondayYmd);
  const dowByDate = new Map(weekDates.map((d, i) => [d, DOW_SHORT[i]]));
  const rows: { recipeId: string; title: string; slot: PlanSlot; dayShort: string; date: string }[] = [];
  for (const p of plans) {
    const dayShort = dowByDate.get(p.date) ?? "";
    if (!dayShort) continue;
    for (const slot of SLOT_ORDER) {
      for (const rid of p[slot] ?? []) {
        if (!rid?.trim()) continue;
        const rec = recipes[rid];
        const title = rec?.title?.trim();
        if (!title) continue;
        rows.push({
          recipeId: rid,
          title,
          slot,
          dayShort,
          date: p.date,
        });
      }
    }
  }
  rows.sort((a, b) => {
    if (a.date !== b.date) return a.date.localeCompare(b.date);
    return SLOT_ORDER.indexOf(a.slot) - SLOT_ORDER.indexOf(b.slot);
  });
  return rows;
}

function slotLabel(slot: PlanSlot): string {
  return slot.charAt(0).toUpperCase() + slot.slice(1);
}

interface ShoppingListItem {
  name: string;
  total_quantity: string;
}

interface PurchaseItem {
  name: string;
  suggested_purchase: string;
  category?: string;
}

interface RefineResponse {
  remove: string[];
  likely_pantry: { name: string; reason: string }[];
  purchase_items: PurchaseItem[];
}

interface SmartStored extends RefineResponse {
  _ui?: { hidden: number[]; checked: number[] };
  _plannerFingerprint?: string;
}

async function loadProduct(key: string): Promise<StoreProductsResponse> {
  const res = await apiFetch(`/store-products?query=${encodeURIComponent(key)}`);
  if (!res.ok) throw new Error("Failed to load products");
  const data: unknown = await res.json();
  return parseStoreProductsResponse(data);
}

function parseSmartStored(
  raw: string
): { data: RefineResponse; hidden: Set<number>; checked: Set<number>; plannerFingerprint: string | null } | null {
  try {
    const parsed = JSON.parse(raw) as SmartStored;
    if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.purchase_items)) return null;
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

function ShoppingListPageContent() {
  const router = useRouter();
  const { language } = useI18n();
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
  const productLoadGenerationRef = useRef(0);
  const lookupByIngredientRef = useRef(lookupByIngredient);
  lookupByIngredientRef.current = lookupByIngredient;
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
      shouldPublish: (generation) => productLoadGenerationRef.current === generation,
      onState: (key, state) => {
        setLookupByIngredient((current) => ({ ...current, [key]: state }));
      },
    });
  }
  const productLookupCoordinator = productLookupCoordinatorRef.current;

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
    productLoadGenerationRef.current += 1;
    for (const entry of productExpiryTimersRef.current.values()) {
      clearTimeout(entry.timer);
    }
    productExpiryTimersRef.current.clear();
    setOpenProductsByIngredient({});
    setLookupByIngredient({});
    setBulkLoadingProducts(false);
    setBulkLoadProgress(null);
  }

  useEffect(() => {
    return () => {
      productLoadGenerationRef.current += 1;
      for (const entry of productExpiryTimersRef.current.values()) {
        clearTimeout(entry.timer);
      }
      productExpiryTimersRef.current.clear();
    };
  }, []);

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
          current.timer = setTimeout(fireAtExpiry, remaining);
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
        void productLookupCoordinator.request(key, generation);
      };
      const timer = setTimeout(fireAtExpiry, Math.max(0, expiresAtMs - Date.now()));
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

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setItems([]);
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
        const [listRes, planRes, recipesRes] = await Promise.all([
          apiFetch(`/shopping-list?start=${start}&end=${end}`),
          apiFetch(`/meal-plan?start=${start}&end=${end}`),
          apiFetch("/recipes"),
        ]);
        if (!listRes.ok) throw new Error("Failed to load");
        const data: ShoppingListItem[] = await listRes.json();
        if (cancelled) return;
        setItems(data);
        let plansPayload: MealPlanDay[] = [];
        if (planRes.ok) {
          const pj = await planRes.json();
          if (Array.isArray(pj)) plansPayload = pj;
        }
        setMealPlans(plansPayload);
        const latestFingerprint = buildWeekMealPlanFingerprint(weekDates, plansPayload);
        let rmap: Record<string, Recipe> = {};
        if (recipesRes.ok) {
          const recs: Recipe[] = await recipesRes.json();
          rmap = Object.fromEntries(recs.map((r) => [r.id, r]));
        }
        setRecipeById(rmap);
        try {
          const raw = sessionStorage.getItem(smartListStorageKey(start));
          if (raw) {
            const parsed = parseSmartStored(raw);
            if (parsed) {
              setRefinedData(parsed.data);
              setSmartWeekStart(start);
              setSmartHidden(parsed.hidden);
              setSmartChecked(parsed.checked);
              setSavedPlannerFingerprint(parsed.plannerFingerprint);
              setSmartListStale(
                Boolean(parsed.plannerFingerprint && parsed.plannerFingerprint !== latestFingerprint)
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
  }, [start, end, weekDates]);

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
      const raw = sessionStorage.getItem(smartProductsStorageKey(start));
      if (!raw) {
        clearProductResults();
        return;
      }
      const parsed = parseProductLookupStorage(raw);
      if (!parsed) {
        clearProductResults();
        return;
      }
      setOpenProductsByIngredient(parsed.open);
      setLookupByIngredient(parsed.lookup);
      setBulkLoadingProducts(false);
      setBulkLoadProgress(null);
      const generation = productLoadGenerationRef.current;
      for (const key of parsed.revalidate) {
        void productLookupCoordinator.request(key, generation);
      }
    } catch {
      clearProductResults();
    }
  }, [activeRefinedData, productLookupCoordinator, start]);

  useEffect(() => {
    if (!activeRefinedData) return;
    const payload = buildProductLookupStorage(
      openProductsByIngredient,
      lookupByIngredient,
    );
    writeSessionStorage(smartProductsStorageKey(start), JSON.stringify(payload));
  }, [activeRefinedData, lookupByIngredient, openProductsByIngredient, start]);

  useEffect(() => {
    if (!activeRefinedData || !activeSavedPlannerFingerprint) return;
    function syncSmartStaleState() {
      try {
        const latest = localStorage.getItem(plannerFingerprintStorageKey(start)) ?? currentPlannerFingerprint;
        setSmartListStale(latest !== activeSavedPlannerFingerprint);
      } catch {
        setSmartListStale(currentPlannerFingerprint !== activeSavedPlannerFingerprint);
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
  }, [activeRefinedData, activeSavedPlannerFingerprint, currentPlannerFingerprint, start]);

  function setWeek(week: string) {
    router.push(`/shopping-list?week=${week}`);
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

  const visiblePurchaseItems = useMemo(() => {
    if (!activeRefinedData) return [];
    return activeRefinedData.purchase_items
      .map((p, origIndex) => ({ ...p, origIndex }))
      .filter(({ origIndex }) => !smartHidden.has(origIndex));
  }, [activeRefinedData, smartHidden]);

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
      [...SHOPPING_PRIMARY_CATEGORIES, ...SHOPPING_SECONDARY_CATEGORIES].map((category) => ({
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

  function handleCopyList() {
    if (!activeRefinedData) return;
    const lines = visiblePurchaseItems
      .filter((row) => !smartChecked.has(row.origIndex))
      .map((p) => `${p.name} — ${p.suggested_purchase || ""}`.trim());
    navigator.clipboard.writeText(lines.join("\n")).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  async function handlePrepareSmartList() {
    setRefineError(null);
    setRefining(true);
    try {
      const [latestListRes, latestPlanRes] = await Promise.all([
        apiFetch(`/shopping-list?start=${start}&end=${end}`),
        apiFetch(`/meal-plan?start=${start}&end=${end}`),
      ]);
      if (!latestListRes.ok) throw new Error("Could not refresh your current planner list");
      const latestItems: ShoppingListItem[] = await latestListRes.json();
      let latestPlans: MealPlanDay[] = [];
      if (latestPlanRes.ok) {
        const payload = await latestPlanRes.json();
        if (Array.isArray(payload)) latestPlans = payload;
      }
      setItems(latestItems);
      setMealPlans(latestPlans);
      const latestPlannerFingerprint = buildWeekMealPlanFingerprint(weekDates, latestPlans);
      const res = await apiFetch("/shopping-list/refine", {
        method: "POST",
        body: JSON.stringify({
          items: latestItems.map((i) => ({ name: i.name, quantity: i.total_quantity })),
        }),
      });
      if (!res.ok) throw new Error("Refine failed");
      const data: RefineResponse = await res.json();
      setRefinedData(data);
      setSmartWeekStart(start);
      setSavedPlannerFingerprint(latestPlannerFingerprint);
      setSmartListStale(false);
      setSmartHidden(new Set());
      setSmartChecked(new Set());
      clearStoredProductResults();
      clearProductResults();
      persistSmart(data, new Set(), new Set(), latestPlannerFingerprint);
    } catch (e) {
      setRefineError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setRefining(false);
    }
  }

  function handleBackToOriginalList() {
    removeSessionStorage(smartListStorageKey(start));
    clearStoredProductResults();
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
    const key = canonicalIngredientKey(ingredientName);
    if (!key) return;

    if (openPanel) {
      setOpenProductsByIngredient((prev) => ({ ...prev, [key]: true }));
    }
    const currentState = lookupByIngredient[key];
    if (!forceRetry && currentState && currentState.status !== "idle") {
      return;
    }

    const generation = productLoadGenerationRef.current;
    await productLookupCoordinator.request(ingredientName, generation);
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
    const keys = buildVisualProductQueue(productQueueGroups);
    if (!keys.length) return;
    const generation = productLoadGenerationRef.current;
    setOpenProductsByIngredient((current) => ({
      ...current,
      ...Object.fromEntries(keys.map((key) => [canonicalIngredientKey(key), true])),
    }));
    setBulkLoadingProducts(true);
    setBulkLoadProgress({ current: 0, total: keys.length });
    let completed = 0;
    try {
      await Promise.all(
        keys.map(async (key) => {
          await productLookupCoordinator.request(key, generation);
          if (productLoadGenerationRef.current !== generation) return;
          completed += 1;
          setBulkLoadProgress({ current: completed, total: keys.length });
        }),
      );
    } finally {
      if (productLoadGenerationRef.current === generation) {
        setBulkLoadingProducts(false);
        setBulkLoadProgress(null);
      }
    }
  }

  if (loading) return <p className="shop-muted shop-page--wide">{t("common.loading")}</p>;
  if (error) return <p className="shop-error shop-page--wide">{error}</p>;

  const smartItemCount = visiblePurchaseItems.filter((r) => !smartChecked.has(r.origIndex)).length;
  const mealRowsVisible = planMealsExpanded ? planRows : planRows.slice(0, PREVIEW_MEAL_ROWS);
  const moreMealsCount = Math.max(0, planRows.length - PREVIEW_MEAL_ROWS);
  const weekRangeLabel = formatWeekRangeDisplay(start, end);
  const hasPlannedMeals = planRows.length > 0;
  const canPrepareSmart = items.length > 0 && !refining;

  const orderedCategories = [...SHOPPING_PRIMARY_CATEGORIES, ...SHOPPING_SECONDARY_CATEGORIES];

  return (
    <PageShell>
      <PageHeader title={t("shopping.title")} />

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

      {!hasPlannedMeals && items.length === 0 ? (
        <div className={styles.empty}>
          <strong>{t("shopping.noMealsPlanned")}</strong>
          <Link href={`/planner?week=${currentWeek}`}>{t("nav.planner")} →</Link>
        </div>
      ) : activeRefinedData ? (
        <>
          <ShoppingSmartBar
            itemCount={smartItemCount}
            stale={smartListStale}
            refining={refining}
            copied={copied}
            bulkLoading={bulkLoadingProducts}
            bulkProgress={bulkLoadProgress}
            onBack={handleBackToOriginalList}
            onRefresh={() => void handlePrepareSmartList()}
            onCopy={handleCopyList}
            onLoadProducts={() => void handleLoadAllProducts()}
          />

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
                  menuOpenFor={menuOpenFor}
                  onToggleChecked={toggleSmartChecked}
                  onHide={hideSmartItem}
                  onToggleMenu={(index) => setMenuOpenFor((current) => current === index ? null : index)}
                  onToggleProducts={(name) => void handleToggleProducts(name)}
                  onRetryProducts={(name) => void handleRetryProducts(name)}
                />
              );
            })}
          </div>

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
        <section className={styles.preparePanel} aria-label="Prepare smart shopping list">
          <div className={styles.plannedMeals}>
            <header>
              <h2 className="cw-display">Planned meals</h2>
              <span>{planRows.length} {planRows.length === 1 ? "recipe" : "recipes"}</span>
            </header>
            {hasPlannedMeals ? (
              <div className={styles.mealList}>
                {mealRowsVisible.map((row, index) => (
                  <Link key={`${row.date}-${row.slot}-${row.recipeId}-${index}`} href={`/recipe/${row.recipeId}`}>
                    <strong>{row.title}</strong>
                    <span>{row.dayShort} · {slotLabel(row.slot)}</span>
                  </Link>
                ))}
                {moreMealsCount > 0 ? (
                  <button type="button" onClick={() => setPlanMealsExpanded((expanded) => !expanded)}>
                    {planMealsExpanded ? "Show less" : `+ ${moreMealsCount} more`}
                  </button>
                ) : null}
              </div>
            ) : <p>No recipe slots filled for this range yet.</p>}
          </div>

          <aside className={styles.prepareAction}>
            <h2 className="cw-display">Prepare smart list</h2>
            <dl>
              <div><dt>Recipes</dt><dd>{planRows.length}</dd></div>
              <div><dt>Ingredients</dt><dd>{items.length}</dd></div>
            </dl>
            {refineError ? <p className={styles.error} role="alert">{refineError}</p> : null}
            <button type="button" onClick={() => void handlePrepareSmartList()} disabled={!canPrepareSmart}>
              {refining ? "Preparing…" : "Prepare smart shopping list"}
            </button>
          </aside>
        </section>
      )}
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

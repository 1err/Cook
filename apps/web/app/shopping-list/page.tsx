"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import { apiFetch } from "../lib/api";
import { RequireAuth } from "../components/RequireAuth";
import { useI18n, useT } from "../lib/i18n";
import { getWeekBounds, getPrevNextWeek, formatWeekRangeDisplay } from "../lib/week";
import type { Recipe } from "../types";
import {
  type MealPlanDay,
  buildWeekMealPlanFingerprint,
  plannerFingerprintStorageKey,
} from "../lib/mealPlan";
import {
  GROCERY_CATEGORY_ORDER,
  CATEGORY_MATERIAL_ICONS,
  getDisplayCategory,
  normalizeGroceryCategory,
  PRODUCT_STORE_LABELS,
  type ProductStore,
  type GroceryCategory,
} from "../lib/shoppingCategories";

const SMART_SHOPPING_LIST_PREFIX = "smartShoppingList";
const SMART_SHOPPING_PRODUCTS_PREFIX = "smartShoppingProducts";

function smartListStorageKey(weekStart: string) {
  return `${SMART_SHOPPING_LIST_PREFIX}:${weekStart}`;
}

function smartProductsStorageKey(weekStart: string, store: ProductStore) {
  return `${SMART_SHOPPING_PRODUCTS_PREFIX}:${weekStart}:${store}`;
}

const SLOT_ORDER = ["breakfast", "lunch", "dinner"] as const;
type PlanSlot = (typeof SLOT_ORDER)[number];
const DOW_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const PREVIEW_MEAL_ROWS = 4;

const BULK_LOAD_CONCURRENCY = 3;
const SHOPPING_PRIMARY_CATEGORIES: GroceryCategory[] = ["Pantry & Dry Goods"];
const SHOPPING_SECONDARY_CATEGORIES = GROCERY_CATEGORY_ORDER.filter(
  (cat) => !SHOPPING_PRIMARY_CATEGORIES.includes(cat)
) as GroceryCategory[];

/** Run async work on `items` with at most `limit` concurrent tasks. */
async function mapWithConcurrency<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  if (items.length === 0) return;
  const capped = Math.max(1, Math.min(limit, items.length));
  let i = 0;
  async function worker() {
    while (true) {
      const idx = i;
      i += 1;
      if (idx >= items.length) return;
      await fn(items[idx]);
    }
  }
  await Promise.all(Array.from({ length: capped }, () => worker()));
}

/** Served from /public — avoids Stitch/Google hotlink URLs that often 403 or expire. */
const SHOP_CONFIRM_HERO_SRC = "/shopping-list-hero.jpg";

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

function chipClassForSlot(slot: PlanSlot): string {
  if (slot === "breakfast") return "shop-confirm-chip shop-confirm-chip--breakfast";
  if (slot === "lunch") return "shop-confirm-chip shop-confirm-chip--lunch";
  return "shop-confirm-chip shop-confirm-chip--dinner";
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

interface StoreProductResult {
  name: string;
  price: string;
  image: string;
  url: string;
}

interface SmartStored extends RefineResponse {
  _ui?: { hidden: number[]; checked: number[] };
  _plannerFingerprint?: string;
}

interface SmartProductsStored {
  open: Record<string, boolean>;
  products: Record<string, StoreProductResult[]>;
  errors: Record<string, string | null>;
}

function bentoIconWrapClass(cat: GroceryCategory): string {
  const extra: Record<GroceryCategory, string> = {
    Produce: "shop-bento-icon-wrap--produce",
    Dairy: "shop-bento-icon-wrap--dairy",
    "Meat & Seafood": "shop-bento-icon-wrap--meat",
    "Pantry & Dry Goods": "shop-bento-icon-wrap--pantry",
    Frozen: "shop-bento-icon-wrap--frozen",
    Bakery: "shop-bento-icon-wrap--bakery",
    Other: "shop-bento-icon-wrap--other",
  };
  return `shop-bento-icon-wrap ${extra[cat]}`;
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

function parseSmartProductsStored(raw: string): SmartProductsStored | null {
  try {
    const parsed = JSON.parse(raw) as SmartProductsStored;
    if (!parsed || typeof parsed !== "object") return null;
    if (!parsed.open || typeof parsed.open !== "object") return null;
    if (!parsed.products || typeof parsed.products !== "object") return null;
    if (!parsed.errors || typeof parsed.errors !== "object") return null;
    return {
      open: Object.fromEntries(
        Object.entries(parsed.open).filter(([, value]) => typeof value === "boolean")
      ),
      products: Object.fromEntries(
        Object.entries(parsed.products).filter(([, value]) =>
          Array.isArray(value) &&
          value.every(
            (row) =>
              row &&
              typeof row === "object" &&
              typeof row.name === "string" &&
              typeof row.price === "string" &&
              typeof row.image === "string" &&
              typeof row.url === "string"
          )
        )
      ) as Record<string, StoreProductResult[]>,
      errors: Object.fromEntries(
        Object.entries(parsed.errors).filter(
          ([, value]) => value === null || typeof value === "string"
        )
      ) as Record<string, string | null>,
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
  const [productStore, setProductStore] = useState<ProductStore>("weee");
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
  const [productsByIngredient, setProductsByIngredient] = useState<Record<string, StoreProductResult[]>>({});
  const [productLoadingByIngredient, setProductLoadingByIngredient] = useState<Record<string, boolean>>({});
  const [productErrorByIngredient, setProductErrorByIngredient] = useState<Record<string, string | null>>({});
  const menuRef = useRef<HTMLDivElement | null>(null);
  const productStoreRef = useRef<ProductStore>("weee");

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (menuOpenFor === null) return;
      const el = menuRef.current;
      if (el && !el.contains(e.target as Node)) setMenuOpenFor(null);
    }
    document.addEventListener("click", onDocClick);
    return () => document.removeEventListener("click", onDocClick);
  }, [menuOpenFor]);

  function clearProductResults() {
    setOpenProductsByIngredient({});
    setProductsByIngredient({});
    setProductLoadingByIngredient({});
    setProductErrorByIngredient({});
    setBulkLoadingProducts(false);
    setBulkLoadProgress(null);
  }

  useEffect(() => {
    productStoreRef.current = productStore;
    clearProductResults();
  }, [productStore]);

  const persistSmart = useCallback(
    (data: RefineResponse, hidden: Set<number>, checked: Set<number>, plannerFingerprint: string) => {
      const payload: SmartStored = {
        ...data,
        _ui: { hidden: [...hidden], checked: [...checked] },
        _plannerFingerprint: plannerFingerprint,
      };
      sessionStorage.setItem(smartListStorageKey(start), JSON.stringify(payload));
    },
    [start]
  );

  const clearStoredProductResults = useCallback(() => {
    for (const store of ["weee", "amazon"] as const) {
      sessionStorage.removeItem(smartProductsStorageKey(start, store));
    }
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
      const raw = sessionStorage.getItem(smartProductsStorageKey(start, productStore));
      if (!raw) {
        clearProductResults();
        return;
      }
      const parsed = parseSmartProductsStored(raw);
      if (!parsed) {
        clearProductResults();
        return;
      }
      setOpenProductsByIngredient(parsed.open);
      setProductsByIngredient(parsed.products);
      setProductErrorByIngredient(parsed.errors);
      setProductLoadingByIngredient({});
      setBulkLoadingProducts(false);
      setBulkLoadProgress(null);
    } catch {
      clearProductResults();
    }
  }, [activeRefinedData, productStore, start]);

  useEffect(() => {
    if (!activeRefinedData) return;
    const payload: SmartProductsStored = {
      open: openProductsByIngredient,
      products: productsByIngredient,
      errors: productErrorByIngredient,
    };
    sessionStorage.setItem(smartProductsStorageKey(start, productStore), JSON.stringify(payload));
  }, [activeRefinedData, openProductsByIngredient, productErrorByIngredient, productsByIngredient, productStore, start]);

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
    sessionStorage.removeItem(smartListStorageKey(start));
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
    store: ProductStore,
    openPanel = true,
    forceRetry = false
  ) {
    const key = ingredientName.trim();
    if (!key) return;

    if (openPanel) {
      setOpenProductsByIngredient((prev) => ({ ...prev, [key]: true }));
    }
    if (
      !forceRetry &&
      ((productsByIngredient[key] !== undefined && !productErrorByIngredient[key]) ||
        productLoadingByIngredient[key])
    ) {
      return;
    }

    setProductLoadingByIngredient((prev) => ({ ...prev, [key]: true }));
    setProductErrorByIngredient((prev) => ({ ...prev, [key]: null }));

    try {
      const res = await apiFetch(`/store-products?query=${encodeURIComponent(key)}&store=${store}`);
      if (!res.ok) throw new Error("Failed to load products");
      const data: unknown = await res.json();
      const products = Array.isArray(data)
        ? data
            .filter((row): row is StoreProductResult => {
              if (!row || typeof row !== "object") return false;
              const maybe = row as Partial<StoreProductResult>;
              return (
                typeof maybe.name === "string" &&
                typeof maybe.price === "string" &&
                typeof maybe.image === "string" &&
                typeof maybe.url === "string"
              );
            })
            .slice(0, 3)
        : [];
      if (productStoreRef.current !== store) return;
      setProductsByIngredient((prev) => ({ ...prev, [key]: products }));
    } catch {
      if (productStoreRef.current !== store) return;
      setProductErrorByIngredient((prev) => ({ ...prev, [key]: "Failed to load products" }));
    } finally {
      if (productStoreRef.current !== store) return;
      setProductLoadingByIngredient((prev) => ({ ...prev, [key]: false }));
    }
  }

  async function handleToggleProducts(ingredientName: string) {
    const key = ingredientName.trim();
    if (!key) return;

    const isOpen = !!openProductsByIngredient[key];
    if (isOpen) {
      setOpenProductsByIngredient((prev) => ({ ...prev, [key]: false }));
      return;
    }

    await ensureProductsLoaded(key, productStore);
  }

  async function handleRetryProducts(ingredientName: string) {
    await ensureProductsLoaded(ingredientName, productStore, true, true);
  }

  async function handleLoadAllProducts() {
    const names = GROCERY_CATEGORY_ORDER.flatMap((cat) =>
      (purchaseByCategory.get(cat) ?? [])
        .filter(({ origIndex }) => !smartChecked.has(origIndex))
        .map(({ item }) => item.name.trim())
        .filter(Boolean)
    );
    if (!names.length) return;
    setBulkLoadingProducts(true);
    setBulkLoadProgress({ current: 0, total: names.length });
    let completed = 0;
    const storeSnapshot = productStore;

    try {
      await mapWithConcurrency(names, BULK_LOAD_CONCURRENCY, async (name) => {
        if (productStoreRef.current !== storeSnapshot) return;
        await ensureProductsLoaded(name, storeSnapshot, true);
        completed += 1;
        if (productStoreRef.current === storeSnapshot) {
          setBulkLoadProgress({ current: completed, total: names.length });
        }
      });
    } finally {
      if (productStoreRef.current === storeSnapshot) {
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

  const weekNavSection = (
    <section className="shop-confirm-week" aria-label="Week range">
      <div className="shop-confirm-week__left">
        <div className="shop-confirm-week__icon">
          <span className="material-symbols-outlined">calendar_today</span>
        </div>
        <div>
          <span className="shop-confirm-week__kicker">{t("shopping.currentRange")}</span>
          <h2 className="shop-confirm-week__range font-headline">{weekRangeLabel}</h2>
        </div>
      </div>
      <div className="shop-confirm-week__actions">
        <button type="button" className="shop-confirm-week__nav" onClick={() => setWeek(prev)} aria-label={t("common.previous")}>
          <span className="material-symbols-outlined">chevron_left</span>
        </button>
        <button type="button" className="shop-confirm-week__nav" onClick={() => setWeek(next)} aria-label={t("common.next")}>
          <span className="material-symbols-outlined">chevron_right</span>
        </button>
        <Link href={`/planner?week=${currentWeek}`} className="shop-confirm-week__change font-headline">
          {t("shopping.changeWeek")}
        </Link>
      </div>
    </section>
  );

  return (
    <div className="shop-page--wide" style={{ paddingTop: "var(--space-32)" }}>
      {!activeRefinedData && (
        <header className="mb-10">
          <h1 className="shop-confirm-title font-headline">{t("shopping.title")}</h1>
        </header>
      )}

      {weekNavSection}

      {!hasPlannedMeals && items.length === 0 ? (
        <div className="shop-confirm-hero">
          <div className="shop-confirm-hero__glow" aria-hidden />
          <div className="shop-confirm-empty font-headline">
            <p className="m-0 mb-2 font-bold text-lg" style={{ color: "var(--on-surface)" }}>
              {t("shopping.noMealsPlanned")}
            </p>
            <p className="m-0" style={{ maxWidth: "28rem", marginInline: "auto" }}>
              {t("shopping.addRecipesPrefix")}{" "}
              <Link href={`/planner?week=${currentWeek}`} className="shop-link font-bold">
                {t("nav.planner").toLowerCase()}
              </Link>{" "}
              {t("shopping.addRecipesSuffix")}
            </p>
          </div>
        </div>
      ) : (
        <>
          {activeRefinedData ? (
            <>
              <header className="shop-smart-hero">
                <div className="shop-smart-hero__bg" aria-hidden />
                <div className="shop-smart-hero__grad" aria-hidden />
                <div className="shop-smart-hero__inner">
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="shop-smart-meta-row">
                      <span className="shop-smart-badge font-headline">{t("shopping.smartMode")}</span>
                      <button type="button" className="shop-smart-back-prominent font-headline" onClick={handleBackToOriginalList}>
                        <span className="material-symbols-outlined" style={{ fontSize: "1.125rem" }}>
                          arrow_back
                        </span>
                        {t("shopping.backToOriginalList")}
                      </button>
                    </div>
                    <h1 className="shop-smart-hero__title font-headline">{t("shopping.smartTitle")}</h1>
                    <p className="shop-smart-hero__sub">
                      {t("shopping.smartSummary", { count: visiblePurchaseItems.length })}
                    </p>
                    <div className="shop-product-store">
                      <span className="shop-product-store__label">{t("shopping.productSource")}</span>
                      <div className="shop-product-store__chips" role="group" aria-label={t("shopping.productSource")}>
                        {(["weee", "amazon"] as ProductStore[]).map((store) => (
                          <button
                            key={store}
                            type="button"
                            className={`shop-product-store__chip font-headline${productStore === store ? " is-active" : ""}`}
                            onClick={() => setProductStore(store)}
                          >
                            {PRODUCT_STORE_LABELS[store]}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                  <div className="shop-smart-stat">
                    <p className="shop-smart-stat__num font-headline">{smartItemCount}</p>
                    <p className="shop-smart-stat__lbl font-headline">{t("shopping.toBuy")}</p>
                  </div>
                </div>
              </header>

              {smartListStale ? (
                <div className="shop-smart-stale">
                  <p className="shop-smart-stale__copy">
                    {t("shopping.plannerChanged")}
                  </p>
                  <button
                    type="button"
                    className="shop-smart-stale__action font-headline"
                    onClick={handlePrepareSmartList}
                    disabled={refining}
                  >
                    {refining ? t("shopping.refreshing") : t("shopping.refreshSmartList")}
                  </button>
                </div>
              ) : null}

              <div className="shop-bento-grid">
                <div className="shop-bento-column shop-bento-column--primary">
                  {SHOPPING_PRIMARY_CATEGORIES.map((cat) => {
                    const rows = purchaseByCategory.get(cat);
                    if (!rows?.length) return null;
                    const uncheckedRows = rows.filter(({ origIndex }) => !smartChecked.has(origIndex));
                    const checkedRows = rows.filter(({ origIndex }) => smartChecked.has(origIndex));
                    return (
                      <section key={cat} className="shop-bento-card">
                        <div className="shop-bento-card__head">
                          <div className="shop-bento-card__head-left">
                            <div className={bentoIconWrapClass(cat)}>
                              <span className="material-symbols-outlined" style={{ fontSize: "1.35rem" }}>
                                {CATEGORY_MATERIAL_ICONS[cat]}
                              </span>
                            </div>
                            <h2 className="shop-bento-card__title font-headline">
                              {getDisplayCategory(cat, cat, language)}
                            </h2>
                          </div>
                          <span className="shop-bento-count font-headline">
                            {t("shopping.toBuyCount", { count: uncheckedRows.length })}
                            {checkedRows.length ? ` • ${t("shopping.haveCount", { count: checkedRows.length })}` : ""}
                          </span>
                        </div>
                        <div>
                          {uncheckedRows.map(({ item, origIndex }) => {
                            const productsOpen = !!openProductsByIngredient[item.name];
                            const loadingProducts = !!productLoadingByIngredient[item.name];
                            const productError = productErrorByIngredient[item.name];
                            const products = productsByIngredient[item.name] ?? [];
                            return (
                              <div key={origIndex} className="shop-bento-row-block">
                                <div className="shop-bento-row">
                                  <label style={{ display: "flex", alignItems: "center", gap: "1rem", cursor: "pointer", flex: 1, minWidth: 0 }}>
                                    <input
                                      type="checkbox"
                                      className="shop-bento-row__check"
                                      checked={false}
                                      onChange={() => toggleSmartChecked(origIndex)}
                                      aria-label={t("shopping.markAlreadyHave", { name: item.name })}
                                    />
                                    <div className="shop-bento-row__text">
                                      <p className="shop-bento-row__name">{item.name}</p>
                                      {item.suggested_purchase ? (
                                        <p className="shop-bento-row__sub">{t("shopping.suggested", { value: item.suggested_purchase })}</p>
                                      ) : null}
                                    </div>
                                  </label>
                                  <div className="shop-bento-row__menu" ref={menuOpenFor === origIndex ? menuRef : undefined}>
                                    <button
                                      type="button"
                                      className="shop-bento-menu-btn"
                                      aria-label={t("shopping.more")}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setMenuOpenFor((m) => (m === origIndex ? null : origIndex));
                                      }}
                                    >
                                      <span className="material-symbols-outlined">more_vert</span>
                                    </button>
                                    {menuOpenFor === origIndex && (
                                      <div className="shop-smart-dropdown font-headline">
                                        <button type="button" onClick={() => hideSmartItem(origIndex)}>
                                          {t("shopping.removeFromList")}
                                        </button>
                                      </div>
                                    )}
                                  </div>
                                </div>

                                <div className="shop-bento-products">
                                  <button
                                    type="button"
                                    className="shop-bento-products__toggle font-headline"
                                    onClick={() => handleToggleProducts(item.name)}
                                    disabled={loadingProducts}
                                  >
                                    {productsOpen ? t("shopping.hideProducts") : t("shopping.viewProducts")}
                                  </button>

                                  {productsOpen ? (
                                    <div className="shop-bento-products__panel">
                                      {loadingProducts ? (
                                        <p className="shop-bento-products__status">{t("shopping.loadingProducts")}</p>
                                      ) : productError ? (
                                        <div className="shop-bento-products__status">
                                          <p style={{ margin: 0 }}>{productError}</p>
                                          <button type="button" className="shop-bento-products__toggle font-headline" onClick={() => void handleRetryProducts(item.name)}>
                                            {t("shopping.retryProducts")}
                                          </button>
                                        </div>
                                      ) : products.length === 0 ? (
                                        <div className="shop-bento-products__status">
                                          <p style={{ margin: 0 }}>
                                            {t("shopping.noProductsFound", { store: PRODUCT_STORE_LABELS[productStore] })}
                                          </p>
                                          <button type="button" className="shop-bento-products__toggle font-headline" onClick={() => void handleRetryProducts(item.name)}>
                                            {t("shopping.retryProducts")}
                                          </button>
                                        </div>
                                      ) : (
                                        products.map((product) => (
                                          <div key={product.url} className="shop-bento-product-card">
                                            {product.image ? (
                                              <img src={product.image} alt={product.name} loading="lazy" />
                                            ) : (
                                              <div className="shop-bento-product-card__img-placeholder" aria-hidden>
                                                <span className="material-symbols-outlined">image</span>
                                              </div>
                                            )}
                                            <div className="shop-bento-product-card__body">
                                              <p className="shop-bento-product-card__name">{product.name}</p>
                                              <p className="shop-bento-product-card__price">{product.price || t("shopping.seeListing")}</p>
                                              <a
                                                className="shop-bento-product-card__link font-headline"
                                                href={product.url}
                                                target="_blank"
                                                rel="noreferrer"
                                              >
                                                {t("shopping.viewOnStore", { store: PRODUCT_STORE_LABELS[productStore] })}
                                              </a>
                                            </div>
                                          </div>
                                        ))
                                      )}
                                    </div>
                                  ) : null}
                                </div>
                              </div>
                            );
                          })}

                          {checkedRows.length ? (
                            <div className="shop-bento-checked-group">
                              <p className="shop-bento-checked-group__label font-headline">{t("shopping.alreadyHave")}</p>
                              {checkedRows.map(({ item, origIndex }) => {
                                const productsOpen = !!openProductsByIngredient[item.name];
                                const loadingProducts = !!productLoadingByIngredient[item.name];
                                const productError = productErrorByIngredient[item.name];
                                const products = productsByIngredient[item.name] ?? [];
                                return (
                                  <div key={origIndex} className="shop-bento-row-block is-checked">
                                    <div className="shop-bento-row is-checked">
                                      <label style={{ display: "flex", alignItems: "center", gap: "1rem", cursor: "pointer", flex: 1, minWidth: 0 }}>
                                        <input
                                          type="checkbox"
                                          className="shop-bento-row__check"
                                          checked
                                          onChange={() => toggleSmartChecked(origIndex)}
                                          aria-label={t("shopping.markStillNeedToBuy", { name: item.name })}
                                        />
                                        <div className="shop-bento-row__text is-checked">
                                          <span className="shop-bento-row__state font-headline">{t("shopping.alreadyHave")}</span>
                                          <p className="shop-bento-row__name is-muted">{item.name}</p>
                                          {item.suggested_purchase ? (
                                            <p className="shop-bento-row__sub">{t("shopping.suggested", { value: item.suggested_purchase })}</p>
                                          ) : null}
                                        </div>
                                      </label>
                                      <div className="shop-bento-row__menu" ref={menuOpenFor === origIndex ? menuRef : undefined}>
                                        <button
                                          type="button"
                                          className="shop-bento-menu-btn"
                                          aria-label={t("shopping.more")}
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            setMenuOpenFor((m) => (m === origIndex ? null : origIndex));
                                          }}
                                        >
                                          <span className="material-symbols-outlined">more_vert</span>
                                        </button>
                                        {menuOpenFor === origIndex && (
                                          <div className="shop-smart-dropdown font-headline">
                                            <button type="button" onClick={() => hideSmartItem(origIndex)}>
                                              {t("shopping.removeFromList")}
                                            </button>
                                          </div>
                                        )}
                                      </div>
                                    </div>

                                    <div className="shop-bento-products">
                                      <button
                                        type="button"
                                        className="shop-bento-products__toggle font-headline"
                                        onClick={() => handleToggleProducts(item.name)}
                                        disabled={loadingProducts}
                                      >
                                        {productsOpen ? t("shopping.hideProducts") : t("shopping.viewProducts")}
                                      </button>

                                      {productsOpen ? (
                                        <div className="shop-bento-products__panel">
                                          {loadingProducts ? (
                                            <p className="shop-bento-products__status">{t("shopping.loadingProducts")}</p>
                                          ) : productError ? (
                                            <div className="shop-bento-products__status">
                                              <p style={{ margin: 0 }}>{productError}</p>
                                              <button type="button" className="shop-bento-products__toggle font-headline" onClick={() => void handleRetryProducts(item.name)}>
                                                {t("shopping.retryProducts")}
                                              </button>
                                            </div>
                                          ) : products.length === 0 ? (
                                            <div className="shop-bento-products__status">
                                              <p style={{ margin: 0 }}>
                                                {t("shopping.noProductsFound", { store: PRODUCT_STORE_LABELS[productStore] })}
                                              </p>
                                              <button type="button" className="shop-bento-products__toggle font-headline" onClick={() => void handleRetryProducts(item.name)}>
                                                {t("shopping.retryProducts")}
                                              </button>
                                            </div>
                                          ) : (
                                            products.map((product) => (
                                              <div key={product.url} className="shop-bento-product-card">
                                                {product.image ? (
                                                  <img src={product.image} alt={product.name} loading="lazy" />
                                                ) : (
                                                  <div className="shop-bento-product-card__img-placeholder" aria-hidden>
                                                    <span className="material-symbols-outlined">image</span>
                                                  </div>
                                                )}
                                                <div className="shop-bento-product-card__body">
                                                  <p className="shop-bento-product-card__name">{product.name}</p>
                                                  <p className="shop-bento-product-card__price">{product.price || t("shopping.seeListing")}</p>
                                                  <a
                                                    className="shop-bento-product-card__link font-headline"
                                                    href={product.url}
                                                    target="_blank"
                                                    rel="noreferrer"
                                                  >
                                                    {t("shopping.viewOnStore", { store: PRODUCT_STORE_LABELS[productStore] })}
                                                  </a>
                                                </div>
                                              </div>
                                            ))
                                          )}
                                        </div>
                                      ) : null}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          ) : null}
                        </div>
                      </section>
                    );
                  })}
                </div>

                <div className="shop-bento-column shop-bento-column--secondary">
                  {SHOPPING_SECONDARY_CATEGORIES.map((cat) => {
                    const rows = purchaseByCategory.get(cat);
                    if (!rows?.length) return null;
                    const uncheckedRows = rows.filter(({ origIndex }) => !smartChecked.has(origIndex));
                    const checkedRows = rows.filter(({ origIndex }) => smartChecked.has(origIndex));
                    return (
                      <section key={cat} className="shop-bento-card">
                      <div className="shop-bento-card__head">
                        <div className="shop-bento-card__head-left">
                          <div className={bentoIconWrapClass(cat)}>
                            <span className="material-symbols-outlined" style={{ fontSize: "1.35rem" }}>
                              {CATEGORY_MATERIAL_ICONS[cat]}
                            </span>
                          </div>
                          <h2 className="shop-bento-card__title font-headline">
                            {getDisplayCategory(cat, cat, language)}
                          </h2>
                        </div>
                        <span className="shop-bento-count font-headline">
                            {t("shopping.toBuyCount", { count: uncheckedRows.length })}
                            {checkedRows.length ? ` • ${t("shopping.haveCount", { count: checkedRows.length })}` : ""}
                        </span>
                      </div>
                      <div>
                        {uncheckedRows.map(({ item, origIndex }) => {
                          const productsOpen = !!openProductsByIngredient[item.name];
                          const loadingProducts = !!productLoadingByIngredient[item.name];
                          const productError = productErrorByIngredient[item.name];
                          const products = productsByIngredient[item.name] ?? [];
                          return (
                            <div key={origIndex} className="shop-bento-row-block">
                              <div className="shop-bento-row">
                                <label style={{ display: "flex", alignItems: "center", gap: "1rem", cursor: "pointer", flex: 1, minWidth: 0 }}>
                                  <input
                                    type="checkbox"
                                    className="shop-bento-row__check"
                                    checked={false}
                                    onChange={() => toggleSmartChecked(origIndex)}
                                    aria-label={t("shopping.markAlreadyHave", { name: item.name })}
                                  />
                                  <div className="shop-bento-row__text">
                                    <p className="shop-bento-row__name">{item.name}</p>
                                    {item.suggested_purchase ? (
                                        <p className="shop-bento-row__sub">{t("shopping.suggested", { value: item.suggested_purchase })}</p>
                                    ) : null}
                                  </div>
                                </label>
                                <div className="shop-bento-row__menu" ref={menuOpenFor === origIndex ? menuRef : undefined}>
                                  <button
                                    type="button"
                                    className="shop-bento-menu-btn"
                                    aria-label={t("shopping.more")}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setMenuOpenFor((m) => (m === origIndex ? null : origIndex));
                                    }}
                                  >
                                    <span className="material-symbols-outlined">more_vert</span>
                                  </button>
                                  {menuOpenFor === origIndex && (
                                    <div className="shop-smart-dropdown font-headline">
                                      <button type="button" onClick={() => hideSmartItem(origIndex)}>
                                        {t("shopping.removeFromList")}
                                      </button>
                                    </div>
                                  )}
                                </div>
                              </div>

                              <div className="shop-bento-products">
                                <button
                                  type="button"
                                  className="shop-bento-products__toggle font-headline"
                                  onClick={() => handleToggleProducts(item.name)}
                                  disabled={loadingProducts}
                                >
                                  {productsOpen ? t("shopping.hideProducts") : t("shopping.viewProducts")}
                                </button>

                                {productsOpen ? (
                                  <div className="shop-bento-products__panel">
                                    {loadingProducts ? (
                                      <p className="shop-bento-products__status">{t("shopping.loadingProducts")}</p>
                                    ) : productError ? (
                                      <div className="shop-bento-products__status">
                                        <p style={{ margin: 0 }}>{productError}</p>
                                        <button type="button" className="shop-bento-products__toggle font-headline" onClick={() => void handleRetryProducts(item.name)}>
                                          {t("shopping.retryProducts")}
                                        </button>
                                      </div>
                                    ) : products.length === 0 ? (
                                      <div className="shop-bento-products__status">
                                        <p style={{ margin: 0 }}>
                                          {t("shopping.noProductsFound", { store: PRODUCT_STORE_LABELS[productStore] })}
                                        </p>
                                        <button type="button" className="shop-bento-products__toggle font-headline" onClick={() => void handleRetryProducts(item.name)}>
                                          {t("shopping.retryProducts")}
                                        </button>
                                      </div>
                                    ) : (
                                      products.map((product) => (
                                        <div key={product.url} className="shop-bento-product-card">
                                          {product.image ? (
                                            <img src={product.image} alt={product.name} loading="lazy" />
                                          ) : (
                                            <div className="shop-bento-product-card__img-placeholder" aria-hidden>
                                              <span className="material-symbols-outlined">image</span>
                                            </div>
                                          )}
                                          <div className="shop-bento-product-card__body">
                                            <p className="shop-bento-product-card__name">{product.name}</p>
                                            <p className="shop-bento-product-card__price">{product.price || t("shopping.seeListing")}</p>
                                            <a
                                              className="shop-bento-product-card__link font-headline"
                                              href={product.url}
                                              target="_blank"
                                              rel="noreferrer"
                                            >
                                              {t("shopping.viewOnStore", { store: PRODUCT_STORE_LABELS[productStore] })}
                                            </a>
                                          </div>
                                        </div>
                                      ))
                                    )}
                                </div>
                                ) : null}
                              </div>
                            </div>
                          );
                        })}

                        {checkedRows.length ? (
                          <div className="shop-bento-checked-group">
                            <p className="shop-bento-checked-group__label font-headline">{t("shopping.alreadyHave")}</p>
                            {checkedRows.map(({ item, origIndex }) => {
                              const productsOpen = !!openProductsByIngredient[item.name];
                              const loadingProducts = !!productLoadingByIngredient[item.name];
                              const productError = productErrorByIngredient[item.name];
                              const products = productsByIngredient[item.name] ?? [];
                              return (
                                <div key={origIndex} className="shop-bento-row-block is-checked">
                                  <div className="shop-bento-row is-checked">
                                    <label style={{ display: "flex", alignItems: "center", gap: "1rem", cursor: "pointer", flex: 1, minWidth: 0 }}>
                                      <input
                                        type="checkbox"
                                        className="shop-bento-row__check"
                                        checked
                                        onChange={() => toggleSmartChecked(origIndex)}
                                        aria-label={t("shopping.markStillNeedToBuy", { name: item.name })}
                                      />
                                      <div className="shop-bento-row__text is-checked">
                                        <span className="shop-bento-row__state font-headline">{t("shopping.alreadyHave")}</span>
                                        <p className="shop-bento-row__name is-muted">{item.name}</p>
                                        {item.suggested_purchase ? (
                                          <p className="shop-bento-row__sub">{t("shopping.suggested", { value: item.suggested_purchase })}</p>
                                        ) : null}
                                      </div>
                                    </label>
                                    <div className="shop-bento-row__menu" ref={menuOpenFor === origIndex ? menuRef : undefined}>
                                      <button
                                        type="button"
                                        className="shop-bento-menu-btn"
                                        aria-label={t("shopping.more")}
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setMenuOpenFor((m) => (m === origIndex ? null : origIndex));
                                        }}
                                      >
                                        <span className="material-symbols-outlined">more_vert</span>
                                      </button>
                                      {menuOpenFor === origIndex && (
                                        <div className="shop-smart-dropdown font-headline">
                                          <button type="button" onClick={() => hideSmartItem(origIndex)}>
                                            {t("shopping.removeFromList")}
                                          </button>
                                        </div>
                                      )}
                                    </div>
                                  </div>

                                  <div className="shop-bento-products">
                                    <button
                                      type="button"
                                      className="shop-bento-products__toggle font-headline"
                                      onClick={() => handleToggleProducts(item.name)}
                                      disabled={loadingProducts}
                                    >
                                      {productsOpen ? t("shopping.hideProducts") : t("shopping.viewProducts")}
                                    </button>

                                    {productsOpen ? (
                                      <div className="shop-bento-products__panel">
                                        {loadingProducts ? (
                                          <p className="shop-bento-products__status">{t("shopping.loadingProducts")}</p>
                                        ) : productError ? (
                                          <div className="shop-bento-products__status">
                                            <p style={{ margin: 0 }}>{productError}</p>
                                            <button type="button" className="shop-bento-products__toggle font-headline" onClick={() => void handleRetryProducts(item.name)}>
                                              {t("shopping.retryProducts")}
                                            </button>
                                          </div>
                                        ) : products.length === 0 ? (
                                          <div className="shop-bento-products__status">
                                            <p style={{ margin: 0 }}>
                                              {t("shopping.noProductsFound", { store: PRODUCT_STORE_LABELS[productStore] })}
                                            </p>
                                            <button type="button" className="shop-bento-products__toggle font-headline" onClick={() => void handleRetryProducts(item.name)}>
                                              {t("shopping.retryProducts")}
                                            </button>
                                          </div>
                                        ) : (
                                          products.map((product) => (
                                            <div key={product.url} className="shop-bento-product-card">
                                              {product.image ? (
                                                <img src={product.image} alt={product.name} loading="lazy" />
                                              ) : (
                                                <div className="shop-bento-product-card__img-placeholder" aria-hidden>
                                                  <span className="material-symbols-outlined">image</span>
                                                </div>
                                              )}
                                              <div className="shop-bento-product-card__body">
                                                <p className="shop-bento-product-card__name">{product.name}</p>
                                                <p className="shop-bento-product-card__price">{product.price || t("shopping.seeListing")}</p>
                                                <a
                                                  className="shop-bento-product-card__link font-headline"
                                                  href={product.url}
                                                  target="_blank"
                                                  rel="noreferrer"
                                                >
                                                  {t("shopping.viewOnStore", { store: PRODUCT_STORE_LABELS[productStore] })}
                                                </a>
                                              </div>
                                            </div>
                                          ))
                                        )}
                                      </div>
                                    ) : null}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        ) : null}
                      </div>
                    </section>
                    );
                  })}
                </div>
              </div>

              <div
                className="shop-smart-actions-wrap"
                aria-busy={bulkLoadingProducts}
                aria-live={bulkLoadingProducts ? "polite" : undefined}
              >
                <div className="shop-smart-actions">
                  <button type="button" className="shop-smart-actions__secondary font-headline" onClick={handleCopyList}>
                    <span className="material-symbols-outlined">content_copy</span>
                    {copied ? "Copied!" : "Copy full list"}
                  </button>
                  <button
                    type="button"
                    className="shop-smart-actions__primary font-headline"
                    onClick={handleLoadAllProducts}
                    disabled={bulkLoadingProducts || smartItemCount === 0}
                  >
                    <span className="material-symbols-outlined">storefront</span>
                    {bulkLoadingProducts
                      ? `Loading picks from ${PRODUCT_STORE_LABELS[productStore]}…`
                      : `Load top picks from ${PRODUCT_STORE_LABELS[productStore]}`}
                  </button>
                </div>
                {bulkLoadingProducts && bulkLoadProgress ? (
                  <div className="shop-bulk-loading-banner font-headline" role="status">
                    <span className="shop-bulk-loading-banner__spinner" aria-hidden />
                    <span>
                      Loading store matches… {bulkLoadProgress.current} of {bulkLoadProgress.total}
                    </span>
                  </div>
                ) : null}
              </div>

              <div className="shop-smart-below-bento">
                {activeRefinedData.remove.length > 0 && (
                  <div className="shop-suggest-panel is-muted">
                    <button
                      type="button"
                      className="font-headline"
                      onClick={() => setSmartRemovedCollapsed((c) => !c)}
                      aria-expanded={!smartRemovedCollapsed}
                    >
                      <div className="shop-suggest-panel__left">
                        <span className="material-symbols-outlined">delete_sweep</span>
                        <div>
                          <h3>Removed items</h3>
                          <p>{activeRefinedData.remove.length} not purchased</p>
                        </div>
                      </div>
                      <span className="material-symbols-outlined" style={{ transform: smartRemovedCollapsed ? undefined : "rotate(180deg)" }}>
                        expand_more
                      </span>
                    </button>
                    {!smartRemovedCollapsed && (
                      <div style={{ padding: "0 1.5rem 1.25rem" }}>
                        {activeRefinedData.remove.map((name, i) => (
                          <p key={i} className="shop-row-title is-muted m-0 py-2" style={{ borderBottom: "1px solid var(--surface-container)" }}>
                            {name}
                          </p>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </>
          ) : (
            <>
              <section className="shop-confirm-hero">
                <div className="shop-confirm-hero__glow" aria-hidden />
                <div className="shop-confirm-hero__grid">
                  <div className="shop-confirm-hero__left">
                    <div className="shop-confirm-glance__head">
                      <h3 className="shop-confirm-glance__title font-headline">Your week at a glance</h3>
                      <span className="shop-confirm-glance__count font-headline">
                        {planRows.length} {planRows.length === 1 ? "recipe" : "recipes"} total
                      </span>
                    </div>
                    {!hasPlannedMeals ? (
                      <p className="shop-muted m-0">No recipe slots filled for this range yet.</p>
                    ) : (
                      <div>
                        <p className="shop-confirm-glance__hint">
                          Review the planned recipes below before generating your smart list.
                        </p>
                        {mealRowsVisible.map((row, idx) => (
                          <div key={`${row.date}-${row.slot}-${row.recipeId}-${idx}`} className="shop-confirm-meal">
                            <div>
                              <Link href={`/recipe/${row.recipeId}`} className="shop-confirm-meal__name shop-confirm-meal__link font-headline">
                                {row.title}
                              </Link>
                              <div className="shop-confirm-meal__chips">
                                <span className={chipClassForSlot(row.slot)}>{slotLabel(row.slot)}</span>
                                <span className="shop-confirm-chip shop-confirm-chip--day">{row.dayShort}</span>
                              </div>
                            </div>
                          </div>
                        ))}
                        {moreMealsCount > 0 && !planMealsExpanded ? (
                          <button
                            type="button"
                            className="shop-confirm-expand font-headline"
                            onClick={() => setPlanMealsExpanded(true)}
                          >
                            + {moreMealsCount} more {moreMealsCount === 1 ? "recipe" : "recipes"}
                          </button>
                        ) : null}
                        {planMealsExpanded && moreMealsCount > 0 ? (
                          <button
                            type="button"
                            className="shop-confirm-expand font-headline"
                            onClick={() => setPlanMealsExpanded(false)}
                          >
                            Show less
                          </button>
                        ) : null}
                      </div>
                    )}
                  </div>
                  <div className="shop-confirm-hero__right">
                    <h3 className="shop-confirm-aside__title font-headline">Is this the plan you want to shop for?</h3>
                    <div className="shop-confirm-stats">
                      <div className="shop-confirm-stat">
                        <span className="material-symbols-outlined">restaurant_menu</span>
                        <div>
                          <p className="shop-confirm-stat__val">{planRows.length} recipes</p>
                          <p className="shop-confirm-stat__sub">Planner confirmed</p>
                        </div>
                      </div>
                      <div className="shop-confirm-stat">
                        <span className="material-symbols-outlined">shopping_basket</span>
                        <div>
                          <p className="shop-confirm-stat__val">
                            ~{items.length} {items.length === 1 ? "ingredient" : "ingredients"}
                          </p>
                          <p className="shop-confirm-stat__sub">Unrefined raw list</p>
                        </div>
                      </div>
                    </div>
                    <div className="shop-confirm-quote">
                      <p>
                        We&apos;ll organize categories, merge duplicates, and suggest pantry staples once you generate the
                        smart list.
                      </p>
                    </div>
                    {refineError ? <p className="shop-error mb-4 m-0">{refineError}</p> : null}
                    <div className="shop-confirm-cta-row">
                      <button
                        type="button"
                        className="shop-confirm-primary font-headline"
                        onClick={handlePrepareSmartList}
                        disabled={!canPrepareSmart}
                      >
                        {refining ? "Preparing…" : "Prepare smart shopping list"}
                      </button>
                      <Link href={`/planner?week=${currentWeek}`} className="shop-confirm-back-planner font-headline">
                        Back to planner
                      </Link>
                    </div>
                    <div className="shop-confirm-hero-img-wrap">
                      <img
                        src={SHOP_CONFIRM_HERO_SRC}
                        alt="Fresh groceries and produce on a kitchen counter"
                        loading="lazy"
                      />
                    </div>
                  </div>
                </div>
              </section>

              <section className="shop-confirm-footer-hint" aria-hidden="false">
                <span className="material-symbols-outlined">auto_stories</span>
                <p>Awaiting your confirmation</p>
                <div className="shop-confirm-footer-hint__rule" />
              </section>
            </>
          )}
        </>
      )}
    </div>
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

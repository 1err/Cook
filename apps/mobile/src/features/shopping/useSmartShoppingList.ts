import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";
import { useFocusEffect } from "@react-navigation/native";
import {
  buildWeekMealPlanFingerprint,
  getWeekBounds,
  type MealPlanDay,
  plannerFingerprintStorageKey,
  type Recipe,
  type ShoppingListItem,
} from "@cooking/shared";
import { json, persistent } from "../../lib/storage";
import { useApiClient, type ApiClient } from "../../lib/api";
import {
  type RefineResponse,
  clearSmartList,
  clearSmartProducts,
  readSmartList,
  writeSmartList,
} from "./storage";

type WeekBounds = {
  start: string;
  end: string;
  dates: string[];
  weekParam: string;
};

type LoadedData = {
  items: ShoppingListItem[];
  mealPlans: MealPlanDay[];
  recipeById: Record<string, Recipe>;
  refinedData: RefineResponse | null;
  hidden: Set<number>;
  checked: Set<number>;
  savedFingerprint: string | null;
  smartListStale: boolean;
};

type State =
  | { status: "loading"; bounds: WeekBounds }
  | { status: "error"; bounds: WeekBounds; error: string }
  | { status: "ready"; bounds: WeekBounds; data: LoadedData; refining: boolean; refineError: string | null };

type Action =
  | { type: "weekChanged"; bounds: WeekBounds }
  | { type: "loaded"; bounds: WeekBounds; data: LoadedData }
  | { type: "loadFailed"; error: string }
  | { type: "refineStarted" }
  | { type: "refineFailed"; error: string }
  | { type: "refineSucceeded"; refinedData: RefineResponse; fingerprint: string }
  | { type: "setStale"; stale: boolean }
  | { type: "toggleChecked"; index: number }
  | { type: "hideItem"; index: number }
  | { type: "backToOriginal" };

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "weekChanged":
      return { status: "loading", bounds: action.bounds };
    case "loaded":
      if (action.bounds.weekParam !== state.bounds.weekParam) return state;
      return {
        status: "ready",
        bounds: action.bounds,
        data: action.data,
        refining: false,
        refineError: null,
      };
    case "loadFailed":
      if (state.status !== "loading") return state;
      return { status: "error", bounds: state.bounds, error: action.error };
    case "refineStarted":
      if (state.status !== "ready") return state;
      return { ...state, refining: true, refineError: null };
    case "refineFailed":
      if (state.status !== "ready") return state;
      return { ...state, refining: false, refineError: action.error };
    case "refineSucceeded":
      if (state.status !== "ready") return state;
      return {
        ...state,
        refining: false,
        refineError: null,
        data: {
          ...state.data,
          refinedData: action.refinedData,
          hidden: new Set(),
          checked: new Set(),
          savedFingerprint: action.fingerprint,
          smartListStale: false,
        },
      };
    case "setStale":
      if (state.status !== "ready") return state;
      if (state.data.smartListStale === action.stale) return state;
      return { ...state, data: { ...state.data, smartListStale: action.stale } };
    case "toggleChecked": {
      if (state.status !== "ready") return state;
      const next = new Set(state.data.checked);
      if (next.has(action.index)) next.delete(action.index);
      else next.add(action.index);
      return { ...state, data: { ...state.data, checked: next } };
    }
    case "hideItem": {
      if (state.status !== "ready") return state;
      const next = new Set(state.data.hidden);
      next.add(action.index);
      return { ...state, data: { ...state.data, hidden: next } };
    }
    case "backToOriginal": {
      if (state.status !== "ready") return state;
      return {
        ...state,
        data: {
          ...state.data,
          refinedData: null,
          hidden: new Set(),
          checked: new Set(),
          savedFingerprint: null,
          smartListStale: false,
        },
      };
    }
  }
}

async function fetchAll(apiClient: ApiClient, bounds: WeekBounds) {
  const [items, mealPlans, recipes] = await Promise.all([
    apiClient.shopping.list(bounds.start, bounds.end),
    apiClient.mealPlan.list(bounds.start, bounds.end),
    apiClient.recipes.list(),
  ]);
  return { items, mealPlans, recipes };
}

export function useSmartShoppingList(weekStart: string | undefined) {
  const apiClient = useApiClient();
  const initialBounds = useMemo(() => getWeekBounds(weekStart), [weekStart]);
  const [state, dispatch] = useReducer(reducer, {
    status: "loading",
    bounds: initialBounds,
  } as State);
  const stateRef = useRef(state);
  stateRef.current = state;

  // React to weekStart changes.
  useEffect(() => {
    dispatch({ type: "weekChanged", bounds: initialBounds });
  }, [initialBounds]);

  // Load whenever bounds changed and status is loading.
  useEffect(() => {
    if (state.status !== "loading") return;
    let cancelled = false;
    const bounds = state.bounds;
    void (async () => {
      try {
        const { items, mealPlans, recipes } = await fetchAll(apiClient, bounds);
        if (cancelled) return;
        const recipeById: Record<string, Recipe> = {};
        for (const r of recipes) recipeById[r.id] = r;
        const currentFingerprint = buildWeekMealPlanFingerprint(bounds.dates, mealPlans);
        const cached = await readSmartList(bounds.start);
        const refinedData = cached?.data ?? null;
        const hidden = cached?.hidden ?? new Set<number>();
        const checked = cached?.checked ?? new Set<number>();
        const savedFingerprint = cached?.plannerFingerprint ?? null;
        const smartListStale = Boolean(savedFingerprint && savedFingerprint !== currentFingerprint);
        if (cancelled) return;
        dispatch({
          type: "loaded",
          bounds,
          data: {
            items,
            mealPlans,
            recipeById,
            refinedData,
            hidden,
            checked,
            savedFingerprint,
            smartListStale,
          },
        });
      } catch (e) {
        if (cancelled) return;
        dispatch({
          type: "loadFailed",
          error: e instanceof Error ? e.message : "Failed to load shopping list",
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [apiClient, state.status, state.bounds]);

  // Persist smart list whenever the user toggles hidden/checked.
  useEffect(() => {
    if (state.status !== "ready") return;
    const { refinedData, hidden, checked, savedFingerprint } = state.data;
    if (!refinedData || !savedFingerprint) return;
    void writeSmartList(state.bounds.start, refinedData, hidden, checked, savedFingerprint);
  }, [state]);

  // On focus, recompute stale flag against the latest persistent planner fingerprint.
  useFocusEffect(
    useCallback(() => {
      const current = stateRef.current;
      if (current.status !== "ready") return;
      const { refinedData, savedFingerprint } = current.data;
      if (!refinedData || !savedFingerprint) return;
      void (async () => {
        const persisted = await json.get<string>(
          persistent,
          plannerFingerprintStorageKey(current.bounds.start),
        );
        // Fallback to currently-loaded mealPlans if persistent is unset.
        const fallback = buildWeekMealPlanFingerprint(current.bounds.dates, current.data.mealPlans);
        const reference = persisted ?? fallback;
        dispatch({ type: "setStale", stale: reference !== savedFingerprint });
      })();
    }, []),
  );

  const prepareSmartList = useCallback(async () => {
    const current = stateRef.current;
    if (current.status !== "ready") return;
    dispatch({ type: "refineStarted" });
    try {
      const [items, mealPlans] = await Promise.all([
        apiClient.shopping.list(current.bounds.start, current.bounds.end),
        apiClient.mealPlan.list(current.bounds.start, current.bounds.end),
      ]);
      const fingerprint = buildWeekMealPlanFingerprint(current.bounds.dates, mealPlans);
      const refined = await apiClient.shopping.refine(
        items.map((i) => ({ name: i.name, quantity: i.total_quantity })),
      );
      dispatch({ type: "refineSucceeded", refinedData: refined, fingerprint });
      await clearSmartProducts(current.bounds.start);
      await writeSmartList(current.bounds.start, refined, new Set(), new Set(), fingerprint);
    } catch (e) {
      dispatch({
        type: "refineFailed",
        error: e instanceof Error ? e.message : "Refine failed",
      });
    }
  }, [apiClient]);

  const backToOriginal = useCallback(async () => {
    const current = stateRef.current;
    if (current.status !== "ready") return;
    await clearSmartList(current.bounds.start);
    await clearSmartProducts(current.bounds.start);
    dispatch({ type: "backToOriginal" });
  }, []);

  const toggleChecked = useCallback((index: number) => dispatch({ type: "toggleChecked", index }), []);
  const hideItem = useCallback((index: number) => dispatch({ type: "hideItem", index }), []);

  const refresh = useCallback(() => {
    const current = stateRef.current;
    dispatch({ type: "weekChanged", bounds: current.bounds });
  }, []);

  return {
    state,
    refresh,
    prepareSmartList,
    backToOriginal,
    toggleChecked,
    hideItem,
  };
}

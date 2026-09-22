import { resolveRecipeDetails } from "@cooking/api-client";
import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";
import { useFocusEffect } from "@react-navigation/native";
import {
  buildWeekMealPlanFingerprint,
  normalizeMealPlanSlots,
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
  previewUnavailable?: boolean;
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
  | { type: "loadFailed"; bounds: WeekBounds; error: string }
  | { type: "refineStarted"; weekStart: string }
  | { type: "refineFailed"; weekStart: string; error: string }
  | { type: "refineSucceeded"; weekStart: string; refinedData: RefineResponse; fingerprint: string; items: ShoppingListItem[]; mealPlans: MealPlanDay[] }
  | { type: "backStarted"; weekStart: string }
  | { type: "setStale"; weekStart: string; stale: boolean }
  | { type: "toggleChecked"; index: number }
  | { type: "hideItem"; index: number }
  | { type: "backToOriginal"; weekStart: string };

export type SmartListMutationResult =
  | { status: "succeeded"; weekStart: string }
  | { status: "failed"; weekStart: string; error: string }
  | { status: "stale"; weekStart: string };

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
      if (state.status !== "loading" || state.bounds.start !== action.bounds.start) return state;
      return { status: "error", bounds: state.bounds, error: action.error };
    case "refineStarted":
      if (state.status !== "ready" || state.bounds.start !== action.weekStart) return state;
      return { ...state, refining: true, refineError: null };
    case "refineFailed":
      if (state.status !== "ready" || state.bounds.start !== action.weekStart) return state;
      return { ...state, refining: false, refineError: action.error };
    case "refineSucceeded":
      if (state.status !== "ready" || state.bounds.start !== action.weekStart) return state;
      return {
        ...state,
        refining: false,
        refineError: null,
        data: {
          ...state.data,
          refinedData: action.refinedData,
          items: action.items,
          mealPlans: action.mealPlans,
          previewUnavailable: false,
          hidden: new Set(),
          checked: new Set(),
          savedFingerprint: action.fingerprint,
          smartListStale: false,
        },
      };
    case "backStarted":
      if (state.status !== "ready" || state.bounds.start !== action.weekStart) return state;
      return { ...state, refining: false, refineError: null };
    case "setStale":
      if (state.status !== "ready" || state.bounds.start !== action.weekStart) return state;
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
      if (state.status !== "ready" || state.bounds.start !== action.weekStart) return state;
      return {
        ...state,
        refining: false,
        refineError: null,
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
  let previewUnavailable = false;
  const [items, mealPlans] = await Promise.all([
    apiClient.shopping.list(bounds.start, bounds.end),
    apiClient.mealPlan.list(bounds.start, bounds.end).catch(() => {
      previewUnavailable = true;
      return [] as MealPlanDay[];
    }),
  ]);
  const recipes = await resolveRecipeDetails(apiClient.recipes.get, mealPlans.flatMap(plan => Object.values(normalizeMealPlanSlots(plan)).flat())).catch(() => {
    previewUnavailable = true;
    return [] as Recipe[];
  });
  return { items, mealPlans, recipes, previewUnavailable };
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
  const mutationGenerationRef = useRef(0);
  const requestedWeekStartRef = useRef(initialBounds.start);
  if (requestedWeekStartRef.current !== initialBounds.start) {
    requestedWeekStartRef.current = initialBounds.start;
    mutationGenerationRef.current += 1;
  }

  const mutationIsCurrent = useCallback((week: string, generation: number) => {
    const current = stateRef.current;
    return (
      mutationGenerationRef.current === generation
      && requestedWeekStartRef.current === week
      && current.status === "ready"
      && current.bounds.start === week
    );
  }, []);

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
        const { items, mealPlans, recipes, previewUnavailable } = await fetchAll(apiClient, bounds);
        if (cancelled) return;
        const recipeById: Record<string, Recipe> = {};
        for (const r of recipes) recipeById[r.id] = r;
        const currentFingerprint = buildWeekMealPlanFingerprint(bounds.dates, mealPlans);
        const cached = await readSmartList(bounds.start);
        const refinedData = cached?.data ?? null;
        const hidden = cached?.hidden ?? new Set<number>();
        const checked = cached?.checked ?? new Set<number>();
        const savedFingerprint = cached?.plannerFingerprint ?? null;
        const smartListStale = previewUnavailable || Boolean(savedFingerprint && savedFingerprint !== currentFingerprint);
        if (cancelled) return;
        dispatch({
          type: "loaded",
          bounds,
          data: {
            items,
            mealPlans,
            recipeById,
            previewUnavailable,
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
          bounds,
          error: e instanceof Error ? e.message : "Failed to load shopping list",
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [apiClient, state.status, state.bounds]);

  const persistWeekStart = state.status === "ready" ? state.bounds.start : null;
  const persistRefinedData = state.status === "ready" ? state.data.refinedData : null;
  const persistHidden = state.status === "ready" ? state.data.hidden : null;
  const persistChecked = state.status === "ready" ? state.data.checked : null;
  const persistFingerprint = state.status === "ready" ? state.data.savedFingerprint : null;

  // Persist smart-list content changes, not transient refining/error/staleness state.
  useEffect(() => {
    if (
      !persistWeekStart
      || !persistRefinedData
      || !persistHidden
      || !persistChecked
      || !persistFingerprint
    ) return;
    void writeSmartList(
      persistWeekStart,
      persistRefinedData,
      persistHidden,
      persistChecked,
      persistFingerprint,
    );
  }, [
    persistChecked,
    persistFingerprint,
    persistHidden,
    persistRefinedData,
    persistWeekStart,
  ]);

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
        dispatch({
          type: "setStale",
          weekStart: current.bounds.start,
          stale: Boolean(current.data.previewUnavailable) || reference !== savedFingerprint,
        });
      })();
    }, []),
  );

  const prepareSmartList = useCallback(async (): Promise<SmartListMutationResult> => {
    const current = stateRef.current;
    const originWeek = current.bounds.start;
    if (
      current.status !== "ready"
      || requestedWeekStartRef.current !== originWeek
    ) {
      return { status: "stale", weekStart: originWeek };
    }
    const generation = mutationGenerationRef.current + 1;
    mutationGenerationRef.current = generation;
    dispatch({ type: "refineStarted", weekStart: originWeek });
    try {
      const [items, mealPlans] = await Promise.all([
        apiClient.shopping.list(current.bounds.start, current.bounds.end),
        apiClient.mealPlan.list(current.bounds.start, current.bounds.end),
      ]);
      if (!mutationIsCurrent(originWeek, generation)) {
        return { status: "stale", weekStart: originWeek };
      }
      const fingerprint = buildWeekMealPlanFingerprint(current.bounds.dates, mealPlans);
      const refined = await apiClient.shopping.refine(
        items.map((i) => ({ name: i.name, quantity: i.total_quantity })),
      );
      if (!mutationIsCurrent(originWeek, generation)) {
        return { status: "stale", weekStart: originWeek };
      }
      await clearSmartProducts(current.bounds.start);
      if (!mutationIsCurrent(originWeek, generation)) {
        return { status: "stale", weekStart: originWeek };
      }
      await writeSmartList(current.bounds.start, refined, new Set(), new Set(), fingerprint);
      if (!mutationIsCurrent(originWeek, generation)) {
        return { status: "stale", weekStart: originWeek };
      }
      dispatch({
        type: "refineSucceeded",
        weekStart: originWeek,
        refinedData: refined,
        fingerprint,
        items,
        mealPlans,
      });
      return { status: "succeeded", weekStart: originWeek };
    } catch (e) {
      if (!mutationIsCurrent(originWeek, generation)) {
        return { status: "stale", weekStart: originWeek };
      }
      const error = e instanceof Error ? e.message : "Refine failed";
      dispatch({
        type: "refineFailed",
        weekStart: originWeek,
        error,
      });
      return { status: "failed", weekStart: originWeek, error };
    }
  }, [apiClient, mutationIsCurrent]);

  const backToOriginal = useCallback(async (): Promise<SmartListMutationResult> => {
    const current = stateRef.current;
    const originWeek = current.bounds.start;
    if (
      current.status !== "ready"
      || requestedWeekStartRef.current !== originWeek
    ) {
      return { status: "stale", weekStart: originWeek };
    }
    const generation = mutationGenerationRef.current + 1;
    mutationGenerationRef.current = generation;
    dispatch({ type: "backStarted", weekStart: originWeek });
    try {
      await clearSmartList(originWeek);
      if (!mutationIsCurrent(originWeek, generation)) {
        return { status: "stale", weekStart: originWeek };
      }
      await clearSmartProducts(originWeek);
      if (!mutationIsCurrent(originWeek, generation)) {
        return { status: "stale", weekStart: originWeek };
      }
      dispatch({ type: "backToOriginal", weekStart: originWeek });
      return { status: "succeeded", weekStart: originWeek };
    } catch (e) {
      if (!mutationIsCurrent(originWeek, generation)) {
        return { status: "stale", weekStart: originWeek };
      }
      const error = e instanceof Error ? e.message : "Couldn't return to the original list";
      return { status: "failed", weekStart: originWeek, error };
    }
  }, [mutationIsCurrent]);

  const toggleChecked = useCallback((index: number) => dispatch({ type: "toggleChecked", index }), []);
  const hideItem = useCallback((index: number) => dispatch({ type: "hideItem", index }), []);

  const refresh = useCallback(() => {
    const current = stateRef.current;
    mutationGenerationRef.current += 1;
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

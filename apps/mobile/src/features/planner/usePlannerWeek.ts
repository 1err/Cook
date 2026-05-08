import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";
import {
  buildWeekMealPlanFingerprint,
  emptyMealPlanSlots,
  getPrevNextWeek,
  getWeekBounds,
  type MealPlanDay,
  type MealPlanSlots,
  type MealType,
  normalizeMealPlanSlots,
  plannerFingerprintStorageKey,
  type Recipe,
} from "@cooking/shared";
import { useApiClient, type ApiClient } from "../../lib/api";
import { json, persistent } from "../../lib/storage";
import { haptics } from "../../lib/haptics";

type WeekBounds = {
  start: string;
  end: string;
  dates: string[];
  weekParam: string;
};

type ReadyData = {
  recipes: Recipe[];
  planByDate: Record<string, MealPlanSlots>;
  bounds: WeekBounds;
};

type State =
  | { status: "loading"; bounds: WeekBounds }
  | { status: "error"; bounds: WeekBounds; error: string }
  | { status: "ready" | "refreshing"; bounds: WeekBounds; data: ReadyData };

type Action =
  | { type: "weekChanged"; bounds: WeekBounds }
  | { type: "refreshStarted" }
  | { type: "loaded"; recipes: Recipe[]; plans: MealPlanDay[]; bounds: WeekBounds }
  | { type: "loadFailed"; error: string }
  | { type: "applyPlan"; date: string; slots: MealPlanSlots };

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "weekChanged":
      return { status: "loading", bounds: action.bounds };
    case "refreshStarted":
      if (state.status === "ready") {
        return { status: "refreshing", bounds: state.bounds, data: state.data };
      }
      return state;
    case "loaded": {
      // Discard stale loads if the week was changed mid-flight.
      if (action.bounds.weekParam !== state.bounds.weekParam) return state;
      const planByDate: Record<string, MealPlanSlots> = {};
      for (const date of action.bounds.dates) {
        planByDate[date] = emptyMealPlanSlots();
      }
      for (const plan of action.plans) {
        planByDate[plan.date] = normalizeMealPlanSlots(plan);
      }
      return {
        status: "ready",
        bounds: action.bounds,
        data: { recipes: action.recipes, planByDate, bounds: action.bounds },
      };
    }
    case "loadFailed":
      if (state.status === "loading" || state.status === "refreshing") {
        return { status: "error", bounds: state.bounds, error: action.error };
      }
      return state;
    case "applyPlan": {
      if (state.status !== "ready" && state.status !== "refreshing") return state;
      const nextPlanByDate = { ...state.data.planByDate, [action.date]: action.slots };
      return {
        ...state,
        data: { ...state.data, planByDate: nextPlanByDate },
      };
    }
  }
}

async function fetchWeek(apiClient: ApiClient, bounds: WeekBounds) {
  const [plans, recipes] = await Promise.all([
    apiClient.mealPlan.list(bounds.start, bounds.end),
    apiClient.recipes.list(),
  ]);
  return { plans, recipes };
}

async function writeFingerprint(bounds: WeekBounds, planByDate: Record<string, MealPlanSlots>) {
  const synthetic: MealPlanDay[] = bounds.dates.map((date) => ({
    date,
    ...(planByDate[date] ?? emptyMealPlanSlots()),
  }));
  const fingerprint = buildWeekMealPlanFingerprint(bounds.dates, synthetic);
  await json.set(persistent, plannerFingerprintStorageKey(bounds.start), fingerprint);
}

export type UsePlannerWeekResult = {
  state: State;
  refresh: () => Promise<void>;
  addRecipeToSlot: (date: string, slot: MealType, recipeId: string) => Promise<void>;
  removeRecipeFromSlot: (date: string, slot: MealType, recipeId: string) => Promise<void>;
  prev: string;
  next: string;
  today: string;
};

export function usePlannerWeek(weekStart: string | undefined): UsePlannerWeekResult {
  const apiClient = useApiClient();
  const initialBounds = useMemo(() => getWeekBounds(weekStart), [weekStart]);
  const [state, dispatch] = useReducer(reducer, { status: "loading", bounds: initialBounds } as State);
  const stateRef = useRef(state);
  stateRef.current = state;

  // React to weekStart changes from route params.
  useEffect(() => {
    dispatch({ type: "weekChanged", bounds: initialBounds });
  }, [initialBounds]);

  // Load whenever the bounds change (after weekChanged dispatches above).
  useEffect(() => {
    let cancelled = false;
    const bounds = state.bounds;
    if (state.status !== "loading") return;
    void (async () => {
      try {
        const { plans, recipes } = await fetchWeek(apiClient, bounds);
        if (cancelled) return;
        dispatch({ type: "loaded", recipes, plans, bounds });
        const planByDate: Record<string, MealPlanSlots> = {};
        for (const date of bounds.dates) planByDate[date] = emptyMealPlanSlots();
        for (const plan of plans) planByDate[plan.date] = normalizeMealPlanSlots(plan);
        await writeFingerprint(bounds, planByDate);
      } catch (e) {
        if (cancelled) return;
        dispatch({ type: "loadFailed", error: e instanceof Error ? e.message : "Failed to load planner" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [apiClient, state.bounds, state.status]);

  const refresh = useCallback(async () => {
    const current = stateRef.current;
    if (current.status === "loading") return;
    dispatch({ type: "refreshStarted" });
    try {
      const { plans, recipes } = await fetchWeek(apiClient, current.bounds);
      dispatch({ type: "loaded", recipes, plans, bounds: current.bounds });
      const planByDate: Record<string, MealPlanSlots> = {};
      for (const date of current.bounds.dates) planByDate[date] = emptyMealPlanSlots();
      for (const plan of plans) planByDate[plan.date] = normalizeMealPlanSlots(plan);
      await writeFingerprint(current.bounds, planByDate);
    } catch (e) {
      dispatch({ type: "loadFailed", error: e instanceof Error ? e.message : "Refresh failed" });
    }
  }, [apiClient]);

  const mutateSlot = useCallback(
    async (date: string, slot: MealType, mutate: (current: string[]) => string[]) => {
      const current = stateRef.current;
      if (current.status !== "ready" && current.status !== "refreshing") return;
      const previousSlots = current.data.planByDate[date] ?? emptyMealPlanSlots();
      const nextSlots: MealPlanSlots = {
        ...previousSlots,
        [slot]: mutate(previousSlots[slot]),
      };
      // Optimistic update.
      dispatch({ type: "applyPlan", date, slots: nextSlots });
      try {
        const updated = await apiClient.mealPlan.updateDay(date, {
          breakfast: nextSlots.breakfast,
          lunch: nextSlots.lunch,
          dinner: nextSlots.dinner,
        });
        // Server may have normalized; trust it.
        dispatch({ type: "applyPlan", date, slots: normalizeMealPlanSlots(updated) });
        const after = stateRef.current;
        if (after.status === "ready" || after.status === "refreshing") {
          await writeFingerprint(after.bounds, after.data.planByDate);
        }
        haptics.success();
      } catch (e) {
        // Revert.
        dispatch({ type: "applyPlan", date, slots: previousSlots });
        haptics.error();
        throw e;
      }
    },
    [apiClient],
  );

  const addRecipeToSlot = useCallback(
    (date: string, slot: MealType, recipeId: string) =>
      mutateSlot(date, slot, (cur) => (cur.includes(recipeId) ? cur : [...cur, recipeId])),
    [mutateSlot],
  );

  const removeRecipeFromSlot = useCallback(
    (date: string, slot: MealType, recipeId: string) =>
      mutateSlot(date, slot, (cur) => cur.filter((id) => id !== recipeId)),
    [mutateSlot],
  );

  const { prev, next } = useMemo(() => getPrevNextWeek(state.bounds.start), [state.bounds.start]);

  const today = useMemo(() => getWeekBounds(undefined).weekParam, []);

  return {
    state,
    refresh,
    addRecipeToSlot,
    removeRecipeFromSlot,
    prev,
    next,
    today,
  };
}

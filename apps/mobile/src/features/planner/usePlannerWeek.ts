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
  | { type: "refreshFinished" }
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
    case "refreshFinished":
      return state.status === "refreshing" ? { ...state, status: "ready" } : state;
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
  const [state, dispatchReducer] = useReducer(reducer, { status: "loading", bounds: initialBounds } as State);
  const stateRef = useRef(state);
  stateRef.current = state;
  const dispatch = useCallback((action: Action) => {
    stateRef.current = reducer(stateRef.current, action);
    dispatchReducer(action);
  }, []);
  type Operation = {
    apply: (slots: MealPlanSlots) => MealPlanSlots;
    resolve: () => void;
    reject: (error: unknown) => void;
    finished: Promise<void>;
  };
  type DayQueue = { confirmed: MealPlanSlots; operations: Operation[]; running: boolean };
  const queues = useRef(new Map<string, DayQueue>());
  const mutationRevision = useRef(0);

  useEffect(() => () => {
    for (const queue of queues.current.values()) {
      for (const operation of queue.operations) operation.reject(new Error("Planner update cancelled"));
    }
    queues.current.clear();
  }, [apiClient]);

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
        const planByDate: Record<string, MealPlanSlots> = {};
        for (const date of bounds.dates) planByDate[date] = emptyMealPlanSlots();
        for (const plan of plans) planByDate[plan.date] = normalizeMealPlanSlots(plan);
        for (const [date, queue] of queues.current) {
          if (!bounds.dates.includes(date)) {
            if (queue.operations.length === 0) queues.current.delete(date);
          } else if (queue.operations.length === 0) {
            queue.confirmed = planByDate[date];
          } else {
            planByDate[date] = queue.operations.reduce((slots, operation) => operation.apply(slots), queue.confirmed);
          }
        }
        dispatch({ type: "loaded", recipes, plans: bounds.dates.map((date) => ({ date, ...planByDate[date] })), bounds });
        await writeFingerprint(bounds, planByDate).catch(() => {});
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
    await Promise.allSettled([...queues.current.values()].flatMap((queue) => queue.operations.map((operation) => operation.finished)));
    const current = stateRef.current;
    if (current.status === "loading") return;
    const revision = mutationRevision.current;
    dispatch({ type: "refreshStarted" });
    try {
      const { plans, recipes } = await fetchWeek(apiClient, current.bounds);
      if (stateRef.current.bounds.weekParam !== current.bounds.weekParam) return;
      if (revision !== mutationRevision.current) {
        dispatch({ type: "refreshFinished" });
        return;
      }
      dispatch({ type: "loaded", recipes, plans, bounds: current.bounds });
      const planByDate: Record<string, MealPlanSlots> = {};
      for (const date of current.bounds.dates) planByDate[date] = emptyMealPlanSlots();
      for (const plan of plans) planByDate[plan.date] = normalizeMealPlanSlots(plan);
      for (const date of current.bounds.dates) {
        const queue = queues.current.get(date);
        if (queue && queue.operations.length === 0) queue.confirmed = planByDate[date];
      }
      await writeFingerprint(current.bounds, planByDate).catch(() => {});
    } catch (e) {
      if (stateRef.current.bounds.weekParam !== current.bounds.weekParam) return;
      if (revision !== mutationRevision.current) {
        dispatch({ type: "refreshFinished" });
        return;
      }
      dispatch({ type: "loadFailed", error: e instanceof Error ? e.message : "Refresh failed" });
    }
  }, [apiClient]);

  const mutateSlot = useCallback(
    (date: string, slot: MealType, mutate: (current: string[]) => string[]): Promise<void> => {
      const current = stateRef.current;
      if (current.status !== "ready" && current.status !== "refreshing") return Promise.resolve();
      let queue = queues.current.get(date);
      if (!queue) {
        queue = { confirmed: current.data.planByDate[date] ?? emptyMealPlanSlots(), operations: [], running: false };
        queues.current.set(date, queue);
      }
      const ownedQueue = queue;
      mutationRevision.current += 1;
      let resolve!: () => void;
      let reject!: (error: unknown) => void;
      const finished = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
      ownedQueue.operations.push({ apply: (slots) => ({ ...slots, [slot]: mutate(slots[slot]) }), resolve, reject, finished });

      function paint() {
        if (queues.current.get(date) !== ownedQueue || !stateRef.current.bounds.dates.includes(date)) return;
        const slots = ownedQueue.operations.reduce((value, operation) => operation.apply(value), ownedQueue.confirmed);
        dispatch({ type: "applyPlan", date, slots });
      }

      async function flush() {
        if (ownedQueue.running || queues.current.get(date) !== ownedQueue) return;
        ownedQueue.running = true;
        while (ownedQueue.operations.length > 0 && queues.current.get(date) === ownedQueue) {
          const operation = ownedQueue.operations[0];
          try {
            const updated = await apiClient.mealPlan.updateDay(date, operation.apply(ownedQueue.confirmed));
            if (queues.current.get(date) !== ownedQueue) return;
            ownedQueue.confirmed = normalizeMealPlanSlots(updated);
            ownedQueue.operations.shift();
            paint();
            haptics.success();
            operation.resolve();
          } catch (error) {
            if (queues.current.get(date) !== ownedQueue) return;
            ownedQueue.operations.shift();
            paint();
            haptics.error();
            operation.reject(error);
          }
          const after = stateRef.current;
          if ((after.status === "ready" || after.status === "refreshing") && after.bounds.dates.includes(date)) {
            await writeFingerprint(after.bounds, after.data.planByDate).catch(() => {});
          }
        }
        ownedQueue.running = false;
      }

      paint();
      void flush();
      return finished;
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

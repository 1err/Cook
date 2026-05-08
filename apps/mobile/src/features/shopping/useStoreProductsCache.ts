import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import type { StoreProduct } from "@cooking/api-client";
import type { ProductStore } from "@cooking/shared";
import { useApiClient, type ApiClient } from "../../lib/api";
import {
  readSmartProducts,
  type SmartProductsStored,
  writeSmartProducts,
} from "./storage";

type State = {
  store: ProductStore;
  open: Record<string, boolean>;
  products: Record<string, StoreProduct[]>;
  loading: Record<string, boolean>;
  errors: Record<string, string | null>;
};

type Action =
  | { type: "setStore"; store: ProductStore }
  | { type: "hydrate"; payload: SmartProductsStored }
  | { type: "clear" }
  | { type: "setOpen"; key: string; open: boolean }
  | { type: "setOpenMany"; keys: string[] }
  | { type: "loadStarted"; key: string }
  | { type: "loadSucceeded"; key: string; products: StoreProduct[] }
  | { type: "loadFailed"; key: string; error: string };

const emptyMaps = () => ({
  open: {} as Record<string, boolean>,
  products: {} as Record<string, StoreProduct[]>,
  loading: {} as Record<string, boolean>,
  errors: {} as Record<string, string | null>,
});

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "setStore":
      if (state.store === action.store) return state;
      return { store: action.store, ...emptyMaps() };
    case "hydrate":
      return {
        ...state,
        open: action.payload.open,
        products: action.payload.products,
        loading: {},
        errors: action.payload.errors,
      };
    case "clear":
      return { ...state, ...emptyMaps() };
    case "setOpen":
      return { ...state, open: { ...state.open, [action.key]: action.open } };
    case "setOpenMany": {
      if (action.keys.length === 0) return state;
      const next = { ...state.open };
      action.keys.forEach((key) => {
        next[key] = true;
      });
      return { ...state, open: next };
    }
    case "loadStarted":
      return {
        ...state,
        loading: { ...state.loading, [action.key]: true },
        errors: { ...state.errors, [action.key]: null },
      };
    case "loadSucceeded":
      return {
        ...state,
        loading: { ...state.loading, [action.key]: false },
        products: { ...state.products, [action.key]: action.products },
      };
    case "loadFailed":
      return {
        ...state,
        loading: { ...state.loading, [action.key]: false },
        errors: { ...state.errors, [action.key]: action.error },
      };
  }
}

async function fetchProducts(
  apiClient: ApiClient,
  query: string,
  store: ProductStore,
): Promise<StoreProduct[]> {
  const data = await apiClient.shopping.storeProducts(query, store);
  if (!Array.isArray(data)) return [];
  return data
    .filter(
      (row): row is StoreProduct =>
        !!row &&
        typeof row.name === "string" &&
        typeof row.price === "string" &&
        typeof row.image === "string" &&
        typeof row.url === "string",
    )
    .slice(0, 3);
}

const BULK_LOAD_CONCURRENCY = 3;

export type BulkLoadingState = { active: boolean; done: number; total: number };

export function useStoreProductsCache(weekStart: string | null) {
  const apiClient = useApiClient();
  const [state, dispatch] = useReducer(reducer, {
    store: "weee" as ProductStore,
    ...emptyMaps(),
  });
  const storeRef = useRef<ProductStore>(state.store);
  storeRef.current = state.store;

  const stateRef = useRef(state);
  stateRef.current = state;

  const [bulkLoading, setBulkLoading] = useState<BulkLoadingState>({
    active: false,
    done: 0,
    total: 0,
  });

  // Hydrate from ephemeral whenever the (week, store) pair changes.
  useEffect(() => {
    if (!weekStart) {
      dispatch({ type: "clear" });
      return;
    }
    let cancelled = false;
    void (async () => {
      const cached = await readSmartProducts(weekStart, state.store);
      if (cancelled) return;
      if (cached) dispatch({ type: "hydrate", payload: cached });
      else dispatch({ type: "clear" });
    })();
    return () => {
      cancelled = true;
    };
  }, [weekStart, state.store]);

  // Persist on every change.
  useEffect(() => {
    if (!weekStart) return;
    void writeSmartProducts(weekStart, state.store, {
      open: state.open,
      products: state.products,
      errors: state.errors,
    });
  }, [weekStart, state.store, state.open, state.products, state.errors]);

  const loadOne = useCallback(
    async (key: string, storeAtStart: ProductStore, force: boolean) => {
      const snapshot = stateRef.current;
      const alreadyLoaded = snapshot.products[key] !== undefined && !snapshot.errors[key];
      const inFlight = snapshot.loading[key];
      if (!force && (alreadyLoaded || inFlight)) return;
      dispatch({ type: "loadStarted", key });
      try {
        const products = await fetchProducts(apiClient, key, storeAtStart);
        if (storeRef.current !== storeAtStart) return;
        dispatch({ type: "loadSucceeded", key, products });
      } catch (e) {
        if (storeRef.current !== storeAtStart) return;
        dispatch({
          type: "loadFailed",
          key,
          error: e instanceof Error ? e.message : "Failed to load products",
        });
      }
    },
    [apiClient],
  );

  const ensureLoaded = useCallback(
    async (rawName: string, force = false) => {
      const key = rawName.trim();
      if (!key) return;
      await loadOne(key, storeRef.current, force);
    },
    [loadOne],
  );

  const togglePanel = useCallback(
    async (rawName: string) => {
      const key = rawName.trim();
      if (!key) return;
      const isOpen = !!stateRef.current.open[key];
      dispatch({ type: "setOpen", key, open: !isOpen });
      if (!isOpen) await ensureLoaded(key);
    },
    [ensureLoaded],
  );

  const openMany = useCallback((rawNames: string[]) => {
    const keys = rawNames.map((n) => n.trim()).filter(Boolean);
    if (keys.length === 0) return;
    dispatch({ type: "setOpenMany", keys });
  }, []);

  const loadAll = useCallback(
    async (rawNames: string[]) => {
      const keys = Array.from(new Set(rawNames.map((n) => n.trim()).filter(Boolean)));
      if (keys.length === 0) return;
      const storeAtStart = storeRef.current;
      setBulkLoading({ active: true, done: 0, total: keys.length });

      const queue = [...keys];
      let doneCount = 0;

      const worker = async () => {
        while (queue.length > 0) {
          if (storeRef.current !== storeAtStart) return;
          const key = queue.shift();
          if (!key) return;
          await loadOne(key, storeAtStart, false);
          doneCount += 1;
          setBulkLoading({ active: true, done: doneCount, total: keys.length });
        }
      };

      const workers = Array.from({ length: Math.min(BULK_LOAD_CONCURRENCY, keys.length) }, worker);
      await Promise.all(workers);
      setBulkLoading({ active: false, done: doneCount, total: keys.length });
    },
    [loadOne],
  );

  const setStore = useCallback((next: ProductStore) => {
    dispatch({ type: "setStore", store: next });
  }, []);

  const retry = useCallback((rawName: string) => ensureLoaded(rawName, true), [ensureLoaded]);

  return {
    store: state.store,
    setStore,
    open: state.open,
    products: state.products,
    loading: state.loading,
    errors: state.errors,
    togglePanel,
    retry,
    loadAll,
    openMany,
    bulkLoading,
  };
}

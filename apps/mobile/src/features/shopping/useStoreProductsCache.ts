import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import type { StoreProduct, StoreProductsResponse } from "@cooking/api-client";
import { isSafeWeeeProductUrl } from "@cooking/shared";
import { useApiClient, type ApiClient } from "../../lib/api";
import {
  readSmartProducts,
  type SmartProductsStored,
  writeSmartProducts,
} from "./storage";

type State = {
  open: Record<string, boolean>;
  products: Record<string, StoreProduct[]>;
  expiresAt: Record<string, string>;
  loading: Record<string, boolean>;
  errors: Record<string, string | null>;
};

type Action =
  | { type: "hydrate"; payload: SmartProductsStored; queueKeys: string[] }
  | { type: "clear" }
  | { type: "setOpen"; key: string; open: boolean }
  | { type: "setOpenMany"; keys: string[] }
  | { type: "loadStarted"; key: string }
  | { type: "loadSucceeded"; key: string; response: StoreProductsResponse }
  | { type: "expired"; key: string }
  | { type: "loadFailed"; key: string; error: string };

const emptyMaps = () => ({
  open: {} as Record<string, boolean>,
  products: {} as Record<string, StoreProduct[]>,
  expiresAt: {} as Record<string, string>,
  loading: {} as Record<string, boolean>,
  errors: {} as Record<string, string | null>,
});

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "hydrate": {
      return {
        ...state,
        open: action.payload.open,
        products: {},
        expiresAt: {},
        loading: Object.fromEntries(action.queueKeys.map((key) => [key, true])),
        errors: {
          ...action.payload.errors,
          ...Object.fromEntries(action.queueKeys.map((key) => [key, null])),
        },
      };
    }
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
    case "loadSucceeded": {
      const nextExpiresAt = { ...state.expiresAt };
      if (action.response.products.length && action.response.expires_at) {
        nextExpiresAt[action.key] = action.response.expires_at;
      } else {
        delete nextExpiresAt[action.key];
      }
      return {
        ...state,
        loading: { ...state.loading, [action.key]: false },
        products: { ...state.products, [action.key]: action.response.products },
        expiresAt: nextExpiresAt,
      };
    }
    case "expired": {
      const products = { ...state.products };
      const expiresAt = { ...state.expiresAt };
      delete products[action.key];
      delete expiresAt[action.key];
      return { ...state, products, expiresAt };
    }
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
): Promise<StoreProductsResponse> {
  const value: unknown = await apiClient.shopping.storeProducts(query);
  if (!value || typeof value !== "object") throw new Error("Invalid product response");
  const data = value as Partial<StoreProductsResponse>;
  if (!Array.isArray(data.products) || !("expires_at" in data)) {
    throw new Error("Invalid product response");
  }
  const products = data.products
    .filter(
      (row): row is StoreProduct =>
        !!row &&
        typeof row.name === "string" &&
        typeof row.price === "string" &&
        typeof row.image === "string" &&
        typeof row.url === "string" &&
        isSafeWeeeProductUrl(row.url),
    )
    .slice(0, 3);
  if (!products.length) {
    if (data.products.length === 0 && data.expires_at !== null) {
      throw new Error("Invalid product expiry");
    }
    return { products: [], expires_at: null };
  }
  if (
    typeof data.expires_at !== "string" ||
    !/T.*(?:Z|[+-]\d{2}:\d{2})$/i.test(data.expires_at)
  ) {
    throw new Error("Invalid product expiry");
  }
  const expiresAtMs = Date.parse(data.expires_at);
  if (!Number.isFinite(expiresAtMs) || expiresAtMs <= Date.now()) {
    throw new Error("Expired product response");
  }
  return { products, expires_at: data.expires_at };
}

const BULK_LOAD_CONCURRENCY = 3;

export type BulkLoadingState = { active: boolean; done: number; total: number };

export function useStoreProductsCache(weekStart: string | null) {
  const apiClient = useApiClient();
  const [state, dispatch] = useReducer(reducer, emptyMaps());

  const stateRef = useRef(state);
  stateRef.current = state;
  const generationRef = useRef(0);
  const inFlightRef = useRef(
    new Map<string, { generation: number; promise: Promise<void> }>(),
  );
  const expiryTimersRef = useRef(
    new Map<
      string,
      {
        expiresAt: string;
        generation: number;
        timer: ReturnType<typeof setTimeout>;
      }
    >(),
  );

  const [bulkLoading, setBulkLoading] = useState<BulkLoadingState>({
    active: false,
    done: 0,
    total: 0,
  });

  const loadOne = useCallback(
    (key: string, force: boolean, generation = generationRef.current): Promise<void> => {
      const existing = inFlightRef.current.get(key);
      if (existing?.generation === generation) return existing.promise;

      const snapshot = stateRef.current;
      const alreadyLoaded = snapshot.products[key] !== undefined && !snapshot.errors[key];
      const inFlight = snapshot.loading[key];
      if (!force && (alreadyLoaded || inFlight)) return Promise.resolve();

      const task = (async () => {
        dispatch({ type: "loadStarted", key });
        try {
          const response = await fetchProducts(apiClient, key);
          if (generationRef.current === generation) {
            dispatch({ type: "loadSucceeded", key, response });
          }
        } catch (e) {
          if (generationRef.current === generation) {
            dispatch({
              type: "loadFailed",
              key,
              error: e instanceof Error ? e.message : "Failed to load products",
            });
          }
        }
      })();
      let tracked: Promise<void>;
      tracked = task.finally(() => {
        if (inFlightRef.current.get(key)?.promise === tracked) {
          inFlightRef.current.delete(key);
        }
      });
      inFlightRef.current.set(key, { generation, promise: tracked });
      return tracked;
    },
    [apiClient],
  );

  // Hydrate from ephemeral whenever the week changes.
  useEffect(() => {
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    for (const entry of expiryTimersRef.current.values()) {
      clearTimeout(entry.timer);
    }
    expiryTimersRef.current.clear();
    if (!weekStart) {
      dispatch({ type: "clear" });
      return () => {
        if (generationRef.current === generation) generationRef.current += 1;
      };
    }
    let cancelled = false;
    void (async () => {
      const cached = await readSmartProducts(weekStart);
      if (cancelled) return;
      if (!cached) {
        dispatch({ type: "clear" });
        return;
      }
      const positiveKeys = Object.entries(cached.products)
        .filter(([, response]) => response.products.length > 0)
        .map(([key]) => key);
      const openKeys = Object.entries(cached.open)
        .filter(([, open]) => open)
        .map(([key]) => key);
      const queue = Array.from(new Set([...positiveKeys, ...openKeys]));
      dispatch({ type: "hydrate", payload: cached, queueKeys: [...queue] });
      async function worker() {
        while (!cancelled) {
          const key = queue.shift();
          if (!key) return;
          await loadOne(key, true, generation);
        }
      }
      await Promise.all(
        Array.from({ length: Math.min(BULK_LOAD_CONCURRENCY, queue.length) }, worker),
      );
    })();
    return () => {
      cancelled = true;
      if (generationRef.current === generation) generationRef.current += 1;
    };
  }, [loadOne, weekStart]);

  useEffect(() => {
    const timers = expiryTimersRef.current;
    const activeKeys = new Set<string>();
    const generation = generationRef.current;

    for (const [key, expiresAt] of Object.entries(state.expiresAt)) {
      if (!state.products[key]?.length) continue;
      activeKeys.add(key);
      const existing = timers.get(key);
      if (existing?.expiresAt === expiresAt && existing.generation === generation) {
        continue;
      }
      if (existing) clearTimeout(existing.timer);
      const expiresAtMs = Date.parse(expiresAt);
      const fireAtExpiry = () => {
        const remaining = expiresAtMs - Date.now();
        if (remaining > 0) {
          const current = timers.get(key);
          if (!current || current.expiresAt !== expiresAt) return;
          current.timer = setTimeout(fireAtExpiry, remaining);
          return;
        }
        timers.delete(key);
        const snapshot = stateRef.current;
        if (
          generationRef.current !== generation ||
          snapshot.expiresAt[key] !== expiresAt ||
          !snapshot.products[key]?.length
        ) {
          return;
        }
        dispatch({ type: "expired", key });
        void loadOne(key, true, generation);
      };
      const timer = setTimeout(fireAtExpiry, Math.max(0, expiresAtMs - Date.now()));
      timers.set(key, { expiresAt, generation, timer });
    }

    for (const [key, entry] of timers) {
      if (activeKeys.has(key)) continue;
      clearTimeout(entry.timer);
      timers.delete(key);
    }
  }, [loadOne, state.expiresAt, state.products, weekStart]);

  useEffect(
    () => () => {
      for (const entry of expiryTimersRef.current.values()) {
        clearTimeout(entry.timer);
      }
      expiryTimersRef.current.clear();
    },
    [],
  );

  // Persist on every change.
  useEffect(() => {
    if (!weekStart) return;
    const products: Record<string, StoreProductsResponse> = {};
    for (const [key, rows] of Object.entries(state.products)) {
      const expiresAt = state.expiresAt[key];
      if (!rows.length || !expiresAt || Date.parse(expiresAt) <= Date.now()) continue;
      products[key] = { products: rows, expires_at: expiresAt };
    }
    void writeSmartProducts(weekStart, {
      open: state.open,
      products,
      errors: state.errors,
    });
  }, [weekStart, state.open, state.products, state.expiresAt, state.errors]);

  const ensureLoaded = useCallback(
    async (rawName: string, force = false) => {
      const key = rawName.trim();
      if (!key) return;
      await loadOne(key, force);
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
      setBulkLoading({ active: true, done: 0, total: keys.length });
      const generation = generationRef.current;

      const queue = [...keys];
      let doneCount = 0;

      const worker = async () => {
        while (queue.length > 0) {
          const key = queue.shift();
          if (!key) return;
          await loadOne(key, false);
          if (generationRef.current !== generation) return;
          doneCount += 1;
          setBulkLoading({ active: true, done: doneCount, total: keys.length });
        }
      };

      const workers = Array.from({ length: Math.min(BULK_LOAD_CONCURRENCY, keys.length) }, worker);
      await Promise.all(workers);
      if (generationRef.current === generation) {
        setBulkLoading({ active: false, done: doneCount, total: keys.length });
      }
    },
    [loadOne],
  );

  const retry = useCallback((rawName: string) => ensureLoaded(rawName, true), [ensureLoaded]);

  return {
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

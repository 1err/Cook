import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import type {
  StoreProduct,
  StoreProductsBatchResponse,
  StoreProductsResponse,
} from "@cooking/api-client";
import { isSafeWeeeProductUrl } from "@cooking/shared";
import { useApiClient, type ApiClient } from "../../lib/api";
import {
  isFreshStoredProductResponse,
  readSmartProducts,
  type SmartProductsStored,
  writeSmartProducts,
} from "./storage";
import {
  canonicalStoreProductKey,
  cleanStoreProductQuery,
  prepareStoreProductQueries,
  type PreparedStoreProductQuery,
} from "./storeProductIdentity";

type State = {
  open: Record<string, boolean>;
  products: Record<string, StoreProduct[]>;
  expiresAt: Record<string, string>;
  loading: Record<string, boolean>;
  errors: Record<string, string | null>;
  hydratedWeekStart: string | null;
};

type Action =
  | { type: "hydrate"; payload: SmartProductsStored; weekStart: string }
  | { type: "clear"; hydratedWeekStart: string | null }
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

function initialState(): State {
  return { ...emptyMaps(), hydratedWeekStart: null };
}

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "hydrate": {
      const products: Record<string, StoreProduct[]> = {};
      const expiresAt: Record<string, string> = {};
      for (const [key, response] of Object.entries(action.payload.products)) {
        products[key] = response.products;
        expiresAt[key] = response.expires_at as string;
      }
      return {
        ...state,
        open: action.payload.open,
        products,
        expiresAt,
        loading: {},
        errors: action.payload.errors,
        hydratedWeekStart: action.weekStart,
      };
    }
    case "clear":
      return { ...state, ...emptyMaps(), hydratedWeekStart: action.hydratedWeekStart };
    case "setOpen":
      return { ...state, open: { ...state.open, [action.key]: action.open } };
    case "setOpenMany": {
      if (action.keys.length === 0) return state;
      const open = { ...state.open };
      action.keys.forEach((key) => {
        open[key] = true;
      });
      return { ...state, open };
    }
    case "loadStarted":
      return {
        ...state,
        loading: { ...state.loading, [action.key]: true },
        errors: { ...state.errors, [action.key]: null },
      };
    case "loadSucceeded": {
      const expiresAt = { ...state.expiresAt };
      if (action.response.products.length && action.response.expires_at) {
        expiresAt[action.key] = action.response.expires_at;
      } else {
        delete expiresAt[action.key];
      }
      return {
        ...state,
        loading: { ...state.loading, [action.key]: false },
        products: { ...state.products, [action.key]: action.response.products },
        expiresAt,
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

function parseStoreProductsResponse(value: unknown, nowMs = Date.now()): StoreProductsResponse {
  if (!value || typeof value !== "object") throw new Error("Invalid product response");
  const data = value as Partial<StoreProductsResponse>;
  if (!Array.isArray(data.products) || !("expires_at" in data)) {
    throw new Error("Invalid product response");
  }
  const products = data.products.filter(
    (row): row is StoreProduct =>
      !!row &&
      typeof row.name === "string" &&
      typeof row.price === "string" &&
      typeof row.image === "string" &&
      typeof row.url === "string" &&
      isSafeWeeeProductUrl(row.url),
  );
  if (!products.length) {
    if (data.products.length > 0 || data.expires_at !== null) {
      throw new Error("Invalid product response");
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
  if (!Number.isFinite(expiresAtMs) || expiresAtMs <= nowMs) {
    throw new Error("Expired product response");
  }
  return { products, expires_at: data.expires_at };
}

async function fetchProducts(apiClient: ApiClient, query: string): Promise<StoreProductsResponse> {
  return parseStoreProductsResponse(await apiClient.shopping.storeProducts(query));
}

type Priority = "interactive" | "bulk";
type QueueEntry = {
  key: string;
  query: string;
  generation: number;
  priority: Priority;
  started: boolean;
  bulk: boolean;
  promise: Promise<void>;
  resolve: () => void;
};

const MAX_TIMEOUT_MS = 2_147_483_647;

export type BulkLoadingState = { active: boolean; done: number; total: number };

export function useStoreProductsCache(weekStart: string | null) {
  const apiClient = useApiClient();
  const apiClientRef = useRef(apiClient);
  apiClientRef.current = apiClient;
  const [state, dispatch] = useReducer(reducer, undefined, initialState);
  const stateRef = useRef(state);
  stateRef.current = state;
  const generationRef = useRef(0);
  const inFlightRef = useRef(new Map<string, QueueEntry>());
  const interactiveQueueRef = useRef<QueueEntry[]>([]);
  const bulkQueueRef = useRef<QueueEntry[]>([]);
  const activeQueueRef = useRef(false);
  const expiryTimersRef = useRef(
    new Map<string, { expiresAt: string; generation: number; timer: ReturnType<typeof setTimeout> }>(),
  );
  const bulkProgressRef = useRef({ generation: 0, done: 0, total: 0 });
  const [bulkLoading, setBulkLoading] = useState<BulkLoadingState>({
    active: false,
    done: 0,
    total: 0,
  });

  const completeBulkRef = useRef<(generation: number) => void>(() => {});
  completeBulkRef.current = (generation) => {
    const progress = bulkProgressRef.current;
    if (generationRef.current !== generation || progress.generation !== generation) return;
    progress.done += 1;
    setBulkLoading({ active: progress.done < progress.total, done: progress.done, total: progress.total });
  };

  const pumpRef = useRef<() => void>(() => {});
  const finishRef = useRef<(entry: QueueEntry, response?: StoreProductsResponse, error?: string) => void>(
    () => {},
  );
  finishRef.current = (entry, response, error) => {
    if (inFlightRef.current.get(entry.key) === entry) {
      inFlightRef.current.delete(entry.key);
    }
    if (generationRef.current === entry.generation) {
      if (response) dispatch({ type: "loadSucceeded", key: entry.key, response });
      else dispatch({ type: "loadFailed", key: entry.key, error: error ?? "Failed to load products" });
      if (entry.bulk) completeBulkRef.current(entry.generation);
    }
    entry.resolve();
  };

  pumpRef.current = () => {
    if (activeQueueRef.current) return;
    while (!activeQueueRef.current) {
      const entry = interactiveQueueRef.current.shift() ?? bulkQueueRef.current.shift();
      if (!entry) return;
      if (inFlightRef.current.get(entry.key) !== entry || generationRef.current !== entry.generation) {
        if (inFlightRef.current.get(entry.key) === entry) inFlightRef.current.delete(entry.key);
        entry.resolve();
        continue;
      }
      activeQueueRef.current = true;
      entry.started = true;
      void fetchProducts(apiClientRef.current, entry.query).then(
        (response) => finishRef.current(entry, response),
        (reason: unknown) =>
          finishRef.current(
            entry,
            undefined,
            reason instanceof Error ? reason.message : "Failed to load products",
          ),
      ).finally(() => {
        activeQueueRef.current = false;
        pumpRef.current();
      });
    }
  };

  const enqueue = useCallback((entry: QueueEntry) => {
    if (entry.priority === "interactive") interactiveQueueRef.current.push(entry);
    else bulkQueueRef.current.push(entry);
    pumpRef.current();
  }, []);

  const createEntry = useCallback(
    (prepared: PreparedStoreProductQuery, priority: Priority, generation: number, bulk: boolean) => {
      let resolve!: () => void;
      const promise = new Promise<void>((done) => {
        resolve = done;
      });
      const entry: QueueEntry = {
        ...prepared,
        generation,
        priority,
        started: false,
        bulk,
        promise,
        resolve,
      };
      inFlightRef.current.set(entry.key, entry);
      dispatch({ type: "loadStarted", key: entry.key });
      return entry;
    },
    [],
  );

  const promote = useCallback((entry: QueueEntry) => {
    if (entry.started || entry.priority === "interactive") return;
    entry.priority = "interactive";
    const index = bulkQueueRef.current.indexOf(entry);
    if (index >= 0) {
      bulkQueueRef.current.splice(index, 1);
      interactiveQueueRef.current.push(entry);
      pumpRef.current();
    }
  }, []);

  const loadOne = useCallback(
    (
      prepared: PreparedStoreProductQuery,
      force: boolean,
      priority: Priority,
      generation = generationRef.current,
      bulk = false,
    ): Promise<void> => {
      if (generationRef.current !== generation) return Promise.resolve();
      const existing = inFlightRef.current.get(prepared.key);
      if (existing?.generation === generation) {
        if (priority === "interactive") promote(existing);
        return existing.promise;
      }
      const snapshot = stateRef.current;
      const expiresAt = snapshot.expiresAt[prepared.key];
      const alreadyLoaded =
        snapshot.products[prepared.key] !== undefined &&
        !snapshot.errors[prepared.key] &&
        (!expiresAt || Date.parse(expiresAt) > Date.now());
      if (!force && alreadyLoaded) return Promise.resolve();
      const entry = createEntry(prepared, priority, generation, bulk);
      enqueue(entry);
      return entry.promise;
    },
    [createEntry, enqueue, promote],
  );

  const parseBatch = useCallback(
    (value: unknown, requested: QueueEntry[]) => {
      if (!value || typeof value !== "object" || !Array.isArray((value as StoreProductsBatchResponse).entries)) {
        throw new Error("Invalid batch product response");
      }
      const expected = new Map(requested.map((entry) => [entry.key, entry]));
      const parsed = new Map<string, StoreProductsResponse | null>();
      const entries = (value as StoreProductsBatchResponse).entries;
      if (entries.length !== requested.length) throw new Error("Invalid batch product response");
      for (const item of entries) {
        if (!item || typeof item !== "object" || typeof item.query !== "string") {
          throw new Error("Invalid batch product response");
        }
        const key = canonicalStoreProductKey(item.query);
        if (!key || !expected.has(key) || parsed.has(key)) {
          throw new Error("Invalid batch product response");
        }
        if (item.status === "fresh") {
          parsed.set(key, parseStoreProductsResponse({ products: item.products, expires_at: item.expires_at }));
        } else if (
          item.status === "missing" &&
          Array.isArray(item.products) &&
          item.products.length === 0 &&
          item.expires_at === null
        ) {
          parsed.set(key, null);
        } else {
          throw new Error("Invalid batch product response");
        }
      }
      return parsed;
    },
    [],
  );

  const loadBatch = useCallback(
    (preparedQueries: PreparedStoreProductQuery[], generation: number, trackBulk: boolean) => {
      if (generationRef.current !== generation || preparedQueries.length === 0) return [] as Promise<void>[];
      const newEntries: QueueEntry[] = [];
      const promises: Promise<void>[] = [];
      for (const prepared of preparedQueries) {
        const existing = inFlightRef.current.get(prepared.key);
        if (existing?.generation === generation) {
          promises.push(existing.promise);
          continue;
        }
        const snapshot = stateRef.current;
        const expiry = snapshot.expiresAt[prepared.key];
        if (snapshot.products[prepared.key] && expiry && Date.parse(expiry) > Date.now()) continue;
        const entry = createEntry(prepared, "bulk", generation, trackBulk);
        newEntries.push(entry);
        promises.push(entry.promise);
      }
      if (!newEntries.length) return promises;
      void apiClientRef.current.shopping.storeProductsBatch(newEntries.map((entry) => entry.query)).then(
        (value) => {
          if (generationRef.current !== generation) {
            newEntries.forEach((entry) => {
              if (inFlightRef.current.get(entry.key) === entry) inFlightRef.current.delete(entry.key);
              entry.resolve();
            });
            return;
          }
          let parsed: Map<string, StoreProductsResponse | null>;
          try {
            parsed = parseBatch(value, newEntries);
          } catch {
            newEntries.forEach((entry) => enqueue(entry));
            return;
          }
          const misses: QueueEntry[] = [];
          for (const entry of newEntries) {
            if (inFlightRef.current.get(entry.key) !== entry) continue;
            const response = parsed.get(entry.key);
            if (response) finishRef.current(entry, response);
            else misses.push(entry);
          }
          misses.forEach(enqueue);
        },
        () => {
          if (generationRef.current !== generation) {
            newEntries.forEach((entry) => {
              if (inFlightRef.current.get(entry.key) === entry) inFlightRef.current.delete(entry.key);
              entry.resolve();
            });
            return;
          }
          newEntries.forEach((entry) => enqueue(entry));
        },
      );
      return promises;
    },
    [createEntry, enqueue, parseBatch],
  );

  useEffect(() => {
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    bulkProgressRef.current = { generation, done: 0, total: 0 };
    setBulkLoading({ active: false, done: 0, total: 0 });
    for (const entry of expiryTimersRef.current.values()) clearTimeout(entry.timer);
    expiryTimersRef.current.clear();
    if (!weekStart) {
      dispatch({ type: "clear", hydratedWeekStart: null });
      return;
    }
    let cancelled = false;
    void (async () => {
      const cached = await readSmartProducts(weekStart);
      if (cancelled || generationRef.current !== generation) return;
      if (!cached) {
        dispatch({ type: "clear", hydratedWeekStart: weekStart });
        return;
      }
      const nowMs = Date.now();
      const products: Record<string, StoreProductsResponse> = {};
      const open: Record<string, boolean> = {};
      const errors: Record<string, string | null> = {};
      for (const [rawKey, value] of Object.entries(cached.products)) {
        const key = canonicalStoreProductKey(rawKey);
        if (key && !products[key] && isFreshStoredProductResponse(value, nowMs)) {
          products[key] = value;
        }
      }
      for (const [rawKey, value] of Object.entries(cached.open)) {
        const key = canonicalStoreProductKey(rawKey);
        if (key && !(key in open) && typeof value === "boolean") open[key] = value;
      }
      for (const [rawKey, value] of Object.entries(cached.errors)) {
        const key = canonicalStoreProductKey(rawKey);
        if (key && !(key in errors) && (value === null || typeof value === "string")) {
          errors[key] = value;
        }
      }
      const hydrated: SmartProductsStored = { open, products, errors };
      dispatch({ type: "hydrate", payload: hydrated, weekStart });
      const misses = prepareStoreProductQueries(
        Object.entries(cached.open)
          .filter(([rawKey, value]) => value && !products[canonicalStoreProductKey(rawKey)])
          .map(([rawKey]) => rawKey),
      );
      loadBatch(misses, generation, false);
    })();
    return () => {
      cancelled = true;
    };
  }, [loadBatch, weekStart]);

  useEffect(() => {
    const timers = expiryTimersRef.current;
    const activeKeys = new Set<string>();
    const generation = generationRef.current;
    for (const [key, expiresAt] of Object.entries(state.expiresAt)) {
      if (!state.products[key]?.length) continue;
      activeKeys.add(key);
      const existing = timers.get(key);
      if (existing?.expiresAt === expiresAt && existing.generation === generation) continue;
      if (existing) clearTimeout(existing.timer);
      const expiresAtMs = Date.parse(expiresAt);
      const fireAtExpiry = () => {
        const remaining = expiresAtMs - Date.now();
        if (remaining > 0) {
          const current = timers.get(key);
          if (!current || current.expiresAt !== expiresAt || current.generation !== generation) return;
          current.timer = setTimeout(fireAtExpiry, Math.min(remaining, MAX_TIMEOUT_MS));
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
        void loadOne({ key, query: key }, true, "interactive", generation);
      };
      timers.set(key, {
        expiresAt,
        generation,
        timer: setTimeout(fireAtExpiry, Math.min(Math.max(0, expiresAtMs - Date.now()), MAX_TIMEOUT_MS)),
      });
    }
    for (const [key, entry] of timers) {
      if (activeKeys.has(key)) continue;
      clearTimeout(entry.timer);
      timers.delete(key);
    }
  }, [loadOne, state.expiresAt, state.products]);

  useEffect(
    () => () => {
      for (const entry of expiryTimersRef.current.values()) clearTimeout(entry.timer);
      expiryTimersRef.current.clear();
    },
    [],
  );

  useEffect(() => {
    if (!weekStart || state.hydratedWeekStart !== weekStart) return;
    const products: Record<string, StoreProductsResponse> = {};
    for (const [key, rows] of Object.entries(state.products)) {
      const expiresAt = state.expiresAt[key];
      if (!rows.length || !expiresAt || Date.parse(expiresAt) <= Date.now()) continue;
      products[key] = { products: rows, expires_at: expiresAt };
    }
    void writeSmartProducts(weekStart, { open: state.open, products, errors: state.errors });
  }, [state.errors, state.expiresAt, state.hydratedWeekStart, state.open, state.products, weekStart]);

  const ensureLoaded = useCallback(
    async (rawName: string, force = false, priority: Priority = "interactive") => {
      const query = cleanStoreProductQuery(rawName);
      const key = canonicalStoreProductKey(query);
      if (!key) return;
      await loadOne({ key, query }, force, priority);
    },
    [loadOne],
  );

  const togglePanel = useCallback(
    async (rawName: string) => {
      const query = cleanStoreProductQuery(rawName);
      const key = canonicalStoreProductKey(query);
      if (!key) return;
      const isOpen = !!stateRef.current.open[key];
      dispatch({ type: "setOpen", key, open: !isOpen });
      if (!isOpen) await ensureLoaded(query);
    },
    [ensureLoaded],
  );

  const openMany = useCallback((rawNames: string[]) => {
    const keys = prepareStoreProductQueries(rawNames).map(({ key }) => key);
    if (keys.length) dispatch({ type: "setOpenMany", keys });
  }, []);

  const loadAll = useCallback(
    async (rawNames: string[]) => {
      const prepared = prepareStoreProductQueries(rawNames);
      if (!prepared.length) return;
      const generation = generationRef.current;
      const nowMs = Date.now();
      const unresolved = prepared.filter(({ key }) => {
        const expiresAt = stateRef.current.expiresAt[key];
        return !(stateRef.current.products[key] && expiresAt && Date.parse(expiresAt) > nowMs);
      });
      const done = prepared.length - unresolved.length;
      bulkProgressRef.current = { generation, done, total: prepared.length };
      setBulkLoading({ active: unresolved.length > 0, done, total: prepared.length });
      if (!unresolved.length) return;
      await Promise.all(loadBatch(unresolved, generation, true));
    },
    [loadBatch],
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

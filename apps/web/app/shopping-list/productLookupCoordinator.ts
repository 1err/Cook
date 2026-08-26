import type {
  StoreProduct,
  StoreProductsBatchResponse,
  StoreProductsResponse,
} from "@cooking/api-client";
import { isSafeWeeeProductUrl } from "@cooking/shared";
import type { ProductLookupState } from "./productLoading";

export type ProductLookupStorage = {
  open: Record<string, boolean>;
  lookup: Record<string, ProductLookupState>;
  queries: Record<string, string>;
};

export type HydratedProductLookupStorage = ProductLookupStorage & {
  revalidate: string[];
};

type ProductLookupCoordinatorOptions = {
  load: (query: string) => Promise<StoreProductsResponse>;
  loadBatch: (queries: string[]) => Promise<StoreProductsBatchResponse>;
  shouldPublish: (generation: number) => boolean;
  onState: (
    canonicalKey: string,
    state: ProductLookupState,
    generation: number,
  ) => void;
};

type QueueEntry = {
  id: string;
  key: string;
  query: string;
  generation: number;
  priority: "interactive" | "bulk";
  promise: Promise<ProductLookupState>;
  resolve: (state: ProductLookupState) => void;
  started: boolean;
};

export function cleanIngredientQuery(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

export function canonicalIngredientKey(value: string): string {
  return cleanIngredientQuery(value).toLocaleLowerCase();
}

function normalizeProductText(value: string): string {
  return value.trim().replace(/\s+/gu, " ");
}

function normalizeWeeeProductUrl(value: string): string | null {
  const cleaned = normalizeProductText(value);
  const authority = /^https:\/\/([^/?#]*)/iu.exec(cleaned)?.[1];
  if (!authority || authority.includes("@") || !isSafeWeeeProductUrl(cleaned)) {
    return null;
  }
  try {
    const url = new URL(cleaned);
    url.hostname = url.hostname.toLocaleLowerCase();
    url.pathname = url.pathname.replace(/\/{2,}/gu, "/");
    return url.toString();
  } catch {
    return null;
  }
}

export function normalizeStoreProducts(value: unknown): StoreProduct[] {
  if (!Array.isArray(value)) return [];
  const products: StoreProduct[] = [];
  const seenNames = new Set<string>();
  const seenUrls = new Set<string>();
  for (const row of value) {
    if (!row || typeof row !== "object") continue;
    const maybe = row as Partial<StoreProduct>;
    if (
      typeof maybe.name !== "string" ||
      typeof maybe.price !== "string" ||
      typeof maybe.image !== "string" ||
      typeof maybe.url !== "string"
    ) {
      continue;
    }
    const name = normalizeProductText(maybe.name);
    const price = normalizeProductText(maybe.price);
    const image = normalizeProductText(maybe.image);
    const url = normalizeWeeeProductUrl(maybe.url);
    if (name.length < 1 || name.length > 120 || url === null) continue;
    const nameKey = name.toLocaleLowerCase();
    const urlKey = url.toLocaleLowerCase();
    if (seenNames.has(nameKey) || seenUrls.has(urlKey)) continue;
    seenNames.add(nameKey);
    seenUrls.add(urlKey);
    products.push({ name, price, image, url });
    if (products.length === 3) break;
  }
  return products;
}

export function isStoreProduct(row: unknown): row is StoreProduct {
  return normalizeStoreProducts([row]).length === 1;
}

function parseAuthoritativeExpiry(value: unknown, nowMs: number): string | null {
  if (value === null) return null;
  if (typeof value !== "string") throw new Error("Invalid product expiry");
  if (!/T.*(?:Z|[+-]\d{2}:\d{2})$/i.test(value)) {
    throw new Error("Invalid product expiry");
  }
  const expiresAtMs = Date.parse(value);
  if (!Number.isFinite(expiresAtMs) || expiresAtMs <= nowMs) {
    throw new Error("Expired product response");
  }
  return value;
}

export function parseStoreProductsResponse(
  value: unknown,
  nowMs = Date.now(),
): StoreProductsResponse {
  if (!value || typeof value !== "object") throw new Error("Invalid product response");
  const response = value as Partial<StoreProductsResponse>;
  if (!Array.isArray(response.products)) throw new Error("Invalid product response");
  if (!("expires_at" in response)) throw new Error("Invalid product expiry");
  const products = normalizeStoreProducts(response.products);
  if (!products.length) {
    if (response.products.length > 0) throw new Error("Invalid product response");
    if (response.products.length === 0 && response.expires_at !== null) {
      throw new Error("Invalid product expiry");
    }
    return { products: [], expires_at: null };
  }
  const expiresAt = parseAuthoritativeExpiry(response.expires_at, nowMs);
  if (expiresAt === null) throw new Error("Invalid product expiry");
  return { products, expires_at: expiresAt };
}

export function createProductLookupCoordinator({
  load,
  loadBatch,
  shouldPublish,
  onState,
}: ProductLookupCoordinatorOptions) {
  const interactiveQueue: QueueEntry[] = [];
  const bulkQueue: QueueEntry[] = [];
  const pendingByIdentity = new Map<string, QueueEntry>();
  const preferredQueryByKey = new Map<string, string>();
  let preferredQueryGeneration: number | null = null;
  let active: 0 | 1 = 0;

  function rotatePreferredQueries(generation: number) {
    if (preferredQueryGeneration === generation) return;
    preferredQueryByKey.clear();
    preferredQueryGeneration = generation;
  }

  function publish(entry: QueueEntry, state: ProductLookupState) {
    if (shouldPublish(entry.generation)) {
      onState(entry.key, state, entry.generation);
    }
  }

  function finish(
    entry: QueueEntry,
    state: ProductLookupState,
    shouldPump = true,
  ) {
    pendingByIdentity.delete(entry.id);
    if (entry.started) active = 0;
    publish(entry, state);
    entry.resolve(state);
    if (shouldPump) pump();
  }

  function start(entry: QueueEntry) {
    active = 1;
    entry.started = true;
    publish(entry, { status: "loading" });
    Promise.resolve()
      .then(() => load(entry.query))
      .then(
        (value) => {
          let response: StoreProductsResponse;
          try {
            response = parseStoreProductsResponse(value);
          } catch {
            finish(entry, { status: "error" });
            return;
          }
          finish(
            entry,
            response.products.length && response.expires_at
              ? {
                  status: "success",
                  products: response.products,
                  expiresAt: response.expires_at,
                }
              : { status: "empty", products: [] },
          );
        },
        () => finish(entry, { status: "error" }),
      );
  }

  function pump() {
    while (active === 0) {
      const entry = interactiveQueue.shift() ?? bulkQueue.shift();
      if (!entry) return;
      if (!shouldPublish(entry.generation)) {
        pendingByIdentity.delete(entry.id);
        entry.resolve({ status: "idle" });
        continue;
      }
      start(entry);
    }
  }

  function enqueue(entry: QueueEntry, shouldPump = true) {
    if (entry.priority === "interactive") interactiveQueue.push(entry);
    else bulkQueue.push(entry);
    if (shouldPump) pump();
  }

  function createEntry(
    query: string,
    key: string,
    generation: number,
    priority: QueueEntry["priority"],
  ): QueueEntry {
    let resolve!: (state: ProductLookupState) => void;
    const promise = new Promise<ProductLookupState>((done) => {
      resolve = done;
    });
    const entry: QueueEntry = {
      id: `${generation}:${key}`,
      key,
      query,
      generation,
      priority,
      promise,
      resolve,
      started: false,
    };
    pendingByIdentity.set(entry.id, entry);
    publish(entry, { status: "queued" });
    return entry;
  }

  function rememberQuery(
    queryInput: string,
    key: string,
    generation: number,
  ): string {
    rotatePreferredQueries(generation);
    const existing = preferredQueryByKey.get(key);
    if (existing) return existing;
    const query = cleanIngredientQuery(queryInput);
    preferredQueryByKey.set(key, query);
    return query;
  }

  function seedQueries(
    queryInput: Record<string, unknown>,
    generation: number,
  ) {
    if (!shouldPublish(generation)) return;
    rotatePreferredQueries(generation);
    for (const [rawKey, rawQuery] of Object.entries(queryInput)) {
      if (typeof rawQuery !== "string") continue;
      const key = canonicalIngredientKey(rawKey);
      const query = cleanIngredientQuery(rawQuery);
      if (!key || !query || canonicalIngredientKey(query) !== key) continue;
      if (!preferredQueryByKey.has(key)) {
        preferredQueryByKey.set(key, query);
      }
    }
  }

  function promote(entry: QueueEntry) {
    if (entry.started || entry.priority === "interactive") return;
    entry.priority = "interactive";
    const index = bulkQueue.indexOf(entry);
    if (index >= 0) {
      bulkQueue.splice(index, 1);
      interactiveQueue.push(entry);
      pump();
    }
  }

  function cancelPreflight(entry: QueueEntry) {
    if (pendingByIdentity.get(entry.id) !== entry) return;
    pendingByIdentity.delete(entry.id);
    entry.resolve({ status: "idle" });
  }

  function parseBatch(
    value: unknown,
    entries: QueueEntry[],
  ): Map<string, ProductLookupState> {
    if (!value || typeof value !== "object" || !Array.isArray((value as StoreProductsBatchResponse).entries)) {
      throw new Error("Invalid batch product response");
    }
    const requested = new Map(entries.map((entry) => [entry.key, entry]));
    const parsed = new Map<string, ProductLookupState>();
    const batchEntries = (value as StoreProductsBatchResponse).entries;
    if (batchEntries.length !== entries.length) throw new Error("Invalid batch product response");
    for (const batchEntry of batchEntries) {
      if (!batchEntry || typeof batchEntry !== "object" || typeof batchEntry.query !== "string") {
        throw new Error("Invalid batch product response");
      }
      const key = canonicalIngredientKey(batchEntry.query);
      if (!key || !requested.has(key) || parsed.has(key)) {
        throw new Error("Invalid batch product response");
      }
      if (batchEntry.status === "fresh") {
        if (
          !Array.isArray(batchEntry.products) ||
          batchEntry.products.length === 0
        ) {
          throw new Error("Invalid batch product response");
        }
        const response = parseStoreProductsResponse({
          products: batchEntry.products,
          expires_at: batchEntry.expires_at,
        });
        if (!response.products.length || !response.expires_at) {
          throw new Error("Invalid batch product response");
        }
        parsed.set(key, {
          status: "success",
          products: response.products,
          expiresAt: response.expires_at,
        });
      } else if (
        batchEntry.status === "missing" &&
        Array.isArray(batchEntry.products) &&
        batchEntry.products.length === 0 &&
        batchEntry.expires_at === null
      ) {
        parsed.set(key, { status: "queued" });
      } else {
        throw new Error("Invalid batch product response");
      }
    }
    return parsed;
  }

  function request(
    ingredientName: string,
    generation: number,
  ): Promise<ProductLookupState> {
    const cleanedQuery = cleanIngredientQuery(ingredientName);
    const key = canonicalIngredientKey(cleanedQuery);
    if (!key || !shouldPublish(generation)) {
      return Promise.resolve({ status: "idle" });
    }
    rotatePreferredQueries(generation);

    const id = `${generation}:${key}`;
    const existing = pendingByIdentity.get(id);
    if (existing) {
      promote(existing);
      return existing.promise;
    }

    const query = rememberQuery(cleanedQuery, key, generation);
    const entry = createEntry(query, key, generation, "interactive");
    enqueue(entry);
    return entry.promise;
  }

  function requestBulk(
    ingredientNames: string[],
    generation: number,
  ): Promise<ProductLookupState>[] {
    if (!shouldPublish(generation)) return [];
    rotatePreferredQueries(generation);
    const requests: Promise<ProductLookupState>[] = [];
    const newEntries: QueueEntry[] = [];
    const seen = new Set<string>();
    for (const ingredientName of ingredientNames) {
      const cleanedQuery = cleanIngredientQuery(ingredientName);
      const key = canonicalIngredientKey(cleanedQuery);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      const id = `${generation}:${key}`;
      const existing = pendingByIdentity.get(id);
      if (existing) {
        requests.push(existing.promise);
        continue;
      }
      const query = rememberQuery(cleanedQuery, key, generation);
      const entry = createEntry(query, key, generation, "bulk");
      newEntries.push(entry);
      requests.push(entry.promise);
    }
    if (!newEntries.length) return requests;

    Promise.resolve()
      .then(() => loadBatch(newEntries.map((entry) => entry.query)))
      .then(
        (batch) => {
          if (!shouldPublish(generation)) {
            newEntries.forEach(cancelPreflight);
            return;
          }
          let parsed: Map<string, ProductLookupState>;
          try {
            parsed = parseBatch(batch, newEntries);
          } catch {
            const fallback = newEntries.filter(
              (entry) => pendingByIdentity.get(entry.id) === entry,
            );
            fallback.forEach((entry) => enqueue(entry, false));
            pump();
            return;
          }
          const misses: QueueEntry[] = [];
          for (const entry of newEntries) {
            if (pendingByIdentity.get(entry.id) !== entry) continue;
            const state = parsed.get(entry.key)!;
            if (state.status === "queued") misses.push(entry);
            else finish(entry, state, false);
          }
          misses.forEach((entry) => enqueue(entry, false));
          pump();
        },
        () => {
          if (!shouldPublish(generation)) {
            newEntries.forEach(cancelPreflight);
            return;
          }
          const fallback = newEntries.filter(
            (entry) => pendingByIdentity.get(entry.id) === entry,
          );
          fallback.forEach((entry) => enqueue(entry, false));
          pump();
        },
      );
    return requests;
  }

  return {
    request,
    requestBulk,
    seedQueries,
    preferredQueryCount: () => preferredQueryByKey.size,
  };
}

function terminalPriority(state: ProductLookupState): number {
  if (state.status === "success") return 3;
  if (state.status === "empty") return 2;
  if (state.status === "error") return 1;
  return 0;
}

function sanitizeTerminalState(
  value: unknown,
  nowMs = Date.now(),
): ProductLookupState | null {
  if (!value || typeof value !== "object") return null;
  const state = value as ProductLookupState;
  if (state.status === "success") {
    const products = normalizeStoreProducts(state.products);
    if (
      !Array.isArray(state.products) ||
      !products.length ||
      typeof state.expiresAt !== "string"
    ) {
      return null;
    }
    try {
      const expiresAt = parseAuthoritativeExpiry(state.expiresAt, nowMs);
      if (expiresAt === null) return null;
      return {
        status: "success",
        products,
        expiresAt,
      };
    } catch {
      return null;
    }
  }
  if (state.status === "empty") return { status: "empty", products: [] };
  if (state.status === "error") return { status: "error" };
  return null;
}

export function buildProductLookupStorage(
  openInput: Record<string, unknown>,
  lookupInput: Record<string, unknown>,
  queryInputOrNowMs: Record<string, unknown> | number = {},
  nowMs = Date.now(),
): ProductLookupStorage {
  const queryInput =
    typeof queryInputOrNowMs === "number" ? {} : queryInputOrNowMs;
  const effectiveNowMs =
    typeof queryInputOrNowMs === "number" ? queryInputOrNowMs : nowMs;
  const queries: Record<string, string> = {};
  function remember(rawKey: string, rawQuery: unknown) {
    if (typeof rawQuery !== "string") return;
    const key = canonicalIngredientKey(rawKey);
    const query = cleanIngredientQuery(rawQuery);
    if (
      !key ||
      !query ||
      canonicalIngredientKey(query) !== key ||
      queries[key]
    ) {
      return;
    }
    queries[key] = query;
  }
  for (const [rawKey, rawQuery] of Object.entries(queryInput)) {
    remember(rawKey, rawQuery);
  }

  const open: Record<string, boolean> = {};
  for (const [rawKey, value] of Object.entries(openInput)) {
    const key = canonicalIngredientKey(rawKey);
    if (key && value === true) {
      open[key] = true;
      remember(rawKey, rawKey);
    }
  }

  const lookup: Record<string, ProductLookupState> = {};
  for (const [rawKey, value] of Object.entries(lookupInput)) {
    const key = canonicalIngredientKey(rawKey);
    const state = sanitizeTerminalState(value, effectiveNowMs);
    if (!key || !state) continue;
    remember(rawKey, rawKey);
    const existing = lookup[key];
    if (!existing || terminalPriority(state) > terminalPriority(existing)) {
      lookup[key] = state;
    }
  }
  return { open, lookup, queries };
}


function mergeQueryMetadata(
  primary: Record<string, unknown>,
  fallback: Record<string, unknown>,
): Record<string, string> {
  const merged: Record<string, string> = {};
  for (const source of [primary, fallback]) {
    for (const [rawKey, rawQuery] of Object.entries(source)) {
      if (typeof rawQuery !== "string") continue;
      const key = canonicalIngredientKey(rawKey);
      const query = cleanIngredientQuery(rawQuery);
      if (!key || canonicalIngredientKey(query) !== key || merged[key]) continue;
      merged[key] = query;
    }
  }
  return merged;
}

export function parseProductLookupStorage(
  raw: string,
  nowMs = Date.now(),
  seedQueries: Record<string, unknown> = {},
): HydratedProductLookupStorage | null {
  try {
    const parsed = JSON.parse(raw) as {
      open?: Record<string, unknown>;
      lookup?: Record<string, unknown>;
      queries?: Record<string, unknown>;
    };
    if (!parsed || typeof parsed !== "object") return null;
    if (!parsed.open || typeof parsed.open !== "object") return null;
    if (!parsed.lookup || typeof parsed.lookup !== "object") return null;
    const persistedQueries =
      parsed.queries && typeof parsed.queries === "object" ? parsed.queries : {};
    const stored = buildProductLookupStorage(
      parsed.open,
      parsed.lookup,
      mergeQueryMetadata(persistedQueries, seedQueries),
      nowMs,
    );
    const revalidate: string[] = [];
    for (const [key, open] of Object.entries(stored.open)) {
      if (!open || stored.lookup[key]?.status === "success") continue;
      revalidate.push(stored.queries[key] ?? key);
    }
    return { ...stored, revalidate };
  } catch {
    return null;
  }
}

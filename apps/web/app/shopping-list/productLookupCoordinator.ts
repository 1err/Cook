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

export function isStoreProduct(row: unknown): row is StoreProduct {
  if (!row || typeof row !== "object") return false;
  const maybe = row as Partial<StoreProduct>;
  return (
    typeof maybe.name === "string" &&
    typeof maybe.price === "string" &&
    typeof maybe.image === "string" &&
    typeof maybe.url === "string" &&
    isSafeWeeeProductUrl(maybe.url)
  );
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
  const products = response.products.filter(isStoreProduct).slice(0, 3);
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
  let active: 0 | 1 = 0;

  function publish(entry: QueueEntry, state: ProductLookupState) {
    if (shouldPublish(entry.generation)) {
      onState(entry.key, state, entry.generation);
    }
  }

  function finish(entry: QueueEntry, state: ProductLookupState) {
    pendingByIdentity.delete(entry.id);
    if (entry.started) active = 0;
    publish(entry, state);
    entry.resolve(state);
    pump();
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

  function enqueue(entry: QueueEntry) {
    if (entry.priority === "interactive") interactiveQueue.push(entry);
    else bulkQueue.push(entry);
    pump();
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
        const response = parseStoreProductsResponse({
          products: batchEntry.products,
          expires_at: batchEntry.expires_at,
        });
        parsed.set(
          key,
          response.products.length && response.expires_at
            ? { status: "success", products: response.products, expiresAt: response.expires_at }
            : { status: "empty", products: [] },
        );
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
    const query = cleanIngredientQuery(ingredientName);
    const key = canonicalIngredientKey(query);
    if (!key || !shouldPublish(generation)) {
      return Promise.resolve({ status: "idle" });
    }

    const id = `${generation}:${key}`;
    const existing = pendingByIdentity.get(id);
    if (existing) {
      promote(existing);
      return existing.promise;
    }

    const entry = createEntry(query, key, generation, "interactive");
    enqueue(entry);
    return entry.promise;
  }

  function requestBulk(
    ingredientNames: string[],
    generation: number,
  ): Promise<ProductLookupState>[] {
    if (!shouldPublish(generation)) return [];
    const requests: Promise<ProductLookupState>[] = [];
    const newEntries: QueueEntry[] = [];
    const seen = new Set<string>();
    for (const ingredientName of ingredientNames) {
      const query = cleanIngredientQuery(ingredientName);
      const key = canonicalIngredientKey(query);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      const id = `${generation}:${key}`;
      const existing = pendingByIdentity.get(id);
      if (existing) {
        requests.push(existing.promise);
        continue;
      }
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
            newEntries.forEach((entry) => {
              if (pendingByIdentity.get(entry.id) === entry) enqueue(entry);
            });
            return;
          }
          for (const entry of newEntries) {
            if (pendingByIdentity.get(entry.id) !== entry) continue;
            const state = parsed.get(entry.key)!;
            if (state.status === "queued") enqueue(entry);
            else finish(entry, state);
          }
        },
        () => {
          if (!shouldPublish(generation)) {
            newEntries.forEach(cancelPreflight);
            return;
          }
          newEntries.forEach((entry) => {
            if (pendingByIdentity.get(entry.id) === entry) enqueue(entry);
          });
        },
      );
    return requests;
  }

  return { request, requestBulk };
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
    if (
      !Array.isArray(state.products) ||
      !state.products.length ||
      !state.products.every(isStoreProduct) ||
      typeof state.expiresAt !== "string"
    ) {
      return null;
    }
    try {
      const expiresAt = parseAuthoritativeExpiry(state.expiresAt, nowMs);
      if (expiresAt === null) return null;
      return {
        status: "success",
        products: state.products.slice(0, 3),
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
  nowMs = Date.now(),
): ProductLookupStorage {
  const open: Record<string, boolean> = {};
  for (const [rawKey, value] of Object.entries(openInput)) {
    const key = canonicalIngredientKey(rawKey);
    if (key && value === true) open[key] = true;
  }

  const lookup: Record<string, ProductLookupState> = {};
  for (const [rawKey, value] of Object.entries(lookupInput)) {
    const key = canonicalIngredientKey(rawKey);
    const state = sanitizeTerminalState(value, nowMs);
    if (!key || !state) continue;
    const existing = lookup[key];
    if (!existing || terminalPriority(state) > terminalPriority(existing)) {
      lookup[key] = state;
    }
  }
  return { open, lookup };
}

export function parseProductLookupStorage(
  raw: string,
  nowMs = Date.now(),
): HydratedProductLookupStorage | null {
  try {
    const parsed = JSON.parse(raw) as {
      open?: Record<string, unknown>;
      lookup?: Record<string, unknown>;
    };
    if (!parsed || typeof parsed !== "object") return null;
    if (!parsed.open || typeof parsed.open !== "object") return null;
    if (!parsed.lookup || typeof parsed.lookup !== "object") return null;
    const stored = buildProductLookupStorage(parsed.open, parsed.lookup, nowMs);
    const revalidate: string[] = [];
    for (const [key, open] of Object.entries(stored.open)) {
      if (!open || stored.lookup[key]?.status === "success") continue;
      revalidate.push(key);
    }
    return { ...stored, revalidate };
  } catch {
    return null;
  }
}

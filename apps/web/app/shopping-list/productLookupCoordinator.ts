import type { StoreProduct, StoreProductsResponse } from "@cooking/api-client";
import { isSafeWeeeProductUrl } from "@cooking/shared";
import type { ProductLookupState } from "./productLoading";

const PRODUCT_LOOKUP_CONCURRENCY = 4;

export type ProductLookupStorage = {
  open: Record<string, boolean>;
  lookup: Record<string, ProductLookupState>;
};

export type HydratedProductLookupStorage = ProductLookupStorage & {
  revalidate: string[];
};

type ProductLookupCoordinatorOptions = {
  load: (query: string) => Promise<StoreProductsResponse>;
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
  promise: Promise<ProductLookupState>;
  resolve: (state: ProductLookupState) => void;
};

export function canonicalIngredientKey(value: string): string {
  return value.trim().toLocaleLowerCase();
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
  shouldPublish,
  onState,
}: ProductLookupCoordinatorOptions) {
  const queue: QueueEntry[] = [];
  const pendingByIdentity = new Map<string, QueueEntry>();
  let active = 0;

  function publish(entry: QueueEntry, state: ProductLookupState) {
    if (shouldPublish(entry.generation)) {
      onState(entry.key, state, entry.generation);
    }
  }

  function finish(entry: QueueEntry, state: ProductLookupState) {
    pendingByIdentity.delete(entry.id);
    active -= 1;
    publish(entry, state);
    entry.resolve(state);
    pump();
  }

  function start(entry: QueueEntry) {
    active += 1;
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
    while (active < PRODUCT_LOOKUP_CONCURRENCY && queue.length) {
      const entry = queue.shift()!;
      if (!shouldPublish(entry.generation)) {
        pendingByIdentity.delete(entry.id);
        entry.resolve({ status: "idle" });
        continue;
      }
      start(entry);
    }
  }

  function request(
    ingredientName: string,
    generation: number,
  ): Promise<ProductLookupState> {
    const query = ingredientName.trim();
    const key = canonicalIngredientKey(query);
    if (!key || !shouldPublish(generation)) {
      return Promise.resolve({ status: "idle" });
    }

    const id = `${generation}:${key}`;
    const existing = pendingByIdentity.get(id);
    if (existing) return existing.promise;

    let resolve!: (state: ProductLookupState) => void;
    const promise = new Promise<ProductLookupState>((done) => {
      resolve = done;
    });
    const entry: QueueEntry = { id, key, query, generation, promise, resolve };
    pendingByIdentity.set(id, entry);
    queue.push(entry);
    publish(entry, { status: "queued" });
    pump();
    return promise;
  }

  return { request };
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
    const seen = new Set<string>();
    for (const [rawKey, rawState] of Object.entries(parsed.lookup)) {
      const key = canonicalIngredientKey(rawKey);
      if (!key || seen.has(key) || !rawState || typeof rawState !== "object") continue;
      const state = rawState as ProductLookupState;
      if (state.status !== "success" || !Array.isArray(state.products) || !state.products.length) {
        continue;
      }
      seen.add(key);
      revalidate.push(key);
      delete stored.lookup[key];
    }
    return { ...stored, revalidate };
  } catch {
    return null;
  }
}

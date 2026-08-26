import type { StoreProduct, StoreProductsResponse } from "@cooking/api-client";
import { isSafeWeeeProductUrl } from "@cooking/shared";
import { ephemeral, json } from "../../lib/storage";
import { canonicalStoreProductKey, cleanStoreProductQuery } from "./storeProductIdentity";

export const SMART_SHOPPING_LIST_PREFIX = "smartShoppingList";
export const SMART_SHOPPING_PRODUCTS_PREFIX = "smartShoppingProducts";

export const smartListKey = (weekStart: string) => `${SMART_SHOPPING_LIST_PREFIX}:${weekStart}`;
export const smartProductsKey = (weekStart: string) =>
  `${SMART_SHOPPING_PRODUCTS_PREFIX}:${weekStart}:weee`;

export interface PurchaseItem {
  name: string;
  suggested_purchase: string;
  category?: string;
}

export interface RefineResponse {
  remove: string[];
  likely_pantry: { name: string; reason: string }[];
  purchase_items: PurchaseItem[];
}

export interface SmartStored extends RefineResponse {
  _ui?: { hidden: number[]; checked: number[] };
  _plannerFingerprint?: string;
}

export interface SmartProductsStored {
  open: Record<string, boolean>;
  products: Record<string, StoreProductsResponse>;
  errors: Record<string, string | null>;
  queries: Record<string, string>;
}

export type ParsedSmartList = {
  data: RefineResponse;
  hidden: Set<number>;
  checked: Set<number>;
  plannerFingerprint: string | null;
};

export function parseSmartStored(parsed: unknown): ParsedSmartList | null {
  if (!parsed || typeof parsed !== "object") return null;
  const stored = parsed as SmartStored;
  if (!Array.isArray(stored.purchase_items)) return null;
  if (!Array.isArray(stored.likely_pantry) || !Array.isArray(stored.remove)) return null;
  const { _ui, _plannerFingerprint, ...rest } = stored;
  return {
    data: rest as RefineResponse,
    hidden: new Set(_ui?.hidden ?? []),
    checked: new Set(_ui?.checked ?? []),
    plannerFingerprint: typeof _plannerFingerprint === "string" ? _plannerFingerprint : null,
  };
}

function isStoredProduct(row: unknown): row is StoreProduct {
  if (!row || typeof row !== "object") return false;
  const product = row as Partial<StoreProduct>;
  return (
    typeof product.name === "string" &&
    typeof product.price === "string" &&
    typeof product.image === "string" &&
    typeof product.url === "string" &&
    isSafeWeeeProductUrl(product.url)
  );
}

function validFutureExpiry(value: unknown, nowMs: number): value is string {
  if (typeof value !== "string" || !/T.*(?:Z|[+-]\d{2}:\d{2})$/i.test(value)) {
    return false;
  }
  const expiresAtMs = Date.parse(value);
  return Number.isFinite(expiresAtMs) && expiresAtMs > nowMs;
}

export function isFreshStoredProductResponse(
  value: unknown,
  nowMs = Date.now(),
): value is StoreProductsResponse {
  if (!value || typeof value !== "object") return false;
  const response = value as Partial<StoreProductsResponse>;
  return (
    Array.isArray(response.products) &&
    response.products.length > 0 &&
    response.products.every(isStoredProduct) &&
    validFutureExpiry(response.expires_at, nowMs)
  );
}

export function parseSmartProductsStored(
  parsed: unknown,
  nowMs = Date.now(),
): SmartProductsStored | null {
  if (!parsed || typeof parsed !== "object") return null;
  const stored = parsed as SmartProductsStored;
  if (!stored.open || typeof stored.open !== "object") return null;
  if (!stored.products || typeof stored.products !== "object") return null;
  if (!stored.errors || typeof stored.errors !== "object") return null;
  const products: Record<string, StoreProductsResponse> = {};
  for (const [rawKey, value] of Object.entries(stored.products)) {
    const key = canonicalStoreProductKey(rawKey);
    if (!key || !isFreshStoredProductResponse(value, nowMs)) continue;
    products[key] = { products: value.products.slice(0, 3), expires_at: value.expires_at };
  }
  const queries: Record<string, string> = {};
  if (stored.queries && typeof stored.queries === "object") {
    for (const [rawKey, rawQuery] of Object.entries(stored.queries)) {
      const key = canonicalStoreProductKey(rawKey);
      const query = typeof rawQuery === "string" ? cleanStoreProductQuery(rawQuery) : "";
      if (key && query && canonicalStoreProductKey(query) === key) queries[key] = query;
    }
  }
  return {
    open: Object.fromEntries(
      Object.entries(stored.open)
        .map(([key, value]) => [canonicalStoreProductKey(key), value] as const)
        .filter(([key, value]) => !!key && typeof value === "boolean"),
    ),
    products,
    errors: Object.fromEntries(
      Object.entries(stored.errors)
        .map(([key, value]) => [canonicalStoreProductKey(key), value] as const)
        .filter(([key, value]) => !!key && (value === null || typeof value === "string")),
    ) as Record<string, string | null>,
    queries,
  };
}

export async function readSmartList(weekStart: string): Promise<ParsedSmartList | null> {
  const raw = await json.get<unknown>(ephemeral, smartListKey(weekStart));
  if (raw == null) return null;
  return parseSmartStored(raw);
}

export async function writeSmartList(
  weekStart: string,
  data: RefineResponse,
  hidden: Set<number>,
  checked: Set<number>,
  plannerFingerprint: string,
): Promise<void> {
  const payload: SmartStored = {
    ...data,
    _ui: { hidden: [...hidden], checked: [...checked] },
    _plannerFingerprint: plannerFingerprint,
  };
  await json.set(ephemeral, smartListKey(weekStart), payload);
}

export async function clearSmartList(weekStart: string): Promise<void> {
  await ephemeral.remove(smartListKey(weekStart));
}

export async function readSmartProducts(weekStart: string): Promise<SmartProductsStored | null> {
  const raw = await json.get<unknown>(ephemeral, smartProductsKey(weekStart));
  if (raw == null) return null;
  return parseSmartProductsStored(raw);
}

export async function writeSmartProducts(
  weekStart: string,
  payload: SmartProductsStored,
): Promise<void> {
  await json.set(ephemeral, smartProductsKey(weekStart), payload);
}

export async function clearSmartProducts(weekStart: string): Promise<void> {
  await ephemeral.remove(smartProductsKey(weekStart));
}

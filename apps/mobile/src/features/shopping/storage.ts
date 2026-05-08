import type { StoreProduct } from "@cooking/api-client";
import { PRODUCT_STORES, type ProductStore } from "@cooking/shared";
import { ephemeral, json } from "../../lib/storage";

export const SMART_SHOPPING_LIST_PREFIX = "smartShoppingList";
export const SMART_SHOPPING_PRODUCTS_PREFIX = "smartShoppingProducts";

export const smartListKey = (weekStart: string) => `${SMART_SHOPPING_LIST_PREFIX}:${weekStart}`;
export const smartProductsKey = (weekStart: string, store: ProductStore) =>
  `${SMART_SHOPPING_PRODUCTS_PREFIX}:${weekStart}:${store}`;

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
  products: Record<string, StoreProduct[]>;
  errors: Record<string, string | null>;
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

export function parseSmartProductsStored(parsed: unknown): SmartProductsStored | null {
  if (!parsed || typeof parsed !== "object") return null;
  const stored = parsed as SmartProductsStored;
  if (!stored.open || typeof stored.open !== "object") return null;
  if (!stored.products || typeof stored.products !== "object") return null;
  if (!stored.errors || typeof stored.errors !== "object") return null;
  return {
    open: Object.fromEntries(
      Object.entries(stored.open).filter(([, value]) => typeof value === "boolean"),
    ),
    products: Object.fromEntries(
      Object.entries(stored.products).filter(
        ([, value]) =>
          Array.isArray(value) &&
          value.every(
            (row) =>
              row &&
              typeof row === "object" &&
              typeof row.name === "string" &&
              typeof row.price === "string" &&
              typeof row.image === "string" &&
              typeof row.url === "string",
          ),
      ),
    ) as Record<string, StoreProduct[]>,
    errors: Object.fromEntries(
      Object.entries(stored.errors).filter(
        ([, value]) => value === null || typeof value === "string",
      ),
    ) as Record<string, string | null>,
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

export async function readSmartProducts(
  weekStart: string,
  store: ProductStore,
): Promise<SmartProductsStored | null> {
  const raw = await json.get<unknown>(ephemeral, smartProductsKey(weekStart, store));
  if (raw == null) return null;
  return parseSmartProductsStored(raw);
}

export async function writeSmartProducts(
  weekStart: string,
  store: ProductStore,
  payload: SmartProductsStored,
): Promise<void> {
  await json.set(ephemeral, smartProductsKey(weekStart, store), payload);
}

export async function clearSmartProductsForAllStores(weekStart: string): Promise<void> {
  await Promise.all(
    PRODUCT_STORES.map((store) => ephemeral.remove(smartProductsKey(weekStart, store))),
  );
}

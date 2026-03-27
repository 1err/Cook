/**
 * Store constants and search URL builder for shopping list and store preview.
 * Weee → ?keyword=, Yami → ?q=, Amazon → ?k=
 */

export type Store = "weee" | "yami" | "amazon";

export const STORE_LABELS: Record<Store, string> = {
  weee: "Weee",
  yami: "Yami",
  amazon: "Amazon",
};

export const STORE_BASE_URL: Record<Store, string> = {
  weee: "https://www.sayweee.com/en/search?keyword=",
  yami: "https://www.yamibuy.com/en/search?q=",
  amazon: "https://www.amazon.com/s?k=",
};

const STORES: Store[] = ["weee", "yami", "amazon"];

export function isValidStore(s: string | null): s is Store {
  return s === "weee" || s === "yami" || s === "amazon";
}

export function normalizeStore(storeParam: string | null, preferred: Store): Store {
  if (isValidStore(storeParam)) return storeParam;
  return preferred;
}

export function storeSearchUrl(store: Store, query: string): string {
  return STORE_BASE_URL[store] + encodeURIComponent(query.trim());
}

export const PREFERRED_STORE_KEY = "cooking-preferred-store";

export function getPreferredStore(): Store {
  if (typeof window === "undefined") return "weee";
  const raw = localStorage.getItem(PREFERRED_STORE_KEY);
  if (raw === "weee" || raw === "yami" || raw === "amazon") return raw;
  return "weee";
}

export { STORES };

/** SessionStorage key for refined purchase items passed to store-preview. Not persisted long-term. */
export const STORE_PREVIEW_ITEMS_KEY = "cooking-store-preview-items";

export interface StorePreviewItem {
  name: string;
  suggested_purchase: string;
  /** Grocery category from smart refine (optional). */
  category?: string;
}

export function buildItemQuery(item: StorePreviewItem): string {
  const parts = [item.name, item.suggested_purchase].filter(Boolean);
  return parts.join(" ").trim();
}

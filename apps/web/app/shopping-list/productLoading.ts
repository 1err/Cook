import type { StoreProduct, StoreProductsResponse } from "@cooking/api-client";
import type { GroceryCategory } from "@cooking/shared";

export type ProductLookupStatus = "idle" | "queued" | "loading" | "success" | "empty" | "error";

export type ProductLookupState = {
  status: ProductLookupStatus;
  products?: StoreProduct[];
  expiresAt?: string;
  error?: string;
};

export type ProductQueueGroup = {
  category: GroceryCategory;
  rows: readonly { name: string; checked: boolean }[];
};

/**
 * Builds request priority from the same category and item order the grocery
 * screen already renders. It does not reorder or otherwise alter that UI.
 */
export function buildVisualProductQueue(groups: readonly ProductQueueGroup[]): string[] {
  const seen = new Set<string>();
  const queue: string[] = [];

  for (const group of groups) {
    for (const row of group.rows) {
      const key = row.name.trim();
      const normalizedKey = key.toLocaleLowerCase();
      if (!key || row.checked || seen.has(normalizedKey)) continue;
      seen.add(normalizedKey);
      queue.push(key);
    }
  }

  return queue;
}

export async function runOrderedProductQueue({
  keys,
  load,
  onState,
  onProgress,
  shouldContinue = () => true,
  concurrency = 4,
}: {
  keys: string[];
  load: (key: string) => Promise<StoreProductsResponse>;
  onState: (key: string, state: ProductLookupState) => void;
  onProgress: (done: number, total: number) => void;
  shouldContinue?: () => boolean;
  concurrency?: number;
}): Promise<void> {
  keys.forEach((key) => onState(key, { status: "queued" }));

  let cursor = 0;
  let done = 0;
  const requestedWorkers = Number.isFinite(concurrency) ? Math.floor(concurrency) : 4;
  const workerCount = Math.min(Math.max(1, Math.min(requestedWorkers, 4)), keys.length);

  async function worker() {
    while (shouldContinue()) {
      const index = cursor++;
      if (index >= keys.length) return;

      const key = keys[index];
      onState(key, { status: "loading" });
      try {
        const result = await load(key);
        onState(
          key,
          result.products.length && result.expires_at
            ? {
                status: "success",
                products: result.products,
                expiresAt: result.expires_at,
              }
            : { status: "empty", products: [] },
        );
      } catch (error) {
        onState(key, {
          status: "error",
          error: error instanceof Error ? error.message : "Failed to load products",
        });
      }
      done += 1;
      onProgress(done, keys.length);
    }
  }

  await Promise.all(Array.from({ length: workerCount }, () => worker()));
}

import type { StoreProductsBatchResponse } from "./index";

/** Keep cache preflights within the server's 100-query request limit. */
export async function loadStoreProductBatches(
  queries: string[],
  load: (queries: string[]) => Promise<StoreProductsBatchResponse>,
  isCurrent: () => boolean = () => true,
): Promise<StoreProductsBatchResponse> {
  const entries: StoreProductsBatchResponse["entries"] = [];
  // Sequential batches leave room for an interactive lookup under the shared
  // two-request account limit. A full 200-ingredient list needs just two calls.
  for (let offset = 0; offset < queries.length; offset += 100) {
    if (!isCurrent()) throw new Error("Product lookup cancelled");
    const response = await load(queries.slice(offset, offset + 100));
    if (!Array.isArray(response?.entries)) throw new Error("Invalid product batch");
    entries.push(...response.entries);
  }
  return { entries };
}

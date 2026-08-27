export type PreparedStoreProductQuery = { key: string; query: string };

export function cleanStoreProductQuery(raw: string): string {
  return raw.trim().replace(/\s+/g, " ");
}

export function canonicalStoreProductKey(raw: string): string {
  return cleanStoreProductQuery(raw).toLocaleLowerCase();
}

export function prepareStoreProductQueries(
  rawNames: readonly string[],
): PreparedStoreProductQuery[] {
  const seen = new Set<string>();
  const result: PreparedStoreProductQuery[] = [];
  for (const raw of rawNames) {
    const query = cleanStoreProductQuery(raw);
    const key = canonicalStoreProductKey(query);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push({ key, query });
  }
  return result;
}
